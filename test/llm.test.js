import { test } from "node:test";
import assert from "node:assert/strict";
import * as A from "../src/analyze.js";
import { parseText } from "../src/parse.js";
import { generate } from "../src/gen.js";
import { sampleCauses } from "../src/sample-causes.js";
import { mask, compileMasks, runValidated, mockAnswer } from "../src/llm.js";

const MIN = 60e3;
function clustersCtx(lang = "ko") {
  const entries = parseText(generate(), { format: "iso", tz: 0 }).entries;
  A.assignCodes(entries, A.compileDict());
  const cls = A.clusters(A.episodes(entries, 120e3));
  return cls.map((c) => {
    const pre = A.precursors(entries, c, 10 * MIN), pool = A.evidencePool(entries, c, 10 * MIN);
    return { c, pre, pool, prompt: A.promptFor(c, pre, pool, lang), rule: A.ruleCauses(c, pre, lang) };
  });
}

test("마스킹: 같은 값은 같은 표지, 그룹이 있으면 그 부분만, 사용자 정규식", () => {
  const m = mask("from 10.0.0.12 to 10.0.0.12 and 10.0.0.13 id=OP-07 lot=SC001101 C:\\logs\\a.log recipe=R-77", compileMasks(true, "recipe=(\\S+)"));
  assert.equal(m.text, "from [IP-1] to [IP-1] and [IP-2] id=[ID-1] lot=[LOT-1] [PATH-1] recipe=[X1-1]");
  assert.equal(m.masked, 7);
  assert.equal(m.values, 6);
  assert.equal(mask("nothing here", compileMasks(true)).masked, 0);
  assert.equal(compileMasks(false, "[unclosed\nok=(\\d+)").length, 1);
});

test("검증기: 정상 출력에 결함 5종을 넣으면 전부 잡는다 (놓침 0)", () => {
  let injected = 0, caught = 0;
  for (const x of clustersCtx()) {
    const ex = sampleCauses(x.c.code, "ko");
    const good = { causes: ex.causes.map((y) => ({ ...y, evidence: A.resolvePatterns(x.pool, y.patterns) })), checks: ex.checks };
    assert.deepEqual(A.validateCauses(good, x.pool, x.prompt, "ko"), []);
    const faults = [
      (o) => { o.causes[0].evidence.push(987654); },
      (o) => { o.causes[0].reasoning += " 42.42"; },
      (o) => { o.causes[0].evidence = []; },
      (o) => { o.causes[0].confidence = "certain"; },
      (o) => { o.causes = [...o.causes, ...o.causes, ...o.causes].slice(0, 4); if (o.causes.length < 4) o.causes.push(o.causes[0]); },
    ];
    for (const f of faults) {
      const o = structuredClone(good);
      f(o);
      injected++;
      if (A.validateCauses(o, x.pool, x.prompt, "ko").length) caught++;
    }
  }
  assert.equal(caught, injected);
});

test("검증 · 재시도 · 대체: 모의 응답으로 대체율을 잰다", async () => {
  const rows = [];
  for (const x of clustersCtx("ko")) {
    const ctx = { pool: x.pool, pre: x.pre, code: x.c.code, lang: "ko" };
    const res = await runValidated({ provider: "mock", prompt: x.prompt, pool: x.pool, lang: "ko", ctx }, async (o) => mockAnswer(o.ctx, o.attempt));
    rows.push({ code: x.c.code, valid: res.valid, attempts: res.attempts });
  }
  const fallback = rows.filter((r) => !r.valid).length;
  // 근거가 약한 C401 · L104 는 두 번 다 수치를 지어내 규칙 결과로 대체, L103 은 1차 실패 후 재시도로 통과
  assert.deepEqual(rows.filter((r) => !r.valid).map((r) => r.code).sort(), ["C401", "L104"]);
  assert.equal(rows.find((r) => r.code === "L103").attempts, 2);
  assert.equal(fallback / rows.length, 0.4);
});

test("호출 오류: 취소 · 키 오류는 재시도하지 않고, 형식 오류는 재시도한다", async () => {
  const x = clustersCtx()[0];
  let calls = 0;
  const canceled = await runValidated({ prompt: x.prompt, pool: x.pool, lang: "en" }, async () => { calls++; const e = new Error("canceled"); e.kind = "canceled"; throw e; });
  assert.equal(calls, 1);
  assert.equal(canceled.valid, false);
  calls = 0;
  const parseFail = await runValidated({ prompt: x.prompt, pool: x.pool, lang: "en" }, async () => { calls++; throw new SyntaxError("Unexpected token"); });
  assert.equal(calls, 2);
  assert.equal(parseFail.log.length, 2);
});

test("LLM 출력의 확신도 대소문자는 정규화한다", async () => {
  const x = clustersCtx()[1];
  const ev = x.rule.causes[0].evidence;
  const res = await runValidated({ prompt: x.prompt, pool: x.pool, lang: "ko" }, async () => ({ out: { causes: [{ cause: "c", reasoning: "r", evidence: ev, confidence: "HIGH" }], checks: [] }, model: "t" }));
  assert.equal(res.valid, true);
  assert.equal(res.out.causes[0].confidence, "high");
});
