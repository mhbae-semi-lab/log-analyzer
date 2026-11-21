// 로그 분석: 알람 코드 → 발생 묶음(에피소드) → 같은 첫 알람끼리 군집 → 직전 경고 통계(리드 타임) → 원인 후보
// + 조기 경보 규칙 백테스트 · 설정 전후 비교 · LLM 결과 검증 · Shadow 일치 판정. 브라우저 · node 공용 ES 모듈.
import { isoLine } from "./parse.js";

export const CONF = ["high", "medium", "low"];
export const DEFAULT_DICT = {
  equipment: "SpotCheck (synthetic)",
  codePattern: "\\b([A-Z]{1,3}-?\\d{2,5})\\b",
  modules: [
    { id: "LOADER", name: "로더", nameEn: "Loader" }, { id: "STAGE", name: "스테이지", nameEn: "Stage" },
    { id: "ALIGN", name: "정렬", nameEn: "Align" }, { id: "CAMERA", name: "카메라", nameEn: "Camera" },
    { id: "LIGHT", name: "조명", nameEn: "Light" },
  ],
  groups: [
    { match: "^L1", name: "핸들링 · 진공", nameEn: "Handling · vacuum" },
    { match: "^S3", name: "모션 · 서보", nameEn: "Motion · servo" },
    { match: "^A2", name: "정렬", nameEn: "Alignment" },
    { match: "^C4", name: "영상", nameEn: "Imaging" },
    { match: "^G5", name: "조명 · 통신", nameEn: "Light · comm" },
  ],
};
export const DEFAULT_CONFIG = { gap: 120, lookback: 10, rules: [], dict: DEFAULT_DICT, mode: "rule" };

const pct = (x) => Math.round(x * 100);
const MIN = 60e3;
const fmtMin = (ms) => (ms / MIN).toFixed(1).replace(/\.0$/, "");
export const fmtTime = (t) => new Date(t).toISOString().slice(11, 19);
const nums = (s) => new Set(String(s).match(/\d+(?:\.\d+)?/g) || []);

// 정렬된 배열에서 t 이상인 첫 위치
export function lowerBound(arr, t) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].t < t) lo = mid + 1; else hi = mid; }
  return lo;
}

// ---------- 설비 사전 ----------
export function compileDict(dict = DEFAULT_DICT) {
  let codeRe;
  try { codeRe = new RegExp(dict.codePattern || DEFAULT_DICT.codePattern); } catch { codeRe = new RegExp(DEFAULT_DICT.codePattern); }
  const groups = (dict.groups || []).flatMap((g) => { try { return [{ ...g, re: new RegExp(g.match) }]; } catch { return []; } });
  const order = new Map((dict.modules || []).map((m, i) => [m.id, i]));
  return { codeRe, groups, order, modules: dict.modules || [], equipment: dict.equipment || "" };
}
export const groupOf = (cd, code, lang = "ko") => {
  const g = cd.groups.find((x) => x.re.test(code));
  return g ? (lang === "en" ? g.nameEn || g.name : g.name) : null;
};
export const moduleName = (cd, id, lang = "ko") => {
  const m = cd.modules.find((x) => x.id === id);
  return m ? (lang === "en" ? m.nameEn || m.name : m.name) : null;
};
// 레인 순서: 사전에 있는 모듈 먼저(사전 순서), 나머지는 이름순
export const lanes = (cd, modules) => [...modules].sort((a, b) => (cd.order.get(a) ?? 1e9) - (cd.order.get(b) ?? 1e9) || a.localeCompare(b));

// 알람(ERROR 이상)에 코드를 붙인다. 코드가 없으면 숫자를 지운 메시지로 묶는다
export function assignCodes(entries, cd) {
  for (const e of entries) {
    if (e.sev !== 3) continue;
    const c = e.msg.match(cd.codeRe);
    const code = c ? c[1] || c[0] : null;
    e.code = code || e.tpl.slice(0, 40);
    e.name = code ? e.msg.replace(c[0], "").replace(/\(.*\)\s*$/, "").replace(/\s+/g, " ").trim() : e.tpl;
  }
}

export function stats(entries) {
  const levels = {}, modules = {};
  for (const e of entries) {
    levels[e.level] = (levels[e.level] || 0) + 1;
    modules[e.module] = (modules[e.module] || 0) + 1;
  }
  return { levels, modules, t0: entries.length ? entries[0].t : 0, t1: entries.length ? entries[entries.length - 1].t : 0 };
}

// 알람 사이 간격이 gap 보다 짧으면 한 발생(에피소드)으로 묶는다
export function episodes(entries, gap = 120e3) {
  const out = [];
  let cur = null;
  for (const e of entries) {
    if (e.sev < 3) continue;
    if (!cur || e.t - cur.t1 > gap) { cur = { alarms: [], t0: e.t, t1: e.t }; out.push(cur); }
    cur.alarms.push(e);
    cur.t1 = e.t;
  }
  for (const ep of out) {
    ep.trigger = ep.alarms[0];
    const seen = [];
    for (const a of ep.alarms) if (!seen.includes(a.code)) seen.push(a.code);
    ep.codes = seen;
    ep.signature = seen.join(" → ");
  }
  return out;
}

// 첫 알람 코드가 같은 발생끼리 = 같은 원인으로 의심되는 군집
export function clusters(eps) {
  const m = new Map();
  for (const ep of eps) {
    const k = ep.trigger.code;
    if (!m.has(k)) m.set(k, { code: k, name: ep.trigger.name, module: ep.trigger.module, episodes: [], signatures: new Map() });
    const c = m.get(k);
    c.episodes.push(ep);
    c.signatures.set(ep.signature, (c.signatures.get(ep.signature) || 0) + 1);
  }
  // 후속 알람이 따라붙는 군집(연쇄)을 먼저, 그 안에서는 많이 난 순서
  const chained = (c) => (c.episodes.some((ep) => ep.codes.length > 1) ? 1 : 0);
  return [...m.values()].sort((a, b) => chained(b) - chained(a) || b.episodes.length - a.episodes.length || a.episodes[0].t0 - b.episodes[0].t0);
}

const warnsOf = (entries) => entries.filter((e) => e.sev === 2);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

// 직전 경고 통계: 각 발생의 첫 알람 앞 lookback 안에 나온 경고 종류별로
//   coverage = 몇 번의 발생 앞에 나왔나, spec(집중도) = 그 경고 전체 중 알람 직전에 몰린 비율,
//   lead = 발생마다 (첫 알람 시각 − 구간 안 첫 경고 시각) → 중앙값 · 최소 · 최대
export function precursors(entries, cluster, lookback = 10 * MIN, warns = warnsOf(entries)) {
  const total = new Map();
  for (const w of warns) { const k = w.module + "\u0000" + w.tpl; total.set(k, (total.get(k) || 0) + 1); }
  const E = cluster.episodes.length;
  const res = new Map();
  const inAny = new Set();
  cluster.episodes.forEach((ep, i) => {
    for (let j = lowerBound(warns, ep.t0 - lookback); j < warns.length && warns[j].t < ep.t0; j++) {
      const w = warns[j];
      const k = w.module + "\u0000" + w.tpl;
      if (!res.has(k)) res.set(k, { module: w.module, tpl: w.tpl, eps: new Set(), lines: [], last: new Map(), first: new Map() });
      const r = res.get(k);
      r.eps.add(i);
      r.last.set(i, w.n);
      if (!r.first.has(i)) r.first.set(i, w.t);
      if (!inAny.has(w.n)) { inAny.add(w.n); r.lines.push(w.n); }
    }
  });
  return [...res.values()].map((r) => {
    const all = total.get(r.module + "\u0000" + r.tpl);
    const coverage = r.eps.size;
    const spec = r.lines.length / all;
    const leads = [...r.first].map(([i, t]) => cluster.episodes[i].t0 - t);
    return { module: r.module, tpl: r.tpl, coverage, of: E, inWin: r.lines.length, total: all, spec,
      score: (coverage / E) * spec, evidence: [...r.last.values()],
      leadMed: median(leads), leadMin: Math.min(...leads), leadMax: Math.max(...leads) };
  }).sort((a, b) => b.score - a.score || b.coverage - a.coverage);
}

// ---------- 규칙 기반 원인 후보 (한/영) ----------
const RT = {
  ko: {
    rep: (p) => `[${p.module}] '${p.tpl}' 경고가 첫 알람 직전에 반복됨`,
    repWhy: (E, p) => `${E}번 발생 중 ${p.coverage}번 앞에 나타났고, 이 경고 ${p.total}건 중 ${p.inWin}건(${pct(p.spec)}%)이 알람 직전에 몰려 있음. 첫 경고는 알람 ${fmtMin(p.leadMed)}분 전(중앙값)`,
    follow: (codes, code) => `${codes} 는 ${code} 뒤에 따라오는 2차 알람으로 보임`,
    followWhy: (E, k, code) => `${E}번 발생 중 ${k}번 ${code} 다음에 같은 발생 안에서 뒤따름 — 따로 원인을 찾기보다 ${code} 의 원인을 먼저 확인`,
    none: "알람 직전에 반복되는 경고가 없음 — 단발성이거나 로그에 남지 않는 원인",
    noneWhy: (E) => `${E}번 발생 앞 구간에서 공통된 경고를 찾지 못함`,
  },
  en: {
    rep: (p) => `[${p.module}] '${p.tpl}' warning repeats right before the first alarm`,
    repWhy: (E, p) => `Seen before ${p.coverage} of ${E} occurrences; ${p.inWin} of its ${p.total} instances (${pct(p.spec)}%) fall right before an alarm. First warning ${fmtMin(p.leadMed)} min before the alarm (median)`,
    follow: (codes, code) => `${codes} look like secondary alarms that follow ${code}`,
    followWhy: (E, k, code) => `In ${k} of ${E} occurrences they follow ${code} within the same occurrence — check the cause of ${code} first`,
    none: "No warning repeats before the alarm — one-off, or a cause the log does not record",
    noneWhy: (E) => `No common warning found in the windows before ${E} occurrences`,
  },
};

export function ruleCauses(cluster, pre, lang = "ko") {
  const T = RT[lang] || RT.ko;
  const E = cluster.episodes.length;
  const out = [];
  for (const p of pre) {
    if (out.length >= 2) break;
    if (p.coverage / E < 0.5 || p.spec < 0.2) continue;
    out.push({ cause: T.rep(p), reasoning: T.repWhy(E, p), evidence: p.evidence.slice(0, 4),
      confidence: p.score >= 0.5 ? "high" : p.score >= 0.25 ? "medium" : "low", key: p.module + "\u0000" + p.tpl });
  }
  const withFollow = cluster.episodes.filter((ep) => ep.codes.length > 1);
  const follow = withFollow.flatMap((ep) => ep.alarms.filter((a) => a.code !== cluster.code));
  if (follow.length) {
    const codes = [...new Set(follow.map((a) => a.code))];
    const k = withFollow.length;
    out.push({ cause: T.follow(codes.join(" · "), cluster.code), reasoning: T.followWhy(E, k, cluster.code),
      evidence: withFollow.slice(0, 3).map((ep) => ep.alarms.find((a) => a.code !== cluster.code).n),
      confidence: k === E ? "medium" : "low" });
  }
  if (!out.length || (out.length === 1 && follow.length)) {
    out.unshift({ cause: T.none, reasoning: T.noneWhy(E), evidence: cluster.episodes.slice(0, 3).map((ep) => ep.trigger.n), confidence: "low" });
  }
  return { causes: out.slice(0, 3), checks: [] };
}

// LLM 에 보낼 근거 줄: 각 발생 앞뒤의 경고 · 알람 + 첫 알람 모듈의 주변 정보 줄
export function evidencePool(entries, cluster, lookback = 10 * MIN, cap = 80) {
  const pick = new Map();
  for (const ep of cluster.episodes.slice(0, 6)) {
    for (let j = lowerBound(entries, ep.t0 - lookback); j < entries.length && entries[j].t <= ep.t1 + 150e3; j++) {
      const e = entries[j];
      const near = e.t >= ep.t0 - MIN;
      let pri = -1;
      if (e.sev === 3 && e.t >= ep.t0 && e.t <= ep.t1) pri = 3;
      else if (e.sev >= 2 && e.t <= ep.t1 + 30e3) pri = 2;
      else if (near && e.sev === 1 && e.module === ep.trigger.module) pri = 1;
      if (pri < 0) continue;
      const dist = Math.abs(e.t - ep.t0);
      const old = pick.get(e.n);
      if (!old || old.pri < pri) pick.set(e.n, { e, pri, dist });
    }
  }
  let list = [...pick.values()];
  if (list.length > cap) list = list.sort((a, b) => b.pri - a.pri || a.dist - b.dist).slice(0, cap);
  return list.map((x) => x.e).sort((a, b) => a.n - b.n);
}

// 미리 만든 원인 후보는 줄 번호 대신 문구 패턴을 들고 있어, 근거 줄에서 찾아 번호로 바꾼다
export function resolvePatterns(pool, patterns, perPattern = 3) {
  const out = [];
  for (const p of patterns) {
    const picked = [];
    for (const e of pool) {
      if (!(e.msg.includes(p) || e.code === p)) continue;
      if (picked.some((t) => Math.abs(t - e.t) < 15 * MIN)) continue; // 15분 안에 이미 고른 줄이 있으면 건너뜀 → 발생마다 고루
      picked.push(e.t);
      out.push(e.n);
      if (picked.length >= perPattern) break;
    }
  }
  return [...new Set(out)];
}

// ---------- LLM 프롬프트 · 검증 ----------
export const SYSTEM = {
  ko: "설비 로그의 알람 군집을 보고 원인 후보를 고르는 엔지니어 보조. 제공된 줄과 통계만 근거로 쓴다. 한국어로 쓴다.",
  en: "An engineering assistant that picks cause candidates for an alarm cluster in an equipment log. Use only the lines and statistics provided. Write in English.",
};
export const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    causes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          cause: { type: "string" }, reasoning: { type: "string" },
          evidence: { type: "array", items: { type: "integer" } },
          confidence: { type: "string", enum: CONF },
        },
        required: ["cause", "reasoning", "evidence", "confidence"],
        additionalProperties: false,
      },
    },
    checks: { type: "array", items: { type: "string" } },
  },
  required: ["causes", "checks"],
  additionalProperties: false,
};

export function promptFor(cluster, pre, pool, lang = "ko", rawOf = isoLine) {
  const eps = cluster.episodes;
  const top = pre.slice(0, 6);
  const lead = (p) => `${fmtMin(p.leadMed)}`;
  if (lang === "en") return [
    "Below are alarm occurrences from an equipment log that start with the same first alarm. Pick cause candidates.",
    "",
    `[Alarm] ${cluster.code} ${cluster.name} (module ${cluster.module}) — ${eps.length} occurrences`,
    "Start times: " + eps.map((ep) => fmtTime(ep.t0)).join(", "),
    "Alarm chains: " + [...cluster.signatures].map(([s, n]) => `${s} (${n}x)`).join(" / "),
    "",
    "[Warnings before the first alarm] (coverage = before how many occurrences, concentration = share of that warning right before an alarm, lead = median minutes from first warning to alarm)",
    ...(top.length ? top.map((p) => `- [${p.module}] ${p.tpl} : coverage ${p.coverage}/${p.of}, concentration ${pct(p.spec)}% (${p.inWin}/${p.total}), lead ${lead(p)} min`) : ["- none"]),
    "",
    "[Evidence lines] (line number: raw text)",
    ...pool.map((e) => `${e.n}: ${rawOf(e)}`),
    "",
    "Rules:",
    "- 1 to 3 cause candidates, most likely first",
    "- evidence of each candidate: 1 to 5 line numbers taken only from the [Evidence lines] list above",
    "- Do not invent part names or values that are not in the log. Use only numbers that appear in the evidence lines or statistics",
    "- confidence is one of high / medium / low",
    "- cause: one sentence within 120 characters; reasoning: explain with evidence lines and statistics (within 200 characters)",
    "- checks: 2 to 3 items to verify on site",
  ].join("\n");
  return [
    "다음은 설비 로그에서 같은 첫 알람으로 시작한 알람 발생들이다. 원인 후보를 고른다.",
    "",
    `[알람] ${cluster.code} ${cluster.name} (모듈 ${cluster.module}) — ${eps.length}회 발생`,
    "발생 시각: " + eps.map((ep) => fmtTime(ep.t0)).join(", "),
    "알람 연쇄: " + [...cluster.signatures].map(([s, n]) => `${s} (${n}회)`).join(" / "),
    "",
    "[첫 알람 직전 경고 통계] (coverage = 발생 중 몇 번 앞에 나왔나, 집중도 = 그 경고 전체 중 알람 직전 비율, 리드 = 첫 경고에서 알람까지 분, 중앙값)",
    ...(top.length ? top.map((p) => `- [${p.module}] ${p.tpl} : coverage ${p.coverage}/${p.of}, 집중도 ${pct(p.spec)}% (${p.inWin}/${p.total}), 리드 ${lead(p)}분`) : ["- 없음"]),
    "",
    "[근거 줄] (줄번호: 원문)",
    ...pool.map((e) => `${e.n}: ${rawOf(e)}`),
    "",
    "규칙:",
    "- 원인 후보 1~3개, 가능성이 높은 순서",
    "- 각 후보의 evidence 에는 위 [근거 줄] 목록에 있는 줄번호만 1~5개",
    "- 로그에 없는 부품명 · 수치를 지어내지 않는다. 수치는 근거 줄 · 통계에 있는 것만 쓴다",
    "- confidence 는 high / medium / low 중 하나",
    "- cause 는 한 문장 80자 이내, reasoning 은 근거 줄과 통계로 설명 (120자 이내)",
    "- checks 에는 현장에서 확인할 항목 2~3개",
  ].join("\n");
}

const VT = {
  ko: { none: "원인 후보 없음", many: (n) => `후보 ${n}개 (최대 3개)`, empty: (k) => `${k}번 원인 문장 없음`, long: (k) => `${k}번 원인 문장이 너무 김`,
    conf: (k) => `${k}번 확신도 형식`, noEv: (k) => `${k}번 근거 줄 없음`, fake: (k, x) => `${k}번 근거 목록에 없는 줄 ${x}`, num: (k, x) => `${k}번 근거에 없는 수치 ${x}` },
  en: { none: "No cause candidates", many: (n) => `${n} candidates (max 3)`, empty: (k) => `#${k} has no cause sentence`, long: (k) => `#${k} cause sentence too long`,
    conf: (k) => `#${k} confidence format`, noEv: (k) => `#${k} has no evidence lines`, fake: (k, x) => `#${k} cites lines not in the evidence list: ${x}`, num: (k, x) => `#${k} uses numbers not in the evidence: ${x}` },
};

// 원인 후보 검증: 줄 번호는 근거 목록 안에서만, 수치는 프롬프트에 있던 것만
export function validateCauses(out, pool, promptText, lang = "ko") {
  const T = VT[lang] || VT.ko;
  const bad = [];
  const causes = out && out.causes;
  if (!Array.isArray(causes) || !causes.length) return [T.none];
  if (causes.length > 3) bad.push(T.many(causes.length));
  const ok = new Set(pool.map((e) => e.n));
  const known = nums(promptText);
  causes.forEach((c, i) => {
    const k = i + 1;
    if (!c.cause || !String(c.cause).trim()) bad.push(T.empty(k));
    if (String(c.cause || "").length > 160) bad.push(T.long(k));
    if (!CONF.includes(c.confidence)) bad.push(T.conf(k));
    const ev = Array.isArray(c.evidence) ? c.evidence : [];
    if (!ev.length) bad.push(T.noEv(k));
    const fake = ev.filter((n) => !ok.has(n));
    if (fake.length) bad.push(T.fake(k, fake.join(", ")));
    const extra = [...nums(c.cause + " " + c.reasoning)].filter((n) => !known.has(n));
    if (extra.length) bad.push(T.num(k, extra.join(", ")));
  });
  return bad;
}

// Shadow 일치: LLM 1순위 근거 줄과 규칙 1순위 근거 줄이 같은 종류(모듈 + 문구 틀)의 줄을 가리키면 일치
export function agree(ruleOut, llmOut, byLine) {
  const kinds = (c) => new Set((c?.evidence || []).map((n) => byLine.get(n)).filter(Boolean).map((e) => e.module + "\u0000" + (e.tpl || e.code || e.msg)));
  const a = kinds(ruleOut?.causes?.[0]), b = kinds(llmOut?.causes?.[0]);
  for (const k of a) if (b.has(k)) return true;
  return false;
}

// ---------- 조기 경보 규칙 · 백테스트 ----------
// 규칙: [module] tpl 경고가 within 분 안에 count 번 이상 → 경보. 경보 뒤 horizon 분 안에 target 알람이 나면 적중.
export function suggestRules(entries, cls, lookback = 10 * MIN, warns = warnsOf(entries)) {
  const out = [];
  for (const c of cls) {
    const p = precursors(entries, c, lookback, warns).find((x) => x.coverage / x.of >= 0.5 && x.spec >= 0.2);
    if (p) out.push({ id: `${c.code}:${p.module}:${p.tpl}`.slice(0, 120), target: c.code, module: p.module, tpl: p.tpl, count: 2, within: 10, horizon: 30 });
  }
  return out;
}

export function ruleFires(warns, rule) {
  const hits = warns.filter((w) => w.module === rule.module && w.tpl === rule.tpl);
  const fires = [];
  let lo = 0, last = -Infinity;
  for (let i = 0; i < hits.length; i++) {
    while (hits[i].t - hits[lo].t > rule.within * MIN) lo++;
    if (i - lo + 1 >= rule.count && hits[i].t - last > rule.horizon * MIN) { fires.push({ t: hits[i].t, n: hits[i].n }); last = hits[i].t; }
  }
  return { fires, hits };
}

// 사례(=Down 시각 T, 알람 코드)마다: T 앞 horizon 안의 첫 경보 시각 → 리드 타임. 경보가 없으면 놓침.
// 오경보: 경보 뒤 horizon 안에 target 알람이 시작하는 발생이 없는 경보.
export function backtest(entries, eps, cases, rules) {
  const warns = warnsOf(entries);
  const fired = rules.map((r) => ({ r, ...ruleFires(warns, r) }));
  const rows = cases.map((c) => {
    const mine = fired.filter((f) => f.r.target === c.code || f.r.target === "*");
    let fire = null, warn = null;
    for (const f of mine) {
      const lo = c.t - f.r.horizon * MIN;
      const x = f.fires.find((z) => z.t >= lo && z.t < c.t);
      if (x && (!fire || x.t < fire.t)) fire = { ...x, rule: f.r.id };
      const w = f.hits.find((z) => z.t >= lo && z.t < c.t);
      if (w && (!warn || w.t < warn.t)) warn = w;
    }
    return { id: c.id, label: c.label, code: c.code, t: c.t, rules: mine.length, fire, warn,
      lead: fire ? c.t - fire.t : null, warnLead: warn ? c.t - warn.t : null };
  });
  let fires = 0, falseAlarms = 0;
  for (const f of fired) for (const x of f.fires) {
    fires++;
    const hit = eps.some((ep) => (ep.trigger.code === f.r.target || f.r.target === "*") && ep.t0 > x.t && ep.t0 <= x.t + f.r.horizon * MIN);
    if (!hit) falseAlarms++;
  }
  const leads = rows.filter((r) => r.lead != null).map((r) => r.lead);
  return { rows, fires, falseAlarms, caught: leads.length, missed: rows.length - leads.length, leadMed: median(leads) };
}

// ---------- 설정 한 벌로 전체 요약 (비교 화면 · 내보내기) ----------
export function summarize(entries, config, lang = "ko") {
  const cd = compileDict(config.dict);
  assignCodes(entries, cd);
  const eps = episodes(entries, config.gap * 1000);
  const cls = clusters(eps);
  const warns = warnsOf(entries);
  const lb = config.lookback * MIN;
  const rows = cls.map((c) => {
    const pre = precursors(entries, c, lb, warns);
    const rc = ruleCauses(c, pre, lang);
    return { code: c.code, name: c.name, module: c.module, n: c.episodes.length, top: rc.causes[0].cause,
      pre: pre[0] ? `[${pre[0].module}] ${pre[0].tpl}` : "", lead: pre[0]?.leadMed ?? null };
  });
  return { eps: eps.length, clusters: rows };
}

// 두 요약의 차이: 군집 단위로 바뀐 항목만 표시
export function diffSummaries(A, B) {
  const codes = [...new Set([...A.clusters.map((c) => c.code), ...B.clusters.map((c) => c.code)])];
  return codes.map((code) => {
    const a = A.clusters.find((c) => c.code === code), b = B.clusters.find((c) => c.code === code);
    const ch = (k) => (a?.[k] ?? null) !== (b?.[k] ?? null);
    return { code, a, b, changed: { n: ch("n"), top: ch("top"), pre: ch("pre"), lead: ch("lead"), exist: !a || !b } };
  });
}
