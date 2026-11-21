import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseText, detectFormat, detectEncoding, parseTime, makeParser, createReader } from "../src/parse.js";
import { generate, generateBig } from "../src/gen.js";

const U = (s) => Date.parse(s.replace(" ", "T") + "Z");

test("ISO: 예시 로그 전체를 읽고 형식을 자동 감지한다", () => {
  const r = parseText(generate(), { format: "auto", tz: 0 });
  assert.equal(r.format, "iso");
  assert.equal(r.entries.length, 10139);
  assert.equal(r.badCount, 0);
  const a = r.entries.find((e) => e.msg.startsWith("L103"));
  assert.equal(a.level, "ALARM");
  assert.equal(a.module, "LOADER");
  assert.equal(a.sev, 3);
});

test("ISO: [모듈] 이 레벨 앞에 와도 읽고, 오프셋 시각은 표시 시간대로 바꾼다", () => {
  const r = parseText([
    "2026-11-10T00:00:00Z [STAGE] WARN Motor temp high",
    "2026/11/10 09:00:01.5+09:00 ERROR S301 Following error X",
    "2026-11-10 09:00:02 INFO no module here",
  ].join("\n"), { format: "iso", tz: 540 });
  assert.equal(r.badCount, 0);
  assert.equal(r.entries[0].t, U("2026-11-10 09:00:00"));
  assert.equal(r.entries[0].module, "STAGE");
  assert.equal(r.entries[1].t, U("2026-11-10 09:00:01.500"));
  assert.equal(r.entries[2].module, "-");
});

test("잘못된 줄은 줄 번호와 사유를 남기고, 공백으로 시작하는 줄은 이어진 줄로 센다", () => {
  const r = parseText([
    "2026-11-10 09:00:00 INFO [A] ok",
    "    at com.example.Foo(Foo.java:12)",
    "garbage line",
    "2026-11-10 09:00:01 HELLO [A] unknown level",
    "2026-13-10 09:00:02 INFO [A] bad month",
  ].join("\n"), { format: "iso", tz: 0 });
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].cont, 1);
  assert.deepEqual(r.bad.map((b) => [b.n, b.reason]), [[3, "time"], [4, "level"], [5, "range"]]);
});

test("syslog: RFC 3164 · 5424, PRI 와 메시지 레벨, 연도 넘김", () => {
  const r = parseText([
    "<12>Dec 31 23:59:59 tool01 loader[33]: Vacuum pressure low (P=-64.1 kPa)",
    "<11>Jan  1 00:00:01 tool01 loader[33]: L103 Wafer vacuum lost",
    "<14>1 2026-11-10T09:12:40.123456+09:00 tool01 stage 77 - - ALARM [STAGE] S301 Following error X",
    "Nov 10 09:12:41 tool01 camera: [WARN] Exposure auto-adjusted",
  ].join("\n"), { format: "syslog", tz: 540, year: 2025 });
  assert.equal(r.badCount, 0);
  const [a, b, c, d] = r.entries.sort((x, y) => x.n - y.n);
  assert.equal(a.level, "WARN"); // PRI 12 → severity 4
  assert.equal(a.module, "loader");
  assert.equal(b.level, "ERROR"); // PRI 11 → severity 3
  assert.equal(new Date(b.t).getUTCFullYear(), 2026); // 12월 → 1월
  assert.equal(c.level, "ALARM");
  assert.equal(c.module, "STAGE");
  assert.equal(c.t, U("2026-11-10 09:12:40.123"));
  assert.equal(d.level, "WARN");
});

test("CSV: 머리글 이름, 날짜+시각 열 합치기, 따옴표 안 쉼표, TSV 자동 구분자", () => {
  const csv = parseText([
    "Date,Time,Severity,Unit,Message",
    '2026-11-10,09:00:00.250,Warning,LOADER,"Vacuum low, P=-64.1 kPa"',
    "2026-11-10,09:00:05,Alarm,LOADER,L103 Wafer vacuum lost",
  ].join("\r\n"), { format: "csv", tz: 0, csv: { time: "1+2" } });
  assert.equal(csv.badCount, 0);
  assert.equal(csv.entries[0].msg, "Vacuum low, P=-64.1 kPa");
  assert.equal(csv.entries[0].t, U("2026-11-10 09:00:00.250"));
  assert.equal(csv.entries[1].sev, 3);
  const tsv = parseText("time\tlevel\tmodule\tmessage\n2026-11-10 09:00:00\tERROR\tSTAGE\tS301 Following error", { format: "csv", tz: 0 });
  assert.equal(tsv.entries[0].module, "STAGE");
  const bad = parseText("time,level,msg\n2026-11-10 09:00:00,INFO", { format: "csv", tz: 0 });
  assert.equal(bad.bad[0].reason, "cols");
  assert.throws(() => parseText("a,b\n1,2", { format: "csv", tz: 0 }), /csv-columns/);
});

test("JSON Lines: 키 자동 감지 · 중첩 키 · pino 숫자 레벨 · epoch", () => {
  const r = parseText([
    '{"@timestamp":"2026-11-10T00:00:00Z","level":"warn","logger":"STAGE","message":"Motor temp high"}',
    '{"@timestamp":1794301201000,"level":50,"logger":"STAGE","message":"S301 Following error X"}',
    "not json",
  ].join("\n"), { format: "jsonl", tz: 0 });
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries[0].level, "WARN");
  assert.equal(r.entries[1].level, "ERROR");
  assert.equal(r.bad[0].reason, "json");
  const n = parseText('{"ts":"2026-11-10 09:00:00","ctx":{"unit":"CAM"},"lvl":"E","text":"C401 Frame timeout"}', { format: "jsonl", tz: 0, json: { module: "ctx.unit" } });
  assert.equal(n.entries[0].module, "CAM");
  assert.equal(n.entries[0].level, "ERROR");
});

test("사용자 정규식: 이름 그룹, 그룹이 없으면 오류", () => {
  const ok = parseText("2026-11-10 09:00:00 | STAGE | E | S301 Following error", {
    format: "regex", tz: 0, regex: "^(?<time>\\S+ \\S+) \\| (?<module>\\w+) \\| (?<level>\\w) \\| (?<msg>.*)$",
  });
  assert.equal(ok.entries[0].level, "ERROR");
  assert.equal(ok.entries[0].module, "STAGE");
  assert.throws(() => makeParser({ format: "regex", regex: "(?<msg>.*)" }), /regex-groups/);
  assert.throws(() => makeParser({ format: "regex", regex: "(?<time>" }), /regex-invalid/);
});

test("인코딩: EUC-KR 파일을 감지하고 한국어 레벨을 읽는다", () => {
  const bytes = new Uint8Array(readFileSync(new URL("./fixtures/euckr.log", import.meta.url)));
  assert.equal(detectEncoding(bytes), "euc-kr");
  const r = parseText(new TextDecoder("euc-kr").decode(bytes), { format: "auto", tz: 0 });
  assert.equal(r.badCount, 0);
  assert.deepEqual(r.entries.map((e) => e.level), ["INFO", "WARN", "ALARM"]);
  assert.equal(r.entries[2].module, "진공");
  assert.equal(detectEncoding(new TextEncoder().encode("2026-11-10 09:00:00 INFO 정상")), "utf-8");
});

test("시각: epoch 초 · 밀리초와 범위 밖 값", () => {
  assert.equal(parseTime("1794301200", 0), 1794301200000);
  assert.equal(parseTime("1794301200000", 60), 1794301200000 + 3600e3);
  assert.ok(Number.isNaN(parseTime("2026-02-10 25:00:00")));
  assert.ok(Number.isNaN(parseTime("hello")));
});

test("여러 날 로그는 날짜가 넘어가도 시간순으로 읽는다 · 조각으로 나눠 넣어도 결과가 같다", () => {
  const text = generateBig(3e6, 5);
  const one = parseText(text, { format: "iso", tz: 0 });
  const rd = createReader({ format: "iso", tz: 0 });
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 777) rd.push(lines.slice(i, i + 777));
  const two = rd.end();
  assert.equal(two.entries.length, one.entries.length);
  assert.ok(new Date(one.entries.at(-1).t).getUTCDate() !== new Date(one.entries[0].t).getUTCDate());
  for (let i = 1; i < one.entries.length; i++) assert.ok(one.entries[i].t >= one.entries[i - 1].t);
});

test("형식 감지: syslog · JSON Lines · CSV", () => {
  assert.equal(detectFormat(["<12>Nov 10 09:00:00 h app: hi", "<12>Nov 10 09:00:01 h app: hi"]), "syslog");
  assert.equal(detectFormat(['{"time":"2026-11-10 09:00:00","level":"info","msg":"x"}']), "jsonl");
  assert.equal(detectFormat(["time,level,module,msg", "2026-11-10 09:00:00,INFO,A,x", "2026-11-10 09:00:01,WARN,A,y"]), "csv");
});
