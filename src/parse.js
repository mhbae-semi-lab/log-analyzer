// 로그 읽기: 형식 프리셋(ISO · syslog · CSV · JSON Lines · 사용자 정규식) · 인코딩 · 시간대 · 잘못된 줄 사유.
// 브라우저 · Worker · node 공용 ES 모듈. 시각은 "표시용 벽시계 ms" (Date.UTC 숫자)로 저장한다:
//   오프셋 없는 시각(장비 현지 시각)은 그대로, 오프셋(Z, +09:00)이나 epoch 가 있는 시각은 opts.tz(분)로 바꾼다.

export const FORMATS = ["auto", "iso", "syslog", "csv", "jsonl", "regex"];

const LV = {
  TRACE: "DEBUG", DEBUG: "DEBUG", VERBOSE: "DEBUG", FINE: "DEBUG", D: "DEBUG", 디버그: "DEBUG",
  INFO: "INFO", INFORMATION: "INFO", NOTICE: "INFO", I: "INFO", 정보: "INFO",
  WARN: "WARN", WARNING: "WARN", W: "WARN", 경고: "WARN", 주의: "WARN",
  ERROR: "ERROR", ERR: "ERROR", E: "ERROR", 오류: "ERROR", 에러: "ERROR",
  ALARM: "ALARM", ALM: "ALARM", 알람: "ALARM",
  FATAL: "FATAL", F: "FATAL", CRITICAL: "FATAL", CRIT: "FATAL", EMERG: "FATAL", EMERGENCY: "FATAL", ALERT: "FATAL", 치명: "FATAL",
};
export const SEV = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, ALARM: 3, FATAL: 3 };
export const level = (w) => LV[String(w ?? "").trim().toUpperCase()] || null;

// 숫자를 # 로 바꿔 같은 종류의 메시지를 한 묶음으로 본다
export const template = (msg) => msg.replace(/[-+]?\d+(?:\.\d+)?/g, "#").replace(/\s+/g, " ").trim();

const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const TIME_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?\s*(Z|[+-]\d{2}:?\d{2})?/;
const OFF = (s) => (s === "Z" ? 0 : (s[0] === "-" ? -1 : 1) * (+s.slice(1, 3) * 60 + +s.slice(-2)));

function wall(y, mo, d, h, mi, s, frac, off, tz) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return NaN;
  let t = Date.UTC(y, mo - 1, d, h, mi, s, frac ? Number((frac + "00").slice(0, 3)) : 0);
  if (off != null) t += (tz - off) * 60e3;
  return t;
}

// "2026-11-10 09:12:40.123", "2026/11/10T09:12:40+09:00", epoch 초(10자리) · 밀리초(13자리)
export function parseTime(s, tz = 0) {
  s = String(s ?? "").trim();
  if (/^\d{10}(\.\d+)?$/.test(s)) return Math.round(+s * 1000) + tz * 60e3;
  if (/^\d{13}$/.test(s)) return +s + tz * 60e3;
  const m = s.match(TIME_RE);
  if (!m) return NaN;
  return wall(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], m[7], m[8] ? OFF(m[8]) : null, tz);
}

// 메시지 첫 낱말이 레벨이면 떼어 낸다: "ALARM L103 ...", "[WARN] ...", "<E> ..."
function leadLevel(msg) {
  const m = msg.match(/^([[<(]?)([A-Za-z가-힣]{1,11})[\]>)]?:?\s+/);
  if (!m || (!m[1] && /^[A-Za-z]{1,2}$/.test(m[2]))) return null; // I · W · E 같은 한두 글자는 괄호 안일 때만
  const lv = level(m[2]);
  return lv ? { lv, rest: msg.slice(m[0].length) } : null;
}
// 메시지 앞 [MODULE] 를 떼어 낸다
function leadModule(msg) {
  const m = msg.match(/^\[([^\]]{1,40})\]:?\s*/);
  return m ? { module: m[1].trim(), rest: msg.slice(m[0].length) } : null;
}

function splitCsv(line, d) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"' && cur === "") q = true;
    else if (c === d) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const pick = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
const PINO = { 10: "DEBUG", 20: "DEBUG", 30: "INFO", 40: "WARN", 50: "ERROR", 60: "FATAL" };
const SYSLOG_SEV = ["FATAL", "FATAL", "FATAL", "ERROR", "WARN", "INFO", "INFO", "DEBUG"];
const KEYS = {
  time: ["time", "timestamp", "ts", "@timestamp", "datetime", "date", "시각", "시간", "일시"],
  level: ["level", "severity", "lvl", "loglevel", "levelname", "type", "레벨", "등급", "구분"],
  module: ["module", "component", "unit", "logger", "source", "service", "name", "모듈", "유닛", "장치"],
  msg: ["msg", "message", "text", "event", "description", "메시지", "내용"],
};
const findKey = (names, want) => {
  const low = names.map((n) => String(n).toLowerCase());
  for (const w of want) { const i = low.indexOf(w); if (i >= 0) return names[i]; }
  return null;
};

export function sniffDelimiter(line) {
  let best = ",", bn = 0;
  for (const d of [",", "\t", ";", "|"]) { const n = splitCsv(line, d).length; if (n > bn) { bn = n; best = d; } }
  return best;
}

// 형식별 줄 파서. line(raw, n) → entry | { bad: 사유 } | null(빈 줄) | "cont"(앞 줄에 이어지는 줄)
export function makeParser(opts = {}) {
  const tz = opts.tz ?? 0;
  const st = { year: opts.year || new Date().getFullYear(), mon: 0, csvCols: null };
  // 원문 줄은 저장하지 않는다 (메모리 · Worker 복사 시간 절반). 필요하면 isoLine(e) 로 표준 형식을 만든다
  const mk = (n, t, lv, module, msg) => {
    const e = { n, t, level: lv, sev: SEV[lv], module: (module || "-").slice(0, 40), msg };
    if (e.sev >= 2) e.tpl = template(msg);
    return e;
  };
  const fmt = opts.format || "iso";

  if (fmt === "iso") {
    const RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?\s+(.*)$/;
    return (raw, n) => {
      const m = raw.match(RE);
      if (!m) return { bad: "time" };
      const t = wall(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], m[7], m[8] ? OFF(m[8]) : null, tz);
      if (Number.isNaN(t)) return { bad: "range" };
      let ll = leadLevel(m[9]), mm;
      if (ll) mm = leadModule(ll.rest);
      else if ((mm = leadModule(m[9])) && (ll = leadLevel(mm.rest))) mm.rest = ll.rest; // [MODULE] LEVEL 순서
      if (!ll) return { bad: "level" };
      return mk(n, t, ll.lv, mm?.module, (mm ? mm.rest : ll.rest).trim(), raw);
    };
  }

  if (fmt === "syslog") {
    const R5424 = /^<(\d{1,3})>1 (\S+) (\S+) (\S+) (\S+) (\S+) (-|(?:\[[^\]]*\])+) ?(.*)$/;
    const R3164 = /^(?:<(\d{1,3})>)?([A-Z][a-z]{2}) +(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))? (\S+) ([^:[\s]+)(?:\[\d+\])?: ?(.*)$/;
    return (raw, n) => {
      let t, pri, app, msg;
      let m = raw.match(R5424);
      if (m) {
        t = parseTime(m[2].replace(/\.(\d{3})\d*/, ".$1"), tz);
        pri = +m[1]; app = m[4] === "-" ? "" : m[4]; msg = m[8];
      } else if ((m = raw.match(R3164))) {
        const mon = MON[m[2]];
        if (!mon) return { bad: "time" };
        if (st.mon && mon < st.mon - 6) st.year++; // 12월 → 1월로 넘어가면 해를 올린다
        st.mon = mon;
        t = wall(st.year, mon, +m[3], +m[4], +m[5], +m[6], m[7], null, tz);
        pri = m[1] != null ? +m[1] : null; app = m[9]; msg = m[10];
      } else return { bad: "time" };
      if (Number.isNaN(t)) return { bad: "range" };
      let lv = pri != null ? SYSLOG_SEV[pri % 8] : "INFO";
      const ll = leadLevel(msg);
      if (ll) { lv = ll.lv; msg = ll.rest; }
      const mm = leadModule(msg);
      return mk(n, t, lv, mm ? mm.module : app, (mm ? mm.rest : msg).trim(), raw);
    };
  }

  if (fmt === "csv") {
    const c = opts.csv || {};
    let d = c.delim && c.delim !== "auto" ? (c.delim === "\\t" ? "\t" : c.delim) : null;
    let header = c.header !== false, idx = null;
    // 열 지정: 머리글 이름 또는 1부터 세는 번호. "1+2" 는 날짜 · 시각 열 이어 붙이기
    const resolve = (ref, names, fallback) => {
      if (ref == null || ref === "") return fallback;
      return String(ref).split("+").map((r) => {
        r = r.trim();
        if (/^\d+$/.test(r)) return +r - 1;
        const i = names ? names.findIndex((x) => x.toLowerCase() === r.toLowerCase()) : -1;
        return i;
      });
    };
    return (raw, n) => {
      if (!d) d = sniffDelimiter(raw);
      const f = splitCsv(raw, d);
      if (!idx) {
        const names = header ? f : null;
        const guess = (k, i) => {
          if (names) { const key = findKey(names, KEYS[k]); return key == null ? null : [names.indexOf(key)]; }
          return i == null ? null : [i];
        };
        const three = f.length === 3;
        idx = {
          time: resolve(c.time, names, guess("time", 0)),
          level: resolve(c.level, names, guess("level", 1)),
          module: resolve(c.module, names, guess("module", three ? null : 2)),
          msg: resolve(c.msg, names, guess("msg", three ? 2 : 3)),
        };
        if (!idx.time || idx.time.some((i) => i < 0) || !idx.msg || idx.msg.some((i) => i < 0)) throw new Error("csv-columns");
        if (header) return null;
      }
      const get = (ix) => (ix ? ix.map((i) => f[i] ?? "").join(" ").trim() : "");
      const need = Math.max(...idx.time, ...idx.msg);
      if (f.length <= need) return { bad: "cols" };
      const t = parseTime(get(idx.time), tz);
      if (Number.isNaN(t)) return { bad: "time" };
      let msg = get(idx.msg), lv = idx.level ? level(get(idx.level)) : null;
      if (!lv) { const ll = leadLevel(msg); if (ll) { lv = ll.lv; msg = ll.rest; } }
      if (!lv) return { bad: "level" };
      return mk(n, t, lv, get(idx.module), msg, raw);
    };
  }

  if (fmt === "jsonl") {
    const k = opts.json || {};
    let keys = null;
    return (raw, n) => {
      let o;
      try { o = JSON.parse(raw); } catch { return { bad: "json" }; }
      if (!o || typeof o !== "object") return { bad: "json" };
      if (!keys) {
        const names = Object.keys(o);
        keys = {
          time: k.time || findKey(names, KEYS.time), level: k.level || findKey(names, KEYS.level),
          module: k.module || findKey(names, KEYS.module), msg: k.msg || findKey(names, KEYS.msg),
        };
      }
      const tv = keys.time && pick(o, keys.time);
      const t = typeof tv === "number" ? (tv > 1e11 ? tv : tv * 1000) + tz * 60e3 : parseTime(tv, tz);
      if (Number.isNaN(t)) return { bad: "time" };
      const mv = keys.msg && pick(o, keys.msg);
      if (mv == null) return { bad: "msg" };
      let msg = String(mv);
      const lr = keys.level && pick(o, keys.level);
      let lv = typeof lr === "number" ? PINO[lr] || null : level(lr);
      if (!lv) { const ll = leadLevel(msg); if (ll) { lv = ll.lv; msg = ll.rest; } }
      if (!lv) lv = "INFO";
      return mk(n, t, lv, keys.module && pick(o, keys.module) != null ? String(pick(o, keys.module)) : "", msg, raw);
    };
  }

  if (fmt === "regex") {
    let re;
    try { re = new RegExp(opts.regex || ""); } catch { throw new Error("regex-invalid"); }
    if (!/\(\?<time>/.test(opts.regex || "") || !/\(\?<msg>/.test(opts.regex || "")) throw new Error("regex-groups");
    return (raw, n) => {
      const m = raw.match(re);
      if (!m) return { bad: "regex" };
      const g = m.groups;
      const t = parseTime(g.time, tz);
      if (Number.isNaN(t)) return { bad: "time" };
      let msg = g.msg || "", lv = g.level ? level(g.level) : null;
      if (!lv) { const ll = leadLevel(msg); if (ll) { lv = ll.lv; msg = ll.rest; } }
      if (!lv) return g.level ? { bad: "level" } : mk(n, t, "INFO", g.module, msg.trim(), raw);
      const mm = g.module ? null : leadModule(msg);
      return mk(n, t, lv, g.module || mm?.module, (mm ? mm.rest : msg).trim(), raw);
    };
  }
  throw new Error("format-unknown");
}

// 앞쪽 줄들로 형식을 고른다 (읽힌 비율이 가장 높은 것)
export function detectFormat(lines, opts = {}) {
  const sample = lines.filter((l) => l.trim()).slice(0, 60);
  let best = { format: "iso", ok: -1 };
  for (const format of ["iso", "syslog", "jsonl", "csv"]) {
    if (format === "jsonl" && !sample.some((l) => l.trimStart().startsWith("{"))) continue;
    let p, ok = 0;
    try { p = makeParser({ ...opts, format }); } catch { continue; }
    sample.forEach((l, i) => { try { const r = p(l, i + 1); if (r && !r.bad) ok++; } catch { /* 열 지정 실패 */ } });
    if (ok > best.ok) best = { format, ok };
  }
  return best.format;
}

const isCont = (raw) => raw[0] === " " || raw[0] === "\t";

// 줄 묶음 파서 (Worker 는 조각마다 push, node 테스트는 parseText)
export function createReader(opts = {}) {
  const res = { entries: [], bad: [], badCount: 0, cont: 0, reasons: {}, format: opts.format };
  let parse = null, n = 0, prev = null, pending = [];
  const ensure = () => {
    if (parse) return;
    if (!res.format || res.format === "auto") res.format = detectFormat(pending, opts);
    parse = makeParser({ ...opts, format: res.format });
  };
  const one = (raw, ln) => {
    if (raw.endsWith("\r")) raw = raw.slice(0, -1);
    if (ln === 1 && raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    if (!raw.trim()) return;
    if (prev && isCont(raw)) { prev.cont = (prev.cont || 0) + 1; res.cont++; return; }
    const r = parse(raw, ln);
    if (r === null) return;
    if (r.bad) {
      res.badCount++;
      res.reasons[r.bad] = (res.reasons[r.bad] || 0) + 1;
      if (res.bad.length < 200) res.bad.push({ n: ln, reason: r.bad, text: raw.slice(0, 160) });
      return;
    }
    res.entries.push(r);
    prev = r;
  };
  return {
    res,
    push(lines) {
      if (!parse) {
        for (const l of lines) pending.push(l);
        if (pending.length < 60) return;
        ensure();
        const p = pending; pending = [];
        for (const l of p) one(l, ++n);
        return;
      }
      for (const l of lines) one(l, ++n);
    },
    end() {
      if (!parse) { ensure(); const p = pending; pending = []; for (const l of p) one(l, ++n); }
      const E = res.entries;
      let sorted = true;
      for (let i = 1; i < E.length; i++) if (E[i].t < E[i - 1].t) { sorted = false; break; }
      if (!sorted) E.sort((a, b) => a.t - b.t || a.n - b.n);
      res.sorted = sorted;
      res.lines = n;
      return res;
    },
  };
}

export function parseText(text, opts = {}) {
  const r = createReader(opts);
  r.push(String(text).split("\n"));
  return r.end();
}

// 인코딩: BOM → UTF-8 엄격 검사 → 실패하면 EUC-KR(CP949)
export function detectEncoding(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  let end = Math.min(bytes.length, 1 << 16);
  if (end < bytes.length) while (end > 0 && bytes[end - 1] !== 0x0a) end--; // 줄 끝에서 자른다 (다바이트 글자 중간 방지)
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end || Math.min(bytes.length, 1 << 16))); return "utf-8"; }
  catch { return "euc-kr"; }
}

// 표준 형식 한 줄 (사례 발췌 · 내보내기에 씀)
const pad = (x, w = 2) => String(x).padStart(w, "0");
export function isoLine(e) {
  const d = new Date(e.t);
  const ts = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
  return `${ts} ${e.level.padEnd(5)} [${e.module}] ${e.msg}`;
}
