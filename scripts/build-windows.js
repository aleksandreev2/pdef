'use strict';
// Build a self-contained installer. Downloads happen only on the developer's PC.
const path = require('path');
const {spawnSync} = require('child_process');
const root = path.resolve(__dirname, '..');
function run(command, args) {
  const env = {...process.env};
  // PowerShell 7 module paths cannot be inherited by Windows PowerShell 5.1.
  if (command === 'powershell.exe') delete env.PSModulePath;
  const result = spawnSync(command, args, {cwd: root, env, stdio: 'inherit', windowsHide: true});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} завершился с кодом ${result.status}`);
}
if (process.platform !== 'win32') throw new Error('Сборка полного Windows-установщика выполняется на Windows.');
run(process.execPath, ['scripts/fetch-fonts.mjs']);
run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/prepare-windows.ps1']);
const args = [require.resolve('electron-builder/cli'), '--win', '--x64', '--publish', 'never'];
if (process.env.PDFMAKER_ELECTRON_DIST) args.push(`--config.electronDist=${process.env.PDFMAKER_ELECTRON_DIST}`);
run(process.execPath, args);
