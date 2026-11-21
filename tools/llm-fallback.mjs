// 실제 모델로 "LLM 검증 실패 시 규칙 대체율"을 잰다 (로컬 Ollama).
//   node tools/llm-fallback.mjs [모델=qwen2.5:3b] [주소=http://localhost:11434]
// 예시 로그(합성)의 군집 5개 × 직전 구간 5 · 10 · 30분 × 한/영 = 30회.
// 앱과 같은 코드 · 기본값(프롬프트 · 마스킹 · 검증 · 1회 재시도 · 시간 제한 90초)을 쓰고, 결과를 docs/measurements/ 에 JSON 으로 남긴다.
import { writeFileSync, mkdirSync } from "node:fs";
import { parseText } from "../src/parse.js";
import { generate } from "../src/gen.js";
import * as A from "../src/analyze.js";
import { runValidated, mask, compileMasks } from "../src/llm.js";

const model = process.argv[2] || "qwen2.5:3b";
const url = process.argv[3] || "http://localhost:11434";
const MIN = 60e3;

const entries = parseText(generate(), { format: "iso", tz: 0 }).entries;
A.assignCodes(entries, A.compileDict());
const cls = A.clusters(A.episodes(entries, 120e3));
const byLine = new Map(entries.map((e) => [e.n, e]));
const masks = compileMasks(true, "");

// 검증 실패 사유 분류 (한/영 문구 공통)
const kind = (s) => /없는 줄|not in the evidence/.test(s) ? "fake_line" : /수치|numbers not in/.test(s) ? "number" : /확신도|confidence/.test(s) ? "confidence"
  : /근거 줄 없음|no evidence/.test(s) ? "no_evidence" : /최대|max 3/.test(s) ? "too_many" : /원인 문장|cause sentence|No cause|원인 후보 없음/.test(s) ? "sentence" : "other";

const rows = [];
const t00 = performance.now();
for (const lang of ["ko", "en"]) {
  for (const lb of [5, 10, 30]) {
    for (const c of cls) {
      const pre = A.precursors(entries, c, lb * MIN), pool = A.evidencePool(entries, c, lb * MIN);
      const prompt = mask(A.promptFor(c, pre, pool, lang), masks).text;
      const rule = A.ruleCauses(c, pre, lang);
      const t0 = performance.now();
      const res = await runValidated({ provider: "ollama", model, ollamaUrl: url, prompt, pool, lang, timeoutS: 90, ctx: null });
      const sec = (performance.now() - t0) / 1000;
      const reasons = res.log.flatMap((l) => (l.bad ? l.bad.map(kind) : l.error ? [l.error === "error" ? "parse" : l.error] : []));
      const row = { code: c.code, lang, lookbackMin: lb, poolLines: pool.length, valid: res.valid, attempts: res.attempts,
        firstTry: !!res.log[0]?.ok, agree: res.valid ? A.agree(rule, res.out, byLine) : null, sec: +sec.toFixed(1), reasons,
        llmTop: res.valid ? res.out.causes[0]?.cause : null };
      rows.push(row);
      console.log(`${lang} ${String(lb).padStart(2)}m ${c.code.padEnd(5)} ${row.valid ? (row.firstTry ? "pass" : "pass(retry)") : "FALLBACK"} ${row.sec}s ${reasons.join(",")}`);
    }
  }
}
const n = rows.length;
const valid = rows.filter((r) => r.valid);
const count = (k) => rows.flatMap((r) => r.reasons).filter((x) => x === k).length;
const secs = rows.map((r) => r.sec).sort((a, b) => a - b);
const summary = {
  model, runs: n, date: new Date().toISOString().slice(0, 10),
  firstTryPass: rows.filter((r) => r.firstTry).length,
  passAfterRetry: valid.length - rows.filter((r) => r.firstTry).length,
  fallback: n - valid.length,
  fallbackRate: +((n - valid.length) / n).toFixed(3),
  agreeWithRules: valid.filter((r) => r.agree).length,
  agreeRate: valid.length ? +(valid.filter((r) => r.agree).length / valid.length).toFixed(3) : null,
  failureReasons: Object.fromEntries(["fake_line", "number", "confidence", "no_evidence", "too_many", "sentence", "parse", "timeout", "network", "other"].map((k) => [k, count(k)]).filter(([, v]) => v)),
  medianSec: secs[n >> 1], totalMin: +((performance.now() - t00) / 60e3).toFixed(1),
  byLang: Object.fromEntries(["ko", "en"].map((l) => { const x = rows.filter((r) => r.lang === l); return [l, { runs: x.length, fallback: x.filter((r) => !r.valid).length }]; })),
};
console.log(JSON.stringify(summary, null, 1));
mkdirSync(new URL("../docs/measurements/", import.meta.url), { recursive: true });
writeFileSync(new URL(`../docs/measurements/llm-fallback-${model.replace(/[^\w.-]+/g, "-")}.json`, import.meta.url), JSON.stringify({ summary, rows }, null, 1));
