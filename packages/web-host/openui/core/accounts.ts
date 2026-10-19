import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/** Read only the CLI's documented non-sensitive account listing. */
export function readWebUiAdminUsername(binary: string, dataDir: string): string {
  const output = execFileSync(binary, ['--data-dir', dataDir, 'user', 'list'], { encoding: 'utf8', timeout: 30000 });
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith('system_default_user '));
  const username = line?.trim().split(/\s+/)[2];
  return username && username !== '-' ? username : 'admin';
}

/** Use Core's local CLI for bootstrap/reset; passwords never enter argv or a shell. */
export function resetWebUiPassword(binary: string, dataDir: string, username?: string): string {
  const password = 'Aa1!' + randomBytes(24).toString('base64url');
  execFileSync(
    binary,
    ['--data-dir', dataDir, 'user', 'set-password', '--password-stdin', ...(username ? ['--username', username] : [])],
    {
      input: password + '\n',
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
  return password;
}
