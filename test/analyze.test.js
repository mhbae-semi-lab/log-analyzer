import { test } from "node:test";
import assert from "node:assert/strict";
import * as A from "../src/analyze.js";
import { parseText } from "../src/parse.js";
import { generate, CASES, DATE } from "../src/gen.js";
import { sampleCauses } from "../src/sample-causes.js";

function load(config = A.DEFAULT_CONFIG) {
  const entries = parseText(generate(), { format: "iso", tz: 0 }).entries;
  const cd = A.compileDict(config.dict);
  A.assignCodes(entries, cd);
  const eps = A.episodes(entries, config.gap * 1000);
  return { entries, cd, eps, cls: A.clusters(eps) };
}
const MIN = 60e3;
const builtin = () => CASES.map((c) => ({ ...c, label: c.label.ko, t: Date.parse(`${DATE}T${c.at}Z`) }));

test("회귀: 예시 로그의 발생 · 군집 순서", () => {
  const { eps, cls } = load();
  assert.equal(eps.length, 17);
  assert.deepEqual(cls.map((c) => `${c.code}:${c.episodes.length}`), ["C402:4", "L103:3", "S301:2", "C401:6", "L104:2"]);
  assert.deepEqual([...cls[1].signatures.keys()], ["L103 → A201 → S305"]);
});

test("직전 경고: 진공 저하가 L103 앞 1순위, 리드 타임 중앙값이 몇 분", () => {
  const { entries, cls } = load();
  const pre = A.precursors(entries, cls.find((c) => c.code === "L103"), 10 * MIN);
  assert.equal(pre[0].module, "LOADER");
  assert.match(pre[0].tpl, /^Vacuum pressure low/);
  assert.equal(pre[0].coverage, 3);
  assert.ok(pre[0].spec > 0.8);
  assert.ok(pre[0].leadMed > 5 * MIN && pre[0].leadMed < 10 * MIN, `lead ${pre[0].leadMed / MIN}`);
  assert.ok(pre[0].leadMin <= pre[0].leadMed && pre[0].leadMed <= pre[0].leadMax);
});

test("규칙 원인 후보: 한/영 문구 · 확신도 키 · 근거 없는 군집", () => {
  const { entries, cls } = load();
  for (const lang of ["ko", "en"]) {
    for (const c of cls) {
      const r = A.ruleCauses(c, A.precursors(entries, c, 10 * MIN), lang);
      assert.ok(r.causes.length >= 1 && r.causes.length <= 3);
      for (const x of r.causes) assert.ok(A.CONF.includes(x.confidence));
    }
  }
  const c401 = cls.find((c) => c.code === "C401");
  assert.match(A.ruleCauses(c401, A.precursors(entries, c401, 10 * MIN), "en").causes[0].cause, /No warning repeats/);
});

test("검증: 미리 쓴 예시는 통과, 없는 줄 · 지어낸 수치 · 형식 오류는 잡는다", () => {
  const { entries, cls } = load();
  for (const c of cls) {
    const pre = A.precursors(entries, c, 10 * MIN), pool = A.evidencePool(entries, c, 10 * MIN);
    assert.ok(pool.length <= 80);
    const prompt = A.promptFor(c, pre, pool, "ko");
    const ex = sampleCauses(c.code, "ko");
    const out = { causes: ex.causes.map((x) => ({ ...x, evidence: A.resolvePatterns(pool, x.patterns) })), checks: ex.checks };
    assert.deepEqual(A.validateCauses(out, pool, prompt, "ko"), [], c.code);
    const rule = A.ruleCauses(c, pre, "ko");
    assert.deepEqual(A.validateCauses(rule, pool, prompt, "ko"), [], c.code + " rule");
    const fake = structuredClone(out);
    fake.causes[0].evidence.push(123456789);
    assert.match(A.validateCauses(fake, pool, prompt, "ko").join(), /없는 줄 123456789/);
    const num = structuredClone(out);
    num.causes[0].reasoning += " 98.7 kPa";
    assert.match(A.validateCauses(num, pool, prompt, "en").join(), /98\.7/);
  }
  assert.deepEqual(A.validateCauses({ causes: [] }, [], "", "en"), ["No cause candidates"]);
  assert.match(A.validateCauses({ causes: [{ cause: "x", reasoning: "", evidence: [], confidence: "sure" }] }, [], "", "ko").join(), /확신도.*근거 줄 없음/);
});

test("Shadow 일치: 같은 종류 줄을 가리키면 일치", () => {
  const { entries, cls } = load();
  const c = cls.find((x) => x.code === "L103");
  const pre = A.precursors(entries, c, 10 * MIN), pool = A.evidencePool(entries, c, 10 * MIN);
  const rule = A.ruleCauses(c, pre, "ko");
  const byLine = new Map(entries.map((e) => [e.n, e]));
  const vac = pool.filter((e) => /Vacuum pressure low/.test(e.msg)).map((e) => e.n);
  assert.equal(A.agree(rule, { causes: [{ evidence: [vac.at(-1)] }] }, byLine), true);
  const other = pool.find((e) => e.sev === 3).n;
  assert.equal(A.agree(rule, { causes: [{ evidence: [other] }] }, byLine), false);
});

test("백테스트: 합성 Down 사례 3종 모두 경고가 알람보다 먼저 잡히고, 규칙을 조이면 놓친다", () => {
  const { entries, eps, cls } = load();
  const rules = A.suggestRules(entries, cls, 10 * MIN);
  assert.deepEqual(rules.map((r) => r.target).sort(), ["C402", "L103", "S301"]);
  const bt = A.backtest(entries, eps, builtin(), rules);
  for (const r of bt.rows) {
    assert.ok(r.lead > 0, `${r.code} lead`);
    assert.ok(r.warnLead >= r.lead, `${r.code} first warning before the alert`);
  }
  assert.equal(bt.caught, 3);
  assert.ok(bt.falseAlarms <= bt.fires);
  const strict = A.backtest(entries, eps, builtin(), rules.map((r) => ({ ...r, count: 20 })));
  assert.equal(strict.caught, 0);
  assert.equal(strict.fires, 0);
});

test("비교: 간격을 바꾸면 발생 수가 달라지고 바뀐 군집이 표시된다", () => {
  const { entries } = load();
  const a = A.summarize(entries, A.DEFAULT_CONFIG, "ko");
  const b = A.summarize(entries, { ...A.DEFAULT_CONFIG, gap: 3600 }, "ko");
  assert.ok(b.eps < a.eps);
  const d = A.diffSummaries(a, b);
  assert.ok(d.some((r) => Object.values(r.changed).some(Boolean)));
  assert.ok(A.diffSummaries(a, a).every((r) => !Object.values(r.changed).some(Boolean)));
});

test("설비 사전: 코드 패턴 · 모듈 순서 · 알람 그룹, 잘못된 정규식은 기본값", () => {
  const cd = A.compileDict({ ...A.DEFAULT_DICT, codePattern: "(" });
  assert.equal(cd.codeRe.source, A.DEFAULT_DICT.codePattern);
  assert.equal(A.groupOf(cd, "L103", "ko"), "핸들링 · 진공");
  assert.equal(A.groupOf(cd, "S301", "en"), "Motion · servo");
  assert.deepEqual(A.lanes(cd, ["ZED", "CAMERA", "LOADER", "ABC"]), ["LOADER", "CAMERA", "ABC", "ZED"]);
  const e = [{ sev: 3, msg: "Alarm ERR-0042 pump trip", tpl: "Alarm ERR-# pump trip" }];
  A.assignCodes(e, A.compileDict({ codePattern: "ERR-(\\d+)" }));
  assert.equal(e[0].code, "0042");
});
