/**
 * Centralized prompt management
 */

export { buildOrchestratorPrompt } from './orchestrator.prompt.js';
export {
  CODE_QUALITY_ANALYZER_PROMPT,
  buildCodeQualityPrompt
} from './code-quality-analyzer.prompt.js';
export {
  TEST_COVERAGE_ANALYZER_PROMPT,
  buildTestCoveragePrompt
} from './test-coverage-analyzer.prompt.js';
export {
  REFACTORING_SUGGESTER_PROMPT,
  buildRefactoringPrompt
} from './refactoring-suggester.prompt.js';
