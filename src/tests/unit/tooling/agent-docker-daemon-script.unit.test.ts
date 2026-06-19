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

  it('falls back to vfs storage when cloud overlay layer extraction is denied', () => {
    expect(ensureDockerDaemonScript).toContain('--storage-driver=vfs');
    expect(ensureDockerDaemonScript).toContain('--data-root="${VFS_DATA_ROOT}"');
    expect(ensureDockerDaemonScript).toContain('DOCKERD_AGENT_VFS_DATA_ROOT');
    expect(ensureDockerDaemonScript).toContain('restricted-vfs');
  });

  it('uses the shared cloud-agent host-network compose override in restricted Docker mode', () => {
    expect(bootstrapScript).toContain('docker-compose.cloud-agent.yml');
    expect(bootstrapScript).toContain('DOCKERD_AGENT_MODE_FILE');
    expect(bootstrapScript).toContain('restricted*');
  });
});
