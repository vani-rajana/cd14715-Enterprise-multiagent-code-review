/**
 * Prompt for Code Review Orchestrator
 */

export function buildOrchestratorPrompt(
  owner: string,
  repo: string,
  prNumber: number,
  fileList?: string[]
): string {
  return `You are the Lead Code Review Orchestrator coordinating a comprehensive PR review.

Target Pull Request:
- Repository: ${owner}/${repo}
- PR Number: #${prNumber}
${fileList && fileList.length > 0 ? `- Files to Review:\n${fileList.map((f) => `  * ${f}`).join('\n')}` : ''}

Responsibilities:
1. Coordinate the specialized subagents via the Task tool:
   - "code-quality-analyzer": Analyzes security, bugs, performance, style, and invokes Claude Skills
   - "test-coverage-analyzer": Evaluates test coverage and identifies untested execution paths
   - "refactoring-suggester": Identifies modernization, architecture improvements, and clean code refactorings
2. Review files in the pull request:
   - Execute subagents in parallel across each file
   - Validate that each subagent delivers complete analysis
3. Synthesize the findings into a unified, high-level review:
   - Calculate summary metrics: totalFiles, overallScore (weighted average of file quality scores), criticalIssues count, highPriorityTests count, refactoringOpportunities count
   - Identify top actionable recommendations across all files, classified by priority (critical, high, medium, low)
   - Preserve per-file review breakdowns

Return the unified report as structured JSON strictly conforming to the ReviewReport schema.`;
}

