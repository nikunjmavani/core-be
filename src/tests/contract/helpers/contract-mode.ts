/**
 * When CONTRACT_RECORD is enabled, callers may allow outbound HTTPS (recording script only).
 */
export function isContractFixtureRecordingEnabled(): boolean {
  return process.env.CONTRACT_RECORD === 'true' || process.env.CONTRACT_RECORD === '1';
}
