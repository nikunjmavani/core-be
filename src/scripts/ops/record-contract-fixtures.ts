/**
 * Placeholder for live fixture capture. Contract tests use committed JSON under `src/tests/contract/fixtures/`.
 * For a full re-recording flow, start `nock.recorder.rec({ output_objects: true })`, invoke sandbox SDK calls,
 * then dump `nock.recorder.play()` and redact secrets before committing.
 */
import '@/shared/config/load-env-files.js';

function mainOutbound(): void {
  if (process.env.CONTRACT_RECORD !== 'true' && process.env.CONTRACT_RECORD !== '1') {
    console.log('Set CONTRACT_RECORD=1 to show recording instructions.');
    return;
  }

  console.log(
    [
      'Recording workflow (manual):',
      '1. Use sk_test_ / re_test_ / dedicated S3 sandbox credentials in .env.',
      '2. In a scratch script, wrap vendor HTTP calls with nock.recorder.rec({ output_objects: true, dont_print: true }).',
      '3. Call nock.restore(), then JSON.stringify(nock.recorder.play()) and redact Authorization / ids.',
      '4. Save sanitized objects under src/tests/contract/fixtures/ — see README there.',
    ].join('\n'),
  );
}

mainOutbound();
