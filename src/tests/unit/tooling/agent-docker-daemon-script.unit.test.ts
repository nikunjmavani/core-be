import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ensureDockerDaemonScript = readFileSync(
  'tooling/setup/agent/ensure-docker-daemon.sh',
  'utf8',
);
const bootstrapScript = readFileSync('tooling/setup/agent/bootstrap.sh', 'utf8');

describe('agent Docker daemon setup scripts', () => {
  it('falls back to restricted dockerd flags when cloud iptables setup is denied', () => {
    expect(ensureDockerDaemonScript).toContain('--iptables=false');
    expect(ensureDockerDaemonScript).toContain('--ip-masq=false');
    expect(ensureDockerDaemonScript).toContain('--bridge=none');
    expect(ensureDockerDaemonScript).toContain('DOCKERD_AGENT_MODE_FILE');
  });

  it('uses the Codex Cloud host-network compose override in restricted Docker mode', () => {
    expect(bootstrapScript).toContain('docker-compose.codex-cloud.yml');
    expect(bootstrapScript).toContain('DOCKERD_AGENT_MODE_FILE');
  });
});
