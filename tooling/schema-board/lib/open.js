// Open a URL in the default browser (zero deps). Best-effort; ignore failures.

'use strict';

const { spawn } = require('child_process');

function openUrl(url) {
  if (!url) return;
  const platform = process.platform;
  let cmd;
  let args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch { /* headless / CI */ }
}

module.exports = { openUrl };
