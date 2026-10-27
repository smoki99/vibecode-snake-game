/** Kill processes whose command line contains the given argument (used to retire one superseded run). */
const { readdirSync, readFileSync } = await import('node:fs');
const needle = process.argv[2];
if (!needle) throw new Error('usage: kill-matching.mjs <substring>');
const skip = new Set([Number(process.pid), Number(process.ppid)]);
let killed = 0;
for (const name of readdirSync('/proc')) {
  if (!/^\d+$/.test(name) || skip.has(Number(name))) continue;
  let cmd = '';
  try {
    cmd = readFileSync(`/proc/${name}/cmdline`, 'utf8').replaceAll('\0', ' ');
  } catch {
    continue;
  }
  if (cmd.includes(needle)) {
    try {
      process.kill(Number(name), 'SIGKILL');
      killed += 1;
    } catch {
      /* gone */
    }
  }
}
console.log(JSON.stringify({ killed }));
