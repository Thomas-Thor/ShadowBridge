import { spawnSync } from 'node:child_process';
import { root, envFile } from './dev-env.mjs';

// Intentionally no --volumes: stopping the stack preserves all local data.
const result = spawnSync('docker', ['compose', '--env-file', envFile, '-f', 'local/compose.yaml', 'down'], { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
