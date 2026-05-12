/**
 * Minimal POSIX-style command tokenizer for session alias templates.
 *
 * Splits a single-line command string into a command + args array, preserving
 * runs inside single or double quotes as one token. Does NOT expand $VAR,
 * backticks, or `$(...)`, and does NOT interpret pipes / redirects — the
 * result is passed straight to a direct exec, not to a shell. If the user
 * wants shell features, they write `bash -c '<pipeline>'` as the template
 * and the `<pipeline>` becomes a single argument to bash.
 *
 * Examples:
 *   `wsl -d Ubuntu`               → { command: 'wsl', args: ['-d', 'Ubuntu'] }
 *   `wsl -d "Ubuntu 22.04"`       → { command: 'wsl', args: ['-d', 'Ubuntu 22.04'] }
 *   `bash -c 'echo hi | grep h'`  → { command: 'bash', args: ['-c', 'echo hi | grep h'] }
 */
export function parseCommandString(s: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  const re = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[0]);
  }
  if (tokens.length === 0) throw new Error('Empty command');
  return { command: tokens[0], args: tokens.slice(1) };
}
