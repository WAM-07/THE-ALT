#!/usr/bin/env node
// Sets up ALT's ML service (services/ml) once: a Python virtualenv, its packages and the pinned models.
//   npm run ml:setup        (needs Python 3.10+ as `python` or `python3`)
// `npm run dev` then starts it automatically; without it, moderation uses ALT's rules alone.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'services', 'ml');
const venv = process.env.ALT_ML_VENV || path.join(dir, '.venv');
const py = process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: dir, ...opts });
  if (r.status !== 0) {
    console.error(`\n✖ ${cmd} ${args.join(' ')} failed`);
    process.exit(1);
  }
};

if (!existsSync(py)) {
  const system = ['python3', 'python'].find((c) => spawnSync(c, ['--version']).status === 0);
  if (!system) {
    console.error('✖ Python 3.10+ is needed (python or python3 on PATH).');
    process.exit(1);
  }
  console.log(`creating the virtualenv in ${venv}…`);
  run(system, ['-m', 'venv', venv]);
}
console.log('installing packages…');
run(py, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '-r', 'requirements.txt']);
console.log('downloading the models (pinned revisions, about 145 MB the first time)…');
run(py, ['models.py']);
console.log('✓ ML service ready; `npm run dev` starts it on 127.0.0.1:4500.');
