import '@/shared/config/load-env-files.js';
import {
  PROJECT_DISPLAY_NAME,
  PROJECT_SLUG,
} from '@/shared/constants/project-identity.constants.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sendEmail, isMailConfigured } from '@/infrastructure/mail/mail.service.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

interface CoverageMetric {
  pct?: number;
  covered?: number;
  total?: number;
}

interface CoverageSummary {
  total?: {
    lines?: CoverageMetric;
    statements?: CoverageMetric;
    branches?: CoverageMetric;
    functions?: CoverageMetric;
  };
}

function loadCoverageSummary(): CoverageSummary | null {
  const coveragePath = path.resolve(process.cwd(), 'coverage', 'coverage-summary.json');

  if (!existsSync(coveragePath)) {
    logger.warn({ coveragePath }, 'test-report.coverage-summary.missing');
    return null;
  }

  try {
    const raw = readFileSync(coveragePath, 'utf-8');
    return JSON.parse(raw) as CoverageSummary;
  } catch (error) {
    logger.error({ error, coveragePath }, 'test-report.coverage-summary.parse.failed');
    return null;
  }
}

function formatPct(value?: number): string {
  if (typeof value !== 'number') return 'N/A';
  return `${value.toFixed(1)}%`;
}

function shortSha(sha?: string): string {
  if (!sha) return 'unknown';
  return sha.slice(0, 7);
}

function buildTextBody(
  status: string,
  coverage: CoverageSummary | null,
  options: {
    runUrl?: string;
    workflowName?: string;
    branch?: string;
    commitSha?: string;
    actor?: string;
    dateTime?: string;
  },
): string {
  const lines: string[] = [];

  lines.push(`${PROJECT_DISPLAY_NAME} CI Test Report — ${status.toUpperCase()}`);
  lines.push('');

  lines.push(`Status  : ${status.toUpperCase()}`);
  lines.push(`Workflow: ${options.workflowName ?? 'CI'}`);
  if (options.branch) lines.push(`Branch  : ${options.branch}`);
  if (options.commitSha)
    lines.push(`Commit  : ${shortSha(options.commitSha)} by ${options.actor ?? 'unknown'}`);
  if (options.dateTime) lines.push(`Time    : ${options.dateTime}`);
  lines.push('');

  lines.push('Coverage summary:');
  if (coverage?.total) {
    lines.push(
      `  Lines     : ${formatPct(coverage.total.lines?.pct)} ` +
        `(covered ${coverage.total.lines?.covered ?? 0} of ${coverage.total.lines?.total ?? 0})`,
    );
    lines.push(
      `  Statements: ${formatPct(coverage.total.statements?.pct)} ` +
        `(covered ${coverage.total.statements?.covered ?? 0} of ${
          coverage.total.statements?.total ?? 0
        })`,
    );
    lines.push(
      `  Branches  : ${formatPct(coverage.total.branches?.pct)} ` +
        `(covered ${coverage.total.branches?.covered ?? 0} of ${
          coverage.total.branches?.total ?? 0
        })`,
    );
    lines.push(
      `  Functions : ${formatPct(coverage.total.functions?.pct)} ` +
        `(covered ${coverage.total.functions?.covered ?? 0} of ${
          coverage.total.functions?.total ?? 0
        })`,
    );
  } else {
    lines.push(
      '  Coverage summary is not available (tests may have failed before coverage was written).',
    );
  }

  lines.push('');

  if (options.runUrl) {
    lines.push(`GitHub Actions run: ${options.runUrl}`);
  }

  lines.push('');
  lines.push('Thresholds: Lines / Statements / Functions ≥ 60%, Branches ≥ 50%.');

  return lines.join('\n');
}

function buildHtmlBody(
  status: string,
  coverage: CoverageSummary | null,
  options: {
    runUrl?: string;
    workflowName?: string;
    branch?: string;
    commitSha?: string;
    actor?: string;
    dateTime?: string;
  },
): string {
  const rows: string[] = [];

  if (coverage?.total) {
    rows.push(
      `<tr>
        <td style="border: 1px solid #e5e7eb;">Lines</td>
        <td style="border: 1px solid #e5e7eb;">${formatPct(coverage.total.lines?.pct)}</td>
        <td style="border: 1px solid #e5e7eb;">${coverage.total.lines?.covered ?? 0} / ${
          coverage.total.lines?.total ?? 0
        }</td>
      </tr>`,
    );
    rows.push(
      `<tr>
        <td style="border: 1px solid #e5e7eb;">Statements</td>
        <td style="border: 1px solid #e5e7eb;">${formatPct(coverage.total.statements?.pct)}</td>
        <td style="border: 1px solid #e5e7eb;">${coverage.total.statements?.covered ?? 0} / ${
          coverage.total.statements?.total ?? 0
        }</td>
      </tr>`,
    );
    rows.push(
      `<tr>
        <td style="border: 1px solid #e5e7eb;">Branches</td>
        <td style="border: 1px solid #e5e7eb;">${formatPct(coverage.total.branches?.pct)}</td>
        <td style="border: 1px solid #e5e7eb;">${coverage.total.branches?.covered ?? 0} / ${
          coverage.total.branches?.total ?? 0
        }</td>
      </tr>`,
    );
    rows.push(
      `<tr>
        <td style="border: 1px solid #e5e7eb;">Functions</td>
        <td style="border: 1px solid #e5e7eb;">${formatPct(coverage.total.functions?.pct)}</td>
        <td style="border: 1px solid #e5e7eb;">${coverage.total.functions?.covered ?? 0} / ${
          coverage.total.functions?.total ?? 0
        }</td>
      </tr>`,
    );
  }

  const coverageTable =
    rows.length > 0
      ? `<table cellpadding="6" cellspacing="0" style="border-collapse: collapse; font-size: 13px; width: 100%; max-width: 100%;">
  <thead>
    <tr style="background-color: #f3f4f6;">
      <th align="left" style="border: 1px solid #e5e7eb;">Metric</th>
      <th align="left" style="border: 1px solid #e5e7eb;">Coverage</th>
      <th align="left" style="border: 1px solid #e5e7eb;">Covered / Total</th>
    </tr>
  </thead>
  <tbody>
    ${rows.join('\n')}
  </tbody>
</table>`
      : '<p>Coverage summary is not available (tests may have failed before coverage was written).</p>';

  const runLinkRow = options.runUrl
    ? `<tr>
        <td style="padding: 2px 8px 2px 0; font-weight: 600;">Run</td>
        <td style="padding: 2px 0;">
          <a href="${options.runUrl}" style="color:#2563eb; text-decoration:none;">View on GitHub Actions</a>
        </td>
      </tr>`
    : '';

  const workflowName = options.workflowName ?? 'CI';
  const statusUpper = status.toUpperCase();
  const isSuccess = statusUpper === 'SUCCESS';
  const statusBg = isSuccess ? '#dcfce7' : '#fee2e2';
  const statusText = isSuccess ? '#166534' : '#991b1b';

  const branchRow = options.branch
    ? `<tr>
        <td style="padding: 2px 8px 2px 0; font-weight: 600;">Branch</td>
        <td style="padding: 2px 0;">${options.branch}</td>
      </tr>`
    : '';

  const commitRow = options.commitSha
    ? `<tr>
        <td style="padding: 2px 8px 2px 0; font-weight: 600;">Commit</td>
        <td style="padding: 2px 0;">
          <code style="font-size: 12px; background:#f3f4f6; padding:2px 4px; border-radius:3px;">
            ${shortSha(options.commitSha)}
          </code>
          by ${options.actor ?? 'unknown'}
        </td>
      </tr>`
    : '';

  const timeRow = options.dateTime
    ? `<tr>
        <td style="padding: 2px 8px 2px 0; font-weight: 600;">Time</td>
        <td style="padding: 2px 0;">${options.dateTime}</td>
      </tr>`
    : '';

  return `<!doctype html>
<html>
  <body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827; background-color: #f9fafb; padding: 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb;">
      <tr>
        <td style="padding: 20px 24px; border-bottom: 1px solid #e5e7eb;">
          <h1 style="margin: 0; font-size: 18px; font-weight: 600; color: #111827;">
            ${PROJECT_DISPLAY_NAME} CI Test Report
          </h1>
          <p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">
            ${workflowName}${options.branch ? ` • ${options.branch}` : ''}${
              options.dateTime ? ` • ${options.dateTime}` : ''
            }
          </p>
        </td>
      </tr>

      <tr>
        <td style="padding: 16px 24px;">
          <p style="margin: 0 0 12px; font-size: 14px;">
            Status:
            <span style="
              display: inline-block;
              padding: 2px 10px;
              border-radius: 999px;
              font-size: 12px;
              font-weight: 600;
              color: ${statusText};
              background-color: ${statusBg};
            ">
              ${statusUpper}
            </span>
          </p>

          <table cellpadding="0" cellspacing="0" style="font-size: 13px; color: #374151; margin-bottom: 16px;">
            <tr>
              <td style="padding: 2px 8px 2px 0; font-weight: 600;">Workflow</td>
              <td style="padding: 2px 0;">${workflowName}</td>
            </tr>
            ${branchRow}
            ${commitRow}
            ${timeRow}
            ${runLinkRow}
          </table>

          <h2 style="margin: 12px 0 8px; font-size: 14px; font-weight: 600; color: #111827;">
            Coverage summary
          </h2>

          ${coverageTable}

          <p style="margin: 10px 0 0; font-size: 12px; color: #6b7280;">
            Thresholds: Lines / Statements / Functions ≥ 60%, Branches ≥ 50%.
          </p>

          <p style="margin: 16px 0 0; font-size: 12px; color: #9ca3af;">
            Full coverage HTML report is available as the <strong>coverage-report</strong> artifact in the GitHub Actions run.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function main(): Promise<void> {
  if (!isMailConfigured()) {
    logger.warn(
      'Mail service not configured (RESEND_API_KEY missing); skipping test report email.',
    );
    return;
  }

  const recipientsEnv = process.env.TEST_RESULT_EMAIL_TO;
  if (!recipientsEnv) {
    logger.warn('TEST_RESULT_EMAIL_TO not set; skipping test report email.');
    return;
  }

  const to = recipientsEnv
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (to.length === 0) {
    logger.warn('TEST_RESULT_EMAIL_TO is empty after parsing; skipping test report email.');
    return;
  }

  const status = (process.env.TEST_STATUS ?? 'unknown').toLowerCase();
  const coverage = loadCoverageSummary();

  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const runUrl =
    repository && runId ? `https://github.com/${repository}/actions/runs/${runId}` : undefined;

  const workflowName = process.env.GITHUB_WORKFLOW ?? 'CI';
  const branch = process.env.GITHUB_REF_NAME;
  const commitSha = process.env.GITHUB_SHA;
  const actor = process.env.GITHUB_ACTOR;
  const dateTime = new Date().toISOString();

  const subject = `${PROJECT_SLUG} ${workflowName} tests: ${status.toUpperCase()}`;
  const reportContext = omitUndefined({
    runUrl,
    workflowName,
    branch,
    commitSha,
    actor,
    dateTime,
  });
  const text = buildTextBody(status, coverage, reportContext);
  const html = buildHtmlBody(status, coverage, reportContext);

  const messageId = await sendEmail({
    to,
    subject,
    text,
    html,
    tags: [
      { name: 'type', value: 'test-report' },
      { name: 'status', value: status },
    ],
  });

  if (!messageId) {
    logger.warn({ to }, 'test-report.email.send.failed');
  } else {
    logger.info({ to, messageId }, 'test-report.email.send.success');
  }
}

void main();
