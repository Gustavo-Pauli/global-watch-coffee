import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workerDir = fileURLToPath(new URL('../', import.meta.url));
const venvPython = fileURLToPath(new URL(
  process.platform === 'win32' ? '../.venv/Scripts/python.exe' : '../.venv/bin/python',
  import.meta.url,
));
const python = existsSync(venvPython) ? venvPython : 'python';
const result = spawnSync(python, process.argv.slice(2), {
  cwd: workerDir,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Could not run ${python}: ${result.error.message}`);
}
process.exit(result.status ?? 1);
