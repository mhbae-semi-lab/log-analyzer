import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STR } from "../src/i18n.js";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("한/영 문자열 키가 같다", () => {
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.ko).sort());
});

test("화면 코드 · HTML 이 쓰는 키는 모두 있다", () => {
  const used = new Set();
  for (const m of src("../src/app.js").matchAll(/\bt\("([A-Za-z_]+)"(?!\s*\+)/g)) used.add(m[1]);
  for (const m of src("../index.html").matchAll(/data-i18n(?:-html)?="([A-Za-z]+)"/g)) used.add(m[1]);
  for (const m of src("../index.html").matchAll(/data-i18n-attr="([^"]+)"/g)) for (const p of m[1].split(";")) used.add(p.split(":")[1]);
  for (const w of ["how_example", "how_rule", "how_llm", "how_fallback", "reason_time", "reason_range", "reason_level", "reason_cols", "reason_json", "reason_msg", "reason_regex"]) used.add(w);
  const missing = [...used].filter((k) => !(k in STR.ko));
  assert.deepEqual(missing, []);
});
