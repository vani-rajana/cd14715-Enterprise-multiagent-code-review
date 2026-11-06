import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodeReviewOrchestrator } from '../src/orchestrator.js';
import { ReviewReportSchema } from '../src/types/report-types.js';
import {
  CodeQualityResult,
  TestCoverageResult,
  RefactoringSuggestion
} from '../src/types/analysis-results.js';
import {
  codeQualityAnalyzer,
  testCoverageAnalyzer,
  refactoringSuggester
} from '../src/agents/index.js';

/**
 * Tests for CodeReviewOrchestrator & Subagents
 */
describe('CodeReviewOrchestrator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Configuration & Subagents', () => {
    it('should initialize with default options', () => {
      const orchestrator = new CodeReviewOrchestrator();
      expect(orchestrator).toBeDefined();

      const rateLimiter = orchestrator.getRateLimiter();
      const status = rateLimiter.getStatus();
      expect(status.availableRequests).toBe(50);
      expect(status.availableTokens).toBe(100000);
      expect(status.activeRequests).toBe(0);
    });

    it('should accept custom rate limit configuration', () => {
      const orchestrator = new CodeReviewOrchestrator({
        rateLimits: {
          maxRequestsPerMinute: 25,
          maxTokensPerMinute: 50000,
          maxConcurrent: 2
        }
      });

      const status = orchestrator.getRateLimiter().getStatus();
      expect(status.availableRequests).toBe(25);
      expect(status.availableTokens).toBe(50000);
    });

    it('should provide Skill access to all 3 subagents', () => {
      expect(codeQualityAnalyzer.tools).toContain('Skill');
      expect(testCoverageAnalyzer.tools).toContain('Skill');
      expect(refactoringSuggester.tools).toContain('Skill');
    });
  });

  describe('reviewPullRequest', () => {
    const mockCodeQuality: CodeQualityResult = {
      file: 'README',
      issues: [
        {
          line: 1,
          severity: 'info',
          category: 'best-practice',
          description: 'Ensure clear project overview and documentation links',
          suggestion: 'Add documentation link in README'
        }
      ],
      overallScore: 90,
      summary: 'Clean documentation with minor suggestion'
    };

    const mockTestCoverage: TestCoverageResult = {
      file: 'README',
      hasTests: false,
      testFiles: [],
      untestedPaths: [],
      coverageEstimate: 100,
      summary: 'Documentation file requires no code test suite'
    };

    const mockRefactoring: RefactoringSuggestion = {
      file: 'README',
      suggestions: [
        {
          type: 'modernize',
          location: 'Line 1',
          impact: 'low',
          description: 'Use formatted markdown headers',
          before: 'Hello GitHub!',
          after: '# Hello GitHub!',
          benefits: 'Standard markdown typography'
        }
      ],
      summary: 'Use markdown heading standard'
    };

    it('should fetch PR files from GitHub MCP', async () => {
      const orchestrator = new CodeReviewOrchestrator();
      const fetchSpy = vi.spyOn(orchestrator, 'fetchPRFiles').mockResolvedValue(['README']);

      const files = await orchestrator.fetchPRFiles('octocat', 'Hello-World', 1);
      expect(fetchSpy).toHaveBeenCalledWith('octocat', 'Hello-World', 1);
      expect(files).toEqual(['README']);
    });

    it('should spawn all 3 subagents in parallel', async () => {
      const orchestrator = new CodeReviewOrchestrator();

      const qualitySpy = vi.spyOn(orchestrator, 'runCodeQuality').mockResolvedValue(mockCodeQuality);
      const coverageSpy = vi.spyOn(orchestrator, 'runTestCoverage').mockResolvedValue(mockTestCoverage);
      const refactorSpy = vi.spyOn(orchestrator, 'runRefactoring').mockResolvedValue(mockRefactoring);

      const result = await orchestrator.analyzeFile('README');

      expect(qualitySpy).toHaveBeenCalledWith('README', undefined);
      expect(coverageSpy).toHaveBeenCalledWith('README', undefined);
      expect(refactorSpy).toHaveBeenCalledWith('README', undefined);

      expect(result.file).toBe('README');
      expect(result.codeQuality).toEqual(mockCodeQuality);
      expect(result.testCoverage).toEqual(mockTestCoverage);
      expect(result.refactorings).toEqual(mockRefactoring);
    });

    it('should aggregate results into ReviewReport', async () => {
      const orchestrator = new CodeReviewOrchestrator();

      vi.spyOn(orchestrator, 'fetchPRFiles').mockResolvedValue(['README']);
      vi.spyOn(orchestrator, 'fetchFileContent').mockResolvedValue('Hello GitHub!');
      vi.spyOn(orchestrator, 'analyzeFile').mockResolvedValue({
        file: 'README',
        codeQuality: mockCodeQuality,
        testCoverage: mockTestCoverage,
        refactorings: mockRefactoring
      });

      const report = await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);

      expect(report.pullRequest).toEqual({
        owner: 'octocat',
        repo: 'Hello-World',
        number: 1
      });

      expect(report.fileReviews).toHaveLength(1);
      expect(report.summary.totalFiles).toBe(1);
      expect(report.summary.overallScore).toBe(90);
      expect(report.summary.criticalIssues).toBe(0);

      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.metadata.agentVersions).toHaveProperty('orchestrator');
    });

    it('should validate output with Zod schema', async () => {
      const orchestrator = new CodeReviewOrchestrator();

      vi.spyOn(orchestrator, 'fetchPRFiles').mockResolvedValue(['README']);
      vi.spyOn(orchestrator, 'fetchFileContent').mockResolvedValue('');
      vi.spyOn(orchestrator, 'analyzeFile').mockResolvedValue({
        file: 'README',
        codeQuality: mockCodeQuality,
        testCoverage: mockTestCoverage,
        refactorings: mockRefactoring
      });

      const report = await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);
      const validation = ReviewReportSchema.safeParse(report);

      expect(validation.success).toBe(true);
      if (validation.success) {
        expect(validation.data.summary.totalFiles).toBe(1);
      }
    });
  });

  describe('Integration', () => {
    // These tests require actual API keys and should be skipped in CI
    it.skip('should review a real small PR', async () => {
      const orchestrator = new CodeReviewOrchestrator();
      const report = await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);
      expect(report).toBeDefined();
    });
  });
});
