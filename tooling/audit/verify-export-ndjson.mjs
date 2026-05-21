#!/usr/bin/env node
/**
 * Validates audit export NDJSON (gzip file, plain file, or stdin).
 *
 * Usage:
 *   node tooling/audit/verify-export-ndjson.mjs path/to/part-uuid.jsonl.gz
 *   gunzip -c path/to/part-uuid.jsonl.gz | node tooling/audit/verify-export-ndjson.mjs
 *
 * Exit 0 when every non-empty line is valid JSON with expected audit fields.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const REQUIRED_FIELDS = ['id', 'organization_id', 'action', 'created_at'];

function readInputBuffer() {
  const filePath = process.argv[2];
  if (filePath) {
    const raw = readFileSync(filePath);
    return filePath.endsWith('.gz') ? gunzipSync(raw) : raw;
  }

  const buffer = readFileSync(0);
  return buffer.length > 0 && buffer[0] === 0x1f && buffer[1] === 0x8b
    ? gunzipSync(buffer)
    : buffer;
}

function validateNdjson(buffer) {
  const text = buffer.toString('utf8');
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error('export contains no NDJSON lines');
  }

  let lineNumber = 0;
  for (const line of lines) {
    lineNumber += 1;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `line ${lineNumber}: invalid JSON — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const field of REQUIRED_FIELDS) {
      if (record[field] === undefined || record[field] === null) {
        throw new Error(`line ${lineNumber}: missing required field "${field}"`);
      }
    }
  }

  return { lineCount: lines.length };
}

try {
  const { lineCount } = validateNdjson(readInputBuffer());
  console.log(`OK: ${lineCount} NDJSON line(s) validated`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
