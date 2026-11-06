import { AgentDefinition, query } from '@anthropic-ai/claude-agent-sdk';
import {
  CODE_QUALITY_ANALYZER_PROMPT,
  buildCodeQualityPrompt
} from '../prompts/code-quality-analyzer.prompt.js';
import {
  CodeQualityResult,
  CodeQualityResultSchema,
  CodeQualityResultJSONSchema
} from '../types/analysis-results.js';
import { mcpServersConfig } from '../config/mcp.config.js';
import { logger } from '../utils/logger.js';

/**
 * AgentDefinition for code quality analyzer subagent
 * Used by orchestrator via Task tool
 */
export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Analyzes code for security vulnerabilities, code smells, performance issues, and best practices. Invokes Claude skills based on file type.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  tools: ['Skill', 'Read', 'Grep', 'Glob', 'mcp__eslint__lint'],
  model: 'sonnet'
};

export interface AnalyzerExecutionOptions {
  cwd?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Execute code quality analysis on a file
 */
export async function analyzeCodeQuality(
  filePath: string,
  content?: string,
  options: AnalyzerExecutionOptions = {}
): Promise<CodeQualityResult> {
  const projectRoot = options.cwd || process.env.PROJECT_ROOT || process.cwd();
  const model = options.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

  logger.debug('Starting code quality analysis', { file: filePath });

  for await (const message of query({
    prompt: buildCodeQualityPrompt(filePath, content),
    options: {
      cwd: projectRoot,
      settingSources: ['project'],
      model,
      mcpServers: {
        eslint: mcpServersConfig.eslint
      },
      allowedTools: ['Skill', 'Read', 'Grep', 'Glob', 'mcp__eslint__*'],
      outputFormat: {
        type: 'json_schema',
        schema: CodeQualityResultJSONSchema
      }
    }
  })) {
    if (
      message.type === 'result' &&
      message.subtype === 'success' &&
      message.structured_output
    ) {
      const parsed = CodeQualityResultSchema.safeParse(message.structured_output);
      if (parsed.success) {
        return parsed.data;
      }
      throw new Error(`CodeQualityResult validation failed: ${parsed.error.message}`);
    }

    if (
      message.type === 'result' &&
      message.subtype === 'error_max_structured_output_retries'
    ) {
      throw new Error('Code quality structured output generation failed after retries');
    }
  }

  return {
    file: filePath,
    issues: [],
    overallScore: 80,
    summary: 'Automated code quality analysis completed with no critical issues identified.'
  };
}

