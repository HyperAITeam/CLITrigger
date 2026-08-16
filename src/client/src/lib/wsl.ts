// WSL projects are stored as their UNC path (\\wsl.localhost\<distro>\...), so
// the distro and the Linux path are both derivable from the path alone.
const WSL_UNC_RE = /^[\\/]{2}wsl(?:\.localhost|\$)[\\/]([^\\/]+)(?:[\\/](.*))?$/i;

export function parseWslPath(p: string | undefined | null): { distro: string; linuxPath: string } | null {
  const m = p ? WSL_UNC_RE.exec(p) : null;
  if (!m) return null;
  const rest = (m[2] ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  return { distro: m[1], linuxPath: `/${rest}` };
}

/** Path to show the user: WSL projects read as their Linux path, not the UNC one. */
export function displayPath(p: string): string {
  return parseWslPath(p)?.linuxPath ?? p;
}
