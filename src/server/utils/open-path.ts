import { execFile } from 'child_process';
import path from 'path';

// Open a file/folder with the OS default handler, or reveal a file in the file
// manager. Uses execFile (argv array, no shell) so a path containing shell
// metacharacters — e.g. an agent-created filename like `$(touch pwned).md` —
// cannot inject a command. Exit codes from explorer/open are ignored.
export function osOpenPath(target: string, opts: { reveal?: boolean } = {}): void {
  const done = () => { /* noisy exit codes; ignore */ };
  if (process.platform === 'win32') {
    execFile('explorer.exe', [opts.reveal ? `/select,${target}` : target], done);
  } else if (process.platform === 'darwin') {
    execFile('open', opts.reveal ? ['-R', target] : [target], done);
  } else {
    execFile('xdg-open', [opts.reveal ? path.dirname(target) : target], done);
  }
}
