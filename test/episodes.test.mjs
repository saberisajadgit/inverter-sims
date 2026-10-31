// Episode checks, SIM_SPEC §9.2: every scenario's `expect` block and every
// `expectAcross` claim must hold. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run, buildCase } from '../lib/engine/simulate.js';
import { checkExpect, metric } from '../lib/engine/metrics.js';

const EP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../episodes');
const episodes = fs.readdirSync(EP_DIR).filter((d) => fs.existsSync(path.join(EP_DIR, d, 'scenarios.js')));

for (const name of episodes) {
  const ep = (await import(pathToFileURL(path.join(EP_DIR, name, 'scenarios.js')).href)).default;
  const results = {};   // results[scenarioId][caseId] = TimeSeries

  ep.scenarios.forEach((sc, si) => {
    test(`${name} · ${si + 1}/${ep.scenarios.length} ${sc.id}`, (t) => {
      results[sc.id] = {};
      ep.cases.forEach((c, ci) => {
        const ts = run(buildCase(ep, ci, si));
        results[sc.id][c.id] = ts;
        assert.ok(ts.meta.steady.ok, `${c.id}: not in steady state at window start`);
        t.diagnostic(`${c.id}: |I|end ${metric(ts, 'Iend').toFixed(3)}, first peak ${metric(ts, 'firstPeak').toFixed(2)}, |V|end ${metric(ts, 'Vend').toFixed(3)}`);
        const fails = checkExpect(ts, sc.expect?.[c.id]);
        assert.deepEqual(fails, [], `${c.id}: ${fails.join('; ')}`);
      });
    });
  });

  for (const x of ep.expectAcross || []) {
    test(`${name} · across: ${x.what}`, (t) => {
      const vals = x.scenarios.map((id) => metric(results[id][x.case], x.metric));
      t.diagnostic(`${x.metric}: ${x.scenarios.map((id, k) => `${id} ${vals[k].toFixed(3)}`).join(', ')}`);
      for (let k = 1; k < vals.length; k++) {
        const step = x.order === 'decreasing' ? vals[k - 1] - vals[k] : vals[k] - vals[k - 1];
        assert.ok(step >= (x.minStep ?? 0), `${x.scenarios[k - 1]} → ${x.scenarios[k]}: step ${step.toFixed(3)}`);
      }
    });
  }
}
