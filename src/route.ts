/** The clean output window lives at /output (or ?output for static hosting). */
export function isOutputRoute(loc: { pathname: string; search: string }): boolean {
  return /\/output\/?$/.test(loc.pathname) || new URLSearchParams(loc.search).has('output');
}
