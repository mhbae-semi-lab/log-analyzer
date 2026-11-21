// 성능 측정: node tools/bench.mjs [MB]  (기본 100)
// 합성 로그를 MB 만큼 만들고, 파서(Worker 와 같은 코드)로 8MB 조각씩 읽은 뒤 발생 · 군집 · 직전 경고까지 계산한다.
import { generateBig } from "../src/gen.js";
import { createReader } from "../src/parse.js";
import * as A from "../src/analyze.js";

const mb = Number(process.argv[2] || 100);
const t0 = performance.now();
const text = generateBig(mb * 1048576, 11);
const bytes = Buffer.byteLength(text);
const tGen = performance.now() - t0;

const t1 = performance.now();
const rd = createReader({ format: "auto", tz: 0 });
const CH = 8 << 20;
let rest = "";
for (let off = 0; off < text.length; off += CH) {
  const s = rest + text.slice(off, off + CH);
  const cut = s.lastIndexOf("\n");
  rd.push(s.slice(0, cut).split("\n"));
  rest = s.slice(cut + 1);
}
if (rest) rd.push([rest]);
const res = rd.end();
const tParse = performance.now() - t1;

const t2 = performance.now();
A.assignCodes(res.entries, A.compileDict());
const eps = A.episodes(res.entries, 120e3);
const cls = A.clusters(eps);
const warns = res.entries.filter((e) => e.sev === 2);
for (const c of cls) A.precursors(res.entries, c, 10 * 60e3, warns);
const tAnalyze = performance.now() - t2;

const out = {
  sizeMB: +(bytes / 1048576).toFixed(1), lines: res.lines, entries: res.entries.length, bad: res.badCount,
  episodes: eps.length, clusters: cls.length,
  parseSec: +(tParse / 1000).toFixed(2), analyzeSec: +(tAnalyze / 1000).toFixed(2), totalSec: +((tParse + tAnalyze) / 1000).toFixed(2),
  MBps: +(bytes / 1048576 / (tParse / 1000)).toFixed(1), heapMB: Math.round(process.memoryUsage().heapUsed / 1048576), genSec: +(tGen / 1000).toFixed(1),
  node: process.version,
};
console.log(JSON.stringify(out));
