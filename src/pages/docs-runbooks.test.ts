import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The commands the API Docs page tells an operator to run. Each must be a real ./hive.sh
// subcommand (Hive's `hive.sh --help`) or a plain health read, never a script that does not exist.
const HIVE_SH = ['init', 'plan', 'install', 'status', 'doctor', 'upgrade', 'post-upgrade', 'setup', 'rollback', 'backup', 'backups', 'adopt', 'restore', 'rehearse', 'add', 'registry', 'migrate-native', 'tls-refresh', 'console-clients', 'admin-access'];

describe('API Docs runbooks', () => {
  const source = readFileSync(new URL('./docs.tsx', import.meta.url), 'utf8');
  const commands = [...source.matchAll(/command:\s*'([^']+)'/g)].map((match) => match[1]!);

  it('cite only commands that exist', () => {
    expect(commands.length).toBeGreaterThan(5);
    const unknown = commands.filter((command) => {
      const hive = /^\.\/hive\.sh ([a-z-]+)\b/.exec(command);
      if (hive) return !HIVE_SH.includes(hive[1]!);
      // A step in the console itself, such as "Oathweave sign-in → Forgot password?".
      if (command.includes(' → ')) return false;
      return !/^curl --fail https:\/\/[a-z.]+example\.com\//.test(command);
    });
    expect(unknown).toEqual([]);
    expect(commands.filter((command) => /\bnpm run\b/.test(command))).toEqual([]);
  });
});
