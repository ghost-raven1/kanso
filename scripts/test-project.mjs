import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
export const run = (root, command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });
export async function start(root, args, port, env = {}) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) return { child, logs: () => logs }; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill(); throw new Error(`Server did not start: ${logs}`);
}
export async function stop(server) {
  if (!server || server.child.exitCode !== null) return;
  await new Promise(resolve => { server.child.once('exit', resolve); server.child.kill('SIGTERM'); });
}
export const viteArgs = (command, port) => [resolve('node_modules/vite/bin/vite.js'), ...(command ? [command] : []), '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
