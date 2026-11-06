import { AgentDefinition, query } from '@anthropic-ai/claude-agent-sdk';
import {
  REFACTORING_SUGGESTER_PROMPT,
  buildRefactoringPrompt
} from '../prompts/refactoring-suggester.prompt.js';
import {
  RefactoringSuggestion,
  RefactoringSuggestionSchema,
  RefactoringSuggestionJSONSchema
} from '../types/analysis-results.js';
import { logger } from '../utils/logger.js';

/**
 * AgentDefinition for refactoring suggester subagent
 * Recommends architectural modernizations, pattern improvements, and clean code refactorings with before/after examples.
 */
export const refactoringSuggester: AgentDefinition = {
  description:
    'Recommends architectural modernizations, pattern improvements, and clean code refactorings with before/after examples.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  tools: ['Skill', 'Read', 'Grep', 'Glob'],
  model: 'sonnet'
};

export interface RefactoringExecutionOptions {
  cwd?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Execute refactoring analysis on a file
 */
export async function suggestRefactorings(
  filePath: string,
  content?: string,
  options: RefactoringExecutionOptions = {}
): Promise<RefactoringSuggestion> {
  const projectRoot = options.cwd || process.env.PROJECT_ROOT || process.cwd();
  const model = options.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

  logger.debug('Starting refactoring analysis', { file: filePath });

  for await (const message of query({
    prompt: buildRefactoringPrompt(filePath, content),
    options: {
      cwd: projectRoot,
      settingSources: ['project'],
      model,
      allowedTools: ['Skill', 'Read', 'Grep', 'Glob'],
      outputFormat: {
        type: 'json_schema',
        schema: RefactoringSuggestionJSONSchema
      }
    }
  })) {
    if (
      message.type === 'result' &&
      message.subtype === 'success' &&
      message.structured_output
    ) {
      const parsed = RefactoringSuggestionSchema.safeParse(message.structured_output);
      if (parsed.success) {
        return parsed.data;
      }
      throw new Error(`RefactoringSuggestion validation failed: ${parsed.error.message}`);
    }

    if (
      message.type === 'result' &&
      message.subtype === 'error_max_structured_output_retries'
    ) {
      throw new Error('Refactoring structured output generation failed after retries');
    }
  }

  return {
    file: filePath,
    suggestions: [],
    summary: 'No immediate architectural refactoring required.'
  };
}
