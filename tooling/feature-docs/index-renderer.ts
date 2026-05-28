/**
 * Renders `src/DOCS.md` — the top-level catalog index that links every other
 * `DOCS.md` and surfaces the four system-narrative files at `src/` root.
 *
 * Phase 1 layout (locked in Phase 3):
 *   1. Path on line 1.
 *   2. Generated banner.
 *   3. System narratives table (4 rows: OVERVIEW / PATTERNS / FLOWS / POLICIES).
 *   4. Per-area documented folder index (Domains, Infrastructure, Shared, Scripts, Core, Tests).
 *   5. Counts header (folders documented, routes catalogged, exports catalogged).
 *
 * Folders that lack a required system-narrative file produce a
 * `MISSING_SYSTEM_FILE` token next to the affected row.
 */
import { join } from 'node:path';
import {
  DOCS_GENERATED_BANNER,
  MISSING_SYSTEM_FILE_TOKEN,
  SRC_DOCS_INDEX_FILENAME,
  SRC_ROOT,
} from './constants.js';
import type { DocumentedFolder, GeneratorReport, SystemDocuments } from './types.js';

interface RenderInput {
  documentedFolders: DocumentedFolder[];
  systemDocuments: SystemDocuments;
  report: GeneratorReport;
}

export function renderSrcDocsIndex(input: RenderInput): { absolutePath: string; contents: string } {
  const { documentedFolders, systemDocuments, report } = input;
  const lines: string[] = [];

  lines.push('`src/`');
  lines.push('');
  lines.push(DOCS_GENERATED_BANNER);
  lines.push('');
  lines.push('# Platform documentation index');
  lines.push('');
  lines.push(
    'Co-located documentation across five scales — system, cross-cutting, folder, symbol, and algorithm. ' +
      'See `src/OVERVIEW.md` for the system entry point.',
  );
  lines.push('');

  appendSystemNarrativesTable(lines, systemDocuments);
  appendCountsBlock(lines, report);
  appendDocumentedFoldersByArea(lines, documentedFolders);

  const absolutePath = join(SRC_ROOT, SRC_DOCS_INDEX_FILENAME);
  return { absolutePath, contents: `${lines.join('\n')}\n` };
}

function appendSystemNarrativesTable(lines: string[], systemDocuments: SystemDocuments): void {
  lines.push('## System narratives');
  lines.push('');
  lines.push('| File | Purpose | Status |');
  lines.push('| --- | --- | --- |');
  lines.push(
    `| [src/OVERVIEW.md](./OVERVIEW.md) | System entry-point: architecture, domains, patterns, flows, policies, tech stack. | ${describeSystemFileStatus(systemDocuments.overview)} |`,
  );
  lines.push(
    `| [src/PATTERNS.md](./PATTERNS.md) | Cross-cutting patterns catalog (tenant-isolation, audit-emission, idempotency, soft-delete, RLS context, transactional outbox). | ${describeSystemFileStatus(systemDocuments.patterns)} |`,
  );
  lines.push(
    `| [src/FLOWS.md](./FLOWS.md) | End-to-end feature journeys (signup, login, subscription change, organization invitation, dunning). | ${describeSystemFileStatus(systemDocuments.flows)} |`,
  );
  lines.push(
    `| [src/POLICIES.md](./POLICIES.md) | Business policy constants with rationale, consequences, and last review. | ${describeSystemFileStatus(systemDocuments.policies)} |`,
  );
  lines.push('');
}

function describeSystemFileStatus(systemFile: SystemDocuments['overview']): string {
  if (!systemFile.exists) return MISSING_SYSTEM_FILE_TOKEN;
  if (systemFile.missingRequiredSections.length > 0) {
    return `${MISSING_SYSTEM_FILE_TOKEN} missing sections: ${systemFile.missingRequiredSections.join(', ')}`;
  }
  return 'OK';
}

function appendCountsBlock(lines: string[], report: GeneratorReport): void {
  lines.push('## Counts');
  lines.push('');
  lines.push(`- Folders documented: ${report.documentedFolders}`);
  lines.push(`- Routes catalogged: ${report.routesCatalogged}`);
  lines.push(`- Exports catalogged: ${report.exportsCatalogged}`);
  if (Object.keys(report.missingTokenCounts).length > 0) {
    lines.push('- Missing tokens (Phase 1 informational; hard-gated in Phase 3):');
    for (const [token, count] of Object.entries(report.missingTokenCounts).sort()) {
      lines.push(`  - \`${token}\` × ${count}`);
    }
  }
  lines.push('');
}

function appendDocumentedFoldersByArea(
  lines: string[],
  documentedFolders: DocumentedFolder[],
): void {
  const areaBuckets: Array<{ heading: string; matcher: (folder: DocumentedFolder) => boolean }> = [
    {
      heading: 'Domains',
      matcher: (folder) =>
        folder.role === 'domain' ||
        folder.role === 'sub-domain' ||
        folder.role === 'nested-sub-domain',
    },
    { heading: 'Infrastructure', matcher: (folder) => folder.role === 'infrastructure-module' },
    { heading: 'Shared', matcher: (folder) => folder.role === 'shared-module' },
    { heading: 'Scripts', matcher: (folder) => folder.role === 'scripts-area' },
    { heading: 'Core', matcher: (folder) => folder.role === 'core-area' },
    { heading: 'Tests', matcher: (folder) => folder.role === 'tests-suite' },
    { heading: 'Other', matcher: (folder) => folder.role === 'generic' },
  ];

  for (const bucket of areaBuckets) {
    const folders = documentedFolders.filter(bucket.matcher);
    if (folders.length === 0) continue;
    lines.push(`## ${bucket.heading}`);
    lines.push('');
    for (const folder of folders) {
      const purpose = folder.overview?.purposeFirstParagraph ?? null;
      const purposeSuffix = purpose ? ` — ${truncateInline(purpose)}` : '';
      const relativeFromSrc = folder.relativePath.replace(/^src\//, '');
      lines.push(`- [\`${folder.relativePath}/\`](./${relativeFromSrc}/DOCS.md)${purposeSuffix}`);
    }
    lines.push('');
  }
}

function truncateInline(value: string): string {
  const single = value.replace(/\n+/g, ' ').trim();
  if (single.length <= 160) return single;
  return `${single.slice(0, 160)}…`;
}
