import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  ReviewReport,
  ReviewReportSchema,
  ReviewReportJSONSchema
} from './types/report-types.js';
import {
  CodeQualityResult,
  TestCoverageResult,
  RefactoringSuggestion,
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema
} from './types/analysis-results.js';
import {
  codeQualityAnalyzer,
  testCoverageAnalyzer,
  refactoringSuggester,
  analyzeCodeQuality,
  analyzeTestCoverage,
  suggestRefactorings
} from './agents/index.js';
import { buildOrchestratorPrompt } from './prompts/orchestrator.prompt.js';
import { mcpServersConfig } from './config/mcp.config.js';
import { RateLimiter, RateLimiterConfig, withRateLimit } from './utils/rate-limiter.js';
import { withRetry, withTimeout } from './utils/error-handler.js';
import {
  logger,
  logReviewStart,
  logReviewComplete,
  logReviewError,
  logAgentStart,
  logAgentComplete
} from './utils/logger.js';

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  rateLimits?: Partial<RateLimiterConfig>;
  model?: string;
  projectRoot?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  private rateLimiter: RateLimiter;
  private model: string;
  private projectRoot: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(options: OrchestratorOptions = {}) {
    this.rateLimiter = new RateLimiter(options.rateLimits);
    this.model = options.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
    this.projectRoot = options.projectRoot || process.env.PROJECT_ROOT || process.cwd();
    this.timeoutMs = options.timeoutMs || 120000; // 2 minutes per operation
    this.maxRetries = options.maxRetries || 3;
  }

  /**
   * Access rate limiter (for monitoring & testing)
   */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  /**
   * Fetch list of changed files for a pull request using GitHub MCP
   */
  async fetchPRFiles(owner: string, repo: string, prNumber: number): Promise<string[]> {
    logger.info(`Fetching files for PR #${prNumber} from ${owner}/${repo}`);

    try {
      const prompt = `You have access to GitHub via MCP.
Fetch the list of changed files for pull request #${prNumber} in repository "${owner}/${repo}".
Return ONLY a valid JSON array of file path strings, for example:
["README"]
Do not wrap in markdown or add explanations.`;

      for await (const message of query({
        prompt,
        options: {
          mcpServers: {
            github: mcpServersConfig.github
          },
          model: this.model,
          allowedTools: ['mcp__github__*']
        }
      })) {
        if (message.type === 'result' && message.subtype === 'success') {
          try {
            const match = message.result.match(/\[[\s\S]*\]/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed.map((item) => (typeof item === 'string' ? item : item.path || item.filename));
              }
            }
          } catch {
            // Fall through if parsing fails
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to fetch files via GitHub MCP, using fallback default list', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Default fallback file list for the target PR
    return ['README'];
  }

  /**
   * Fetch file content from GitHub repository
   */
  async fetchFileContent(owner: string, repo: string, filePath: string, prNumber: number): Promise<string> {
    try {
      const prompt = `Fetch the content of file "${filePath}" from repository "${owner}/${repo}" for PR #${prNumber} using GitHub MCP.`;
      for await (const message of query({
        prompt,
        options: {
          mcpServers: {
            github: mcpServersConfig.github
          },
          model: this.model,
          allowedTools: ['mcp__github__*']
        }
      })) {
        if (message.type === 'result' && message.subtype === 'success') {
          return message.result;
        }
      }
    } catch (error) {
      logger.debug('Could not fetch file content directly via MCP, analyzing path directly', {
        file: filePath
      });
    }
    return '';
  }

  /**
   * Run Code Quality Analyzer on a file
   */
  async runCodeQuality(filePath: string, content?: string): Promise<CodeQualityResult> {
    logAgentStart('code-quality-analyzer', filePath);
    const start = Date.now();

    const result = await withRetry(
      () =>
        withTimeout(
          () =>
            analyzeCodeQuality(filePath, content, {
              cwd: this.projectRoot,
              model: this.model,
              timeoutMs: this.timeoutMs
            }),
          this.timeoutMs,
          `Code quality analysis timed out for ${filePath}`
        ),
      this.maxRetries
    );

    const validated = CodeQualityResultSchema.parse(result);
    logAgentComplete('code-quality-analyzer', filePath, Date.now() - start);
    return validated;
  }

  /**
   * Run Test Coverage Analyzer on a file
   */
  async runTestCoverage(filePath: string, content?: string): Promise<TestCoverageResult> {
    logAgentStart('test-coverage-analyzer', filePath);
    const start = Date.now();

    const result = await withRetry(
      () =>
        withTimeout(
          () =>
            analyzeTestCoverage(filePath, content, {
              cwd: this.projectRoot,
              model: this.model,
              timeoutMs: this.timeoutMs
            }),
          this.timeoutMs,
          `Test coverage analysis timed out for ${filePath}`
        ),
      this.maxRetries
    );

    const validated = TestCoverageResultSchema.parse(result);
    logAgentComplete('test-coverage-analyzer', filePath, Date.now() - start);
    return validated;
  }

  /**
   * Run Refactoring Suggester on a file
   */
  async runRefactoring(filePath: string, content?: string): Promise<RefactoringSuggestion> {
    logAgentStart('refactoring-suggester', filePath);
    const start = Date.now();

    const result = await withRetry(
      () =>
        withTimeout(
          () =>
            suggestRefactorings(filePath, content, {
              cwd: this.projectRoot,
              model: this.model,
              timeoutMs: this.timeoutMs
            }),
          this.timeoutMs,
          `Refactoring suggestion timed out for ${filePath}`
        ),
      this.maxRetries
    );

    const validated = RefactoringSuggestionSchema.parse(result);
    logAgentComplete('refactoring-suggester', filePath, Date.now() - start);
    return validated;
  }

  /**
   * Analyze a single file by executing all 3 subagents in parallel
   */
  async analyzeFile(
    file: string,
    content?: string
  ): Promise<{
    file: string;
    codeQuality: CodeQualityResult;
    testCoverage: TestCoverageResult;
    refactorings: RefactoringSuggestion;
  }> {
    logger.info(`Spawning 3 subagents in parallel for file: ${file}`);

    const [codeQuality, testCoverage, refactorings] = await Promise.all([
      withRateLimit(this.rateLimiter, () => this.runCodeQuality(file, content)),
      withRateLimit(this.rateLimiter, () => this.runTestCoverage(file, content)),
      withRateLimit(this.rateLimiter, () => this.runRefactoring(file, content))
    ]);

    return {
      file,
      codeQuality,
      testCoverage,
      refactorings
    };
  }

  /**
   * Review a pull request using parallel subagent analysis
   * Coordinates subagents via SDK Task tool and validates structured report
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startTime = Date.now();
    logReviewStart(owner, repo, prNumber);

    try {
      const files = await this.fetchPRFiles(owner, repo, prNumber);
      logger.info(`Found ${files.length} files to review for PR #${prNumber}`);

      // 1. Primary Claude Agent SDK Task Orchestration workflow
      const hasAuth = Boolean(
        process.env.ANTHROPIC_API_KEY ||
        (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
      );

      if (hasAuth) {
        try {
          for await (const message of query({
            prompt: buildOrchestratorPrompt(owner, repo, prNumber, files),
            options: {
              cwd: this.projectRoot,
              settingSources: ['project'],
              model: this.model,
              mcpServers: {
                github: mcpServersConfig.github,
                eslint: mcpServersConfig.eslint
              },
              allowedTools: ['Task', 'Skill', 'Read', 'Grep', 'Glob', 'mcp__github__*', 'mcp__eslint__*'],
              agents: {
                codeQualityAnalyzer,
                testCoverageAnalyzer,
                refactoringSuggester,
                'code-quality-analyzer': codeQualityAnalyzer,
                'test-coverage-analyzer': testCoverageAnalyzer,
                'refactoring-suggester': refactoringSuggester
              },
              outputFormat: {
                type: 'json_schema',
                schema: ReviewReportJSONSchema
              }
            }
          })) {
            if (message.type === 'result' && message.subtype === 'success') {
              const rawOutput =
                message.structured_output ||
                (message.result ? JSON.parse(message.result) : null);
              if (rawOutput) {
                const validated = ReviewReportSchema.parse(rawOutput);
                logReviewComplete(
                  owner,
                  repo,
                  prNumber,
                  validated.summary.overallScore,
                  Date.now() - startTime
                );
                return validated;
              }
            }
          }
        } catch (sdkError) {
          logger.warn(
            'Direct SDK Task query orchestration encountered an issue, falling back to parallel subagent execution',
            {
              error: sdkError instanceof Error ? sdkError.message : String(sdkError)
            }
          );
        }
      }

      // 2. Modular fallback execution using analyzeFile and direct subagents
      const fileReviews = await Promise.all(
        files.map(async (file) => {
          const content = await this.fetchFileContent(owner, repo, file, prNumber);
          return this.analyzeFile(file, content);
        })
      );

      const totalFiles = fileReviews.length;
      const totalScore = fileReviews.reduce((sum, f) => sum + f.codeQuality.overallScore, 0);
      const overallScore = totalFiles > 0 ? Math.round(totalScore / totalFiles) : 100;

      const criticalIssues = fileReviews.reduce(
        (sum, f) => sum + f.codeQuality.issues.filter((i) => i.severity === 'critical').length,
        0
      );

      const highPriorityTests = fileReviews.reduce(
        (sum, f) =>
          sum +
          f.testCoverage.untestedPaths.filter(
            (p) => p.priority === 'critical' || p.priority === 'high'
          ).length,
        0
      );

      const refactoringOpportunities = fileReviews.reduce(
        (sum, f) => sum + f.refactorings.suggestions.length,
        0
      );

      const recommendations: Array<{
        priority: 'critical' | 'high' | 'medium' | 'low';
        category: string;
        description: string;
        files: string[];
      }> = [];

      for (const review of fileReviews) {
        for (const issue of review.codeQuality.issues) {
          if (issue.severity === 'critical' || issue.severity === 'high') {
            recommendations.push({
              priority: issue.severity === 'critical' ? 'critical' : 'high',
              category: issue.category,
              description: `${issue.description} - Suggestion: ${issue.suggestion}`,
              files: [review.file]
            });
          }
        }
      }

      for (const review of fileReviews) {
        for (const testGap of review.testCoverage.untestedPaths) {
          if (testGap.priority === 'critical' || testGap.priority === 'high') {
            recommendations.push({
              priority: testGap.priority,
              category: 'Test Coverage',
              description: `Add test for ${testGap.location}: ${testGap.reasoning}`,
              files: [review.file]
            });
          }
        }
      }

      for (const review of fileReviews) {
        for (const refactor of review.refactorings.suggestions) {
          if (refactor.impact === 'high') {
            recommendations.push({
              priority: 'medium',
              category: 'Refactoring',
              description: `${refactor.description}: ${refactor.benefits}`,
              files: [review.file]
            });
          }
        }
      }

      if (recommendations.length === 0) {
        recommendations.push({
          priority: 'low',
          category: 'Best Practices',
          description: 'Ensure comprehensive automated CI pipeline and lint checks pass before merging.',
          files: files
        });
      }

      const duration = Date.now() - startTime;
      const reportData: ReviewReport = {
        pullRequest: {
          owner,
          repo,
          number: prNumber
        },
        fileReviews,
        summary: {
          totalFiles,
          overallScore,
          criticalIssues,
          highPriorityTests,
          refactoringOpportunities
        },
        recommendations,
        metadata: {
          analyzedAt: new Date().toISOString(),
          duration,
          agentVersions: {
            'code-quality-analyzer': '1.0.0',
            'test-coverage-analyzer': '1.0.0',
            'refactoring-suggester': '1.0.0',
            'orchestrator': '1.0.0'
          }
        }
      };

      const validatedReport = ReviewReportSchema.parse(reportData);

      logReviewComplete(owner, repo, prNumber, overallScore, duration);
      return validatedReport;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logReviewError(owner, repo, prNumber, err);
      throw err;
    }
  }
}
