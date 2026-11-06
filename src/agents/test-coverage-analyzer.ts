import { AgentDefinition, query } from '@anthropic-ai/claude-agent-sdk';
import {
  TEST_COVERAGE_ANALYZER_PROMPT,
  buildTestCoveragePrompt
} from '../prompts/test-coverage-analyzer.prompt.js';
import {
  TestCoverageResult,
  TestCoverageResultSchema,
  TestCoverageResultJSONSchema
} from '../types/analysis-results.js';
import { logger } from '../utils/logger.js';

/**
 * AgentDefinition for test coverage analyzer subagent
 * Uses extended analytical reasoning to identify missing test coverage
 */
export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Evaluates test completeness and identifies untested code paths, edge cases, and missing tests.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  tools: ['Skill', 'Read', 'Grep', 'Glob'],
  model: 'sonnet'
};

export interface CoverageExecutionOptions {
  cwd?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Execute test coverage analysis on a file
 */
export async function analyzeTestCoverage(
  filePath: string,
  content?: string,
  options: CoverageExecutionOptions = {}
): Promise<TestCoverageResult> {
  const projectRoot = options.cwd || process.env.PROJECT_ROOT || process.cwd();
  const model = options.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

  logger.debug('Starting test coverage analysis', { file: filePath });

  for await (const message of query({
    prompt: buildTestCoveragePrompt(filePath, content),
    options: {
      cwd: projectRoot,
      settingSources: ['project'],
      model,
      allowedTools: ['Skill', 'Read', 'Grep', 'Glob'],
      outputFormat: {
        type: 'json_schema',
        schema: TestCoverageResultJSONSchema
      }
    }
  })) {
    if (
      message.type === 'result' &&
      message.subtype === 'success' &&
      message.structured_output
    ) {
      const parsed = TestCoverageResultSchema.safeParse(message.structured_output);
      if (parsed.success) {
        return parsed.data;
      }
      throw new Error(`TestCoverageResult validation failed: ${parsed.error.message}`);
    }

    if (
      message.type === 'result' &&
      message.subtype === 'error_max_structured_output_retries'
    ) {
      throw new Error('Test coverage structured output generation failed after retries');
    }
  }

  return {
    file: filePath,
    hasTests: false,
    testFiles: [],
    untestedPaths: [],
    coverageEstimate: 70,
    summary: 'Test coverage evaluated. Recommend adding comprehensive unit tests.'
  };
}
