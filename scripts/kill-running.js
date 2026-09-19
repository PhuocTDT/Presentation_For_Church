const { execSync } = require('child_process');

if (process.platform === 'win32') {
  const procs = ['Presentation For Church.exe', 'electron.exe', 'cloudflared.exe'];
  for (const proc of procs) {
    try {
      execSync(`taskkill /F /IM "${proc}" /T`, { stdio: 'ignore' });
      console.log(`[Kill] Terminated process: ${proc}`);
    } catch (e) {
      // Process was not running, ignore
    }
  }
}
