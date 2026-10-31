// Screenshots of an episode at given video times (SIM_SPEC §8.3).
// usage: node tools/snap.mjs <episode dir> 0,3.2,7.5 [linkedin|youtube|square]
// Needs `npm run serve` running. Uses the locally installed Chrome/Edge in
// headless mode (no dependencies); the page opens at ?t=<time> in render mode.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [, , ep, timesArg = '0', fmt = 'linkedin'] = process.argv;
if (!ep) { console.error('usage: node tools/snap.mjs <episode dir> <t1,t2,...> [linkedin|youtube|square]'); process.exit(1); }
const SIZES = { linkedin: [1080, 1350], youtube: [1920, 1080], square: [1080, 1080] };
const [W, H] = SIZES[fmt];

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);
const browser = CANDIDATES.find((p) => fs.existsSync(p));
if (!browser) { console.error('no Chrome/Edge found; set CHROME=<path>'); process.exit(1); }

const outDir = path.resolve('output/snaps');
fs.mkdirSync(outDir, { recursive: true });
const epPath = ep.replace(/\\/g, '/').replace(/\/$/, '');
const name = path.basename(epPath);

for (const t of timesArg.split(',').map(Number)) {
  const out = path.join(outDir, `${name}_${fmt}_${t.toFixed(2)}s.png`);
  const url = `http://localhost:5173/${epPath}/index.html?render=1&w=${W}&h=${H}&t=${t}`;
  execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${W},${H}`, '--virtual-time-budget=10000', `--screenshot=${out}`, url,
  ], { stdio: 'ignore' });
  console.log(out);
}
