/**
 * Kill wedged browser instances and orphaned test runners left behind by killed runs, or report them
 * with --dry. Lives in a file on purpose: the match patterns must not appear in the command line of
 * the shell that invokes it, or it kills its own parent.
 */
const { readdirSync, readFileSync } = await import('node:fs');

const STALE = /headless_shell|chrome_crashpad|[/-]chromium[ _-]|--t.?est .*\.spec\.mjs/;
const self = Number(process.pid);
const skip = new Set([self, Number(process.ppid)]);
const dry = process.argv.includes('--dry');

let killed = 0;
const seen = [];
for (const name of readdirSync('/proc')) {
  if (!/^\d+$/.test(name) || skip.has(Number(name))) continue;
  let cmd = '';
  try {
    cmd = readFileSync(`/proc/${name}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
  } catch {
    continue;
  }
  if (cmd === '' || !STALE.test(cmd)) continue;
  seen.push(`${name} ${cmd.slice(0, 70)}`);
  if (dry) continue;
  try {
    process.kill(Number(name), 'SIGKILL');
    killed += 1;
  } catch {
    /* already gone */
  }
}
console.log(JSON.stringify({ dry, killed, matches: seen.length }, null, 2));
for (const line of seen.slice(0, 12)) console.log(line);
