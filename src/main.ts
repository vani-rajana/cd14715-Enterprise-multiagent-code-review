import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator } from './utils/report-generator.js';
import { logger } from './utils/logger.js';

// Load environment variables
dotenv.config();

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main() {
  const [owner, repo, prStr] = process.argv.slice(2);

  // 1. Validate command line arguments
  if (!owner || !repo || !prStr) {
    console.error('❌ Error: Missing required command-line arguments.');
    console.error('Usage: npm run dev <owner> <repo> <pr-number>');
    console.error('Example: npm run dev facebook react 12345');
    process.exit(1);
  }

  const prNumber = parseInt(prStr, 10);
  if (isNaN(prNumber) || prNumber <= 0 || !Number.isInteger(prNumber)) {
    console.error(`❌ Error: Invalid pull request number "${prStr}". Must be a positive integer.`);
    process.exit(1);
  }

  // 2. Validate authentication (choose ONE method)
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasAwsKeys = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

  if (hasAwsKeys) {
    if (!process.env.AWS_REGION) {
      console.error('❌ Error: AWS Bedrock authentication requires AWS_REGION to be set.');
      process.exit(1);
    }
    console.log('🔐 Using AWS Bedrock authentication');
    logger.info('Using AWS Bedrock authentication', { region: process.env.AWS_REGION });
  } else if (hasAnthropicKey) {
    console.log('🔐 Using Anthropic API authentication');
    logger.info('Using Anthropic API authentication');
  } else {
    console.error('❌ Error: No authentication credentials found.');
    console.error('Please configure ONE of the following authentication methods in your .env:');
    console.error('  1. Anthropic API: ANTHROPIC_API_KEY=sk-ant-...');
    console.error('  2. AWS Bedrock:   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=...');
    process.exit(1);
  }

  // 3. Validate ANTHROPIC_MODEL environment variable
  const model = process.env.ANTHROPIC_MODEL;
  if (!model) {
    console.error('❌ Error: ANTHROPIC_MODEL environment variable is required.');
    console.error('  - For Anthropic API: ANTHROPIC_MODEL=claude-sonnet-4-5-20250929');
    console.error('  - For AWS Bedrock:   ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0');
    process.exit(1);
  }

  console.log(`🚀 Starting Multi-Agent Code Review for ${owner}/${repo}#${prNumber}...`);

  try {
    // 4. Create orchestrator instance
    const orchestrator = new CodeReviewOrchestrator();

    // 5. Run pull request review
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    // 6. Generate formatted reports using ReportGenerator
    const generator = new ReportGenerator();
    const mdReport = generator.generateMarkdownReport(report);
    const htmlReport = generator.generateHTMLReport(report);
    const jsonReport = generator.generateJSONReport(report);

    // 7. Save reports to 'reports/' directory
    const reportsDir = path.resolve(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseFilename = `review-${owner}-${repo}-pr${prNumber}-${timestamp}`;

    const mdPath = path.join(reportsDir, `${baseFilename}.md`);
    const htmlPath = path.join(reportsDir, `${baseFilename}.html`);
    const jsonPath = path.join(reportsDir, `${baseFilename}.json`);

    fs.writeFileSync(mdPath, mdReport, 'utf8');
    fs.writeFileSync(htmlPath, htmlReport, 'utf8');
    fs.writeFileSync(jsonPath, jsonReport, 'utf8');

    console.log('\n✅ Code Review Completed Successfully!');
    console.log(`📊 Overall Score: ${report.summary.overallScore}/100`);
    console.log(`📁 Files Reviewed: ${report.summary.totalFiles}`);
    console.log(`🚨 Critical Issues: ${report.summary.criticalIssues}`);
    console.log(`🧪 High Priority Tests: ${report.summary.highPriorityTests}`);
    console.log(`💡 Refactorings: ${report.summary.refactoringOpportunities}`);
    console.log('\n📄 Generated Reports:');
    console.log(`  - Markdown: ${mdPath}`);
    console.log(`  - HTML:     ${htmlPath}`);
    console.log(`  - JSON:     ${jsonPath}`);
  } catch (error) {
    console.error('❌ Code review failed:', error instanceof Error ? error.message : error);
    logger.error('Code review execution failed', { error });
    process.exit(1);
  }
}

main();
