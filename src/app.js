// 화면: 불러오기 · 타임라인 · 군집 · 원인 후보(결정 + Shadow) · 현장 검증 4단계 · 로그 뷰어 · 설정 · 도움말
import * as A from "./analyze.js";
import { parseText, isoLine, FORMATS } from "./parse.js";
import { generate, CASES, DATE } from "./gen.js";
import { sampleCauses } from "./sample-causes.js";
import { STR, t, setLang, getLang, applyStatic } from "./i18n.js";
import * as db from "./store.js";
import { MODELS, compileMasks, mask, runValidated } from "./llm.js";
import { toHtml, toCsv, toJson, download } from "./export.js";

const VERSION = "1.0.1";
const SAMPLE_NAME = "spotcheck_2026-11-10.log";
const LOOKBACKS = [2, 5, 10, 30, 60];
const CRIT = { runs: 5, valid: 0.9, agree: 0.8 };
const CASE_BEFORE = 60, CASE_AFTER = 10; // 사례 발췌: Down 앞 60분 ~ 뒤 10분

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtN = (n) => Number(n).toLocaleString(getLang() === "en" ? "en-US" : "ko-KR");
const clone = (o) => JSON.parse(JSON.stringify(o));
const mins = (ms) => (ms == null ? "–" : (ms / 60e3).toFixed(1).replace(/\.0$/, ""));
const confLabel = (c) => ({ ko: { high: "높음", medium: "중간", low: "낮음" }, en: { high: "high", medium: "medium", low: "low" } }[getLang()][c] || c);

const S = {
  name: "", sample: true, entries: [], byLine: null, stats: null, meta: null, multiDay: false,
  eps: [], clusters: [], warns: [], cd: null, sel: null, selEp: 0, view: null, focus: null, highlight: new Set(),
  results: {}, shadowRes: {}, baseChoice: {}, busy: null,
  config: clone(A.DEFAULT_CONFIG), draft: null, history: [], cases: [], caseData: new Map(), shadowLog: [], cmp: null,
  settings: { lang: "ko", theme: "auto", provider: "anthropic", model: MODELS[0].id, remember: false, ollamaUrl: "http://localhost:11434", ollamaModel: "bonsai-2.5:27b", timeout: 600, maskBuiltin: true, maskCustom: "" },
  apiKey: "", readOpts: { format: "auto", encoding: "auto", tz: -new Date().getTimezoneOffset(), year: new Date().getFullYear(), csv: {}, json: {}, regex: "" },
  file: null, tab: "repro", tlTable: false, cmpChangedOnly: false, shadowDiffOnly: false,
};

// ---------- 시각 표시 ----------
const day = (t) => new Date(t).toISOString().slice(0, 10);
const hms = (t) => (S.multiDay ? new Date(t).toISOString().slice(5, 19).replace("T", " ") : new Date(t).toISOString().slice(11, 19));
const hmsms = (t) => (S.multiDay ? new Date(t).toISOString().slice(5, 23).replace("T", " ") : new Date(t).toISOString().slice(11, 23));
const hm = (t) => (S.multiDay ? new Date(t).toISOString().slice(5, 16).replace("T", " ") : new Date(t).toISOString().slice(11, 16));
const full = (t) => new Date(t).toISOString().slice(0, 19).replace("T", " ");
// 이 기기에서 일어난 일(이력 · Shadow 기록)은 기기 현지 시각으로
const local = (iso) => new Date(iso).toLocaleString(getLang() === "en" ? "en-US" : "ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

const cluster = () => S.clusters.find((c) => c.code === S.sel);
const byLine = () => (S.byLine ||= new Map(S.entries.map((e) => [e.n, e])));

function toast(msg, action) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : "");
  el.hidden = false;
  if (action) el.querySelector("button").onclick = () => { el.hidden = true; action.run(); };
  clearTimeout(toast.id);
  toast.id = setTimeout(() => { el.hidden = true; }, action ? 12000 : 3500);
}

// ---------- 저장 ----------
const saveSettings = () => db.put("kv", S.settings, "settings");
const saveConfig = () => db.put("kv", S.config, "config");
const saveUi = () => db.put("kv", { sel: S.sel, tab: S.tab, readOpts: S.readOpts }, "ui");
async function pushHistory(what) {
  const v = (S.history.at(-1)?.v || 0) + 1;
  const h = { v, t: new Date().toISOString(), what, config: clone(S.config) };
  S.history.push(h);
  await db.put("history", h);
  await saveConfig();
}

// ---------- 불러오기 · 분석 ----------
function setData(entries, name, sample, meta) {
  Object.assign(S, { name, sample, entries, meta, byLine: null, results: {}, shadowRes: {}, baseChoice: {}, focus: null, highlight: new Set(), cmp: null });
  S.stats = A.stats(entries);
  S.stats.lines = entries.length;
  S.multiDay = entries.length > 0 && day(S.stats.t0) !== day(S.stats.t1);
  S.view = entries.length ? [S.stats.t0, S.stats.t1] : null;
  renderModuleFilter();
  analyze(true);
}

function analyze(keepSel) {
  S.cd = A.compileDict(S.config.dict);
  A.assignCodes(S.entries, S.cd);
  S.eps = A.episodes(S.entries, S.config.gap * 1000);
  S.clusters = A.clusters(S.eps);
  S.warns = S.entries.filter((e) => e.sev === 2);
  S.results = {};
  if (!keepSel || !S.clusters.some((c) => c.code === S.sel)) S.sel = S.clusters[0]?.code ?? null;
  S.selEp = 0;
  renderStats();
  renderClusters();
  selectCluster(S.sel);
  renderVerify();
}

// 군집별 계산 (직전 경고 · 근거 줄 · 프롬프트 · 규칙 결과). lookback · 언어가 바뀔 때만 다시
function ctx(c) {
  const lb = S.config.lookback * 60e3, lang = getLang();
  let r = S.results[c.code];
  if (!r || r.lb !== lb || r.lang !== lang) {
    const pre = A.precursors(S.entries, c, lb, S.warns);
    const pool = A.evidencePool(S.entries, c, lb);
    r = { lb, lang, pre, pool, prompt: A.promptFor(c, pre, pool, lang), rule: A.ruleCauses(c, pre, lang) };
    const ex = S.sample && sampleCauses(c.code, lang);
    r.example = ex ? { causes: ex.causes.map((x) => ({ ...x, evidence: A.resolvePatterns(pool, x.patterns) })), checks: ex.checks } : null;
    S.results[c.code] = r;
  }
  const sh = S.shadowRes[c.code];
  const shadow = sh && sh.lb === lb ? sh : null;
  const baseHow = S.baseChoice[c.code] || (r.example ? "example" : "rule");
  const base = baseHow === "example" && r.example ? { out: r.example, how: "example" } : { out: r.rule, how: "rule" };
  let main = base, side = shadow;
  if (S.config.mode === "llm") {
    main = shadow?.valid ? { out: shadow.out, how: "llm" } : shadow ? { out: r.rule, how: "fallback" } : base;
    side = { ...base, side: true };
  }
  return { ...r, base, main, shadow, side };
}

// ---------- 렌더링: 요약 ----------
function renderStats() {
  const el = $("#stats");
  $("#export-row").hidden = !S.entries.length;
  const m = S.meta || {};
  const bad = $("#bad");
  bad.hidden = !m.badCount;
  if (m.badCount) {
    const reasons = Object.entries(m.reasons || {}).map(([k, n]) => `${t("reason_" + k)} ${fmtN(n)}`).join(" · ");
    $("#bad-sum").textContent = t("badSummary", fmtN(m.badCount)) + (reasons ? ` (${reasons})` : "");
    $("#bad-body").innerHTML = `<div class="tbl-wrap"><table class="t"><thead><tr><th>${t("lineNo")}</th><th>${t("reason")}</th><th>${t("text")}</th></tr></thead><tbody>
      ${(m.bad || []).slice(0, 50).map((b) => `<tr><td class="num">${b.n}</td><td>${esc(t("reason_" + b.reason))}</td><td class="mono">${esc(b.text)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  if (!S.entries.length) {
    el.innerHTML = `<p class="msg err">${esc(t("noLines"))}${m.bad?.length ? ` (${m.bad.slice(0, 3).map((b) => `${b.n}: ${t("reason_" + b.reason)}`).join(", ")})` : ""}.</p>`;
    return;
  }
  const st = S.stats, lv = st.levels;
  const alarms = S.eps.reduce((n, e) => n + e.alarms.length, 0);
  const range = S.multiDay ? `${full(st.t0)} ~ ${full(st.t1)}` : `${hms(st.t0)} ~ ${hms(st.t1)} · ${day(st.t0)}`;
  const fmtLabel = m.format ? `${t("formatUsed")} ${m.format.toUpperCase()}` : "";
  el.innerHTML = `
    <div><b>${esc(S.name)}</b><small>${esc(range)}${fmtLabel ? " · " + esc(fmtLabel) : ""}${m.encoding ? " · " + esc(m.encoding.toUpperCase()) : ""}${m.ms ? ` · ${(m.ms / 1000).toFixed(1)}${t("sec")}` : ""}</small></div>
    <div><b>${fmtN(S.entries.length)}</b><small>${t("lines")}${m.badCount ? ` · ${t("unread")} ${fmtN(m.badCount)}` : ""}${m.cont ? ` · ${t("contLines")} ${fmtN(m.cont)}` : ""}</small></div>
    <div><b>${fmtN(lv.INFO || 0)}</b><small>${t("info")}</small></div>
    <div><b class="c-warn">${fmtN(lv.WARN || 0)}</b><small>${t("warn")}</small></div>
    <div><b class="c-alarm">${fmtN(alarms)}</b><small>${t("alarm")}</small></div>
    <div class="arrow" aria-hidden="true">→</div>
    <div><b>${S.eps.length}</b><small>${t("episodes")}</small></div>
    <div class="arrow" aria-hidden="true">→</div>
    <div><b>${S.clusters.length}</b><small>${t("clusterUnit")}</small></div>`;
}

function renderModuleFilter() {
  const mods = S.cd ? A.lanes(S.cd, Object.keys(S.stats?.modules || {})) : Object.keys(S.stats?.modules || {}).sort();
  const cur = $("#f-module").value;
  $("#f-module").innerHTML = `<option value="">${esc(t("allModules"))}</option>` + mods.map((m) => `<option ${m === cur ? "selected" : ""}>${esc(m)}</option>`).join("");
}

// ---------- 군집 목록 ----------
function renderClusters() {
  const lang = getLang();
  $("#cluster-list").innerHTML = S.clusters.map((c) => {
    const main = [...c.signatures].sort((a, b) => b[1] - a[1])[0][0];
    const x = ctx(c);
    const top = x.main.out.causes[0];
    const g = A.groupOf(S.cd, c.code, lang);
    const p = x.pre[0];
    const lead = p && p.coverage / p.of >= 0.5 ? `<span class="cl-lead">${esc(t("leadBadge", mins(p.leadMed)))}</span>` : "";
    return `<li><button type="button" class="cl ${c.code === S.sel ? "on" : ""}" data-cl="${esc(c.code)}" aria-pressed="${c.code === S.sel}">
      <span class="cl-head"><b>${esc(c.code)}</b>${g ? `<span class="grp">${esc(g)}</span>` : ""}<span class="cl-n">${c.episodes.length}${esc(t("times"))}</span></span>
      <span class="cl-name">${esc(c.name)} <small>${esc(c.module)}</small></span>
      <span class="cl-chain">${esc(main)}</span>
      <span class="cl-times">${c.episodes.map((e) => hm(e.t0)).join(" · ")}</span>
      ${lead}
      <span class="cl-top"><i class="conf c-${esc(top.confidence)}">${esc(confLabel(top.confidence))}</i> ${esc(top.cause)}</span>
    </button></li>`;
  }).join("") || `<li class="hint">${esc(t("noAlarms"))}</li>`;
}

function selectCluster(code, focusEp = 0) {
  S.sel = code;
  S.selEp = focusEp;
  const c = cluster();
  renderClusters();
  renderDetail();
  if (c) {
    S.highlight = new Set(ctx(c).main.out.causes.flatMap((x) => x.evidence));
    S.focus = c.episodes[focusEp].trigger.n;
  }
  drawTimeline();
  renderTlTable();
  renderRows(true);
  saveUi();
}

// ---------- 군집 상세 ----------
function causeList(out) {
  return `<ol class="causes">${out.causes.map((x, i) => `<li>
    <div class="c-head"><span class="rank">${i + 1}</span><i class="conf c-${esc(x.confidence)}">${esc(confLabel(x.confidence))}</i><b>${esc(x.cause)}</b></div>
    <p>${esc(x.reasoning)}</p>
    <div class="ev">${esc(t("lineNo"))} ${(x.evidence || []).map((n) => `<button type="button" class="ln" data-ln="${n}">${n}</button>`).join("")}</div>
  </li>`).join("")}</ol>
  ${out.checks?.length ? `<h4>${esc(t("checksTitle"))}</h4><ul class="checks-list">${out.checks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
}

function shadowBlock(x) {
  const sh = x.shadow;
  if (S.busy && S.busy.code === S.sel) return `<p class="empty">${esc(t("analyzing"))} <button class="btn ghost sm" type="button" id="llm-cancel">${esc(t("cancel"))}</button></p>`;
  if (!sh) return `<p class="empty">${esc(t("shadowEmpty"))}</p>`;
  const logTxt = sh.log.map((l) => `${t("attempt", l.attempt)}: ${l.ok ? t("pass") : l.error ? `${l.error} — ${l.message}` : l.bad.join("; ")}`).join("\n");
  return `${sh.valid ? causeList(sh.out) : ""}
    <div class="verdict">${sh.valid
      ? `<p class="state ok">${esc(t("verified"))}</p> ${sh.mock ? `<p class="state mock">${esc(t("mockTag"))}</p>` : ""} <p class="state ${sh.agree ? "ok" : "bad"}">${esc(sh.agree ? t("agreeYes") : t("agreeNo"))}</p><small>${esc(t("verifiedHint", x.pool.length))}</small>`
      : `<p class="state bad">${esc(t("verifyFail"))}</p> ${sh.mock ? `<p class="state mock">${esc(t("mockTag"))}</p>` : ""}<small>${esc(t("fallbackLog"))}</small>`}</div>
    <pre class="log">${esc(t("sentLines", sh.model, x.pool.length))}\n${esc(logTxt)}</pre>`;
}

function renderDetail() {
  const c = cluster();
  const el = $("#detail");
  if (!c) { el.innerHTML = `<p class="hint">${esc(t("noCluster"))}</p>`; return; }
  const x = ctx(c), lang = getLang();
  const g = A.groupOf(S.cd, c.code, lang), mn = A.moduleName(S.cd, c.module, lang);
  const mainBad = x.main.how === "example" ? A.validateCauses(x.main.out, x.pool, x.prompt, lang) : [];
  const llm = S.config.mode === "llm";
  el.innerHTML = `
    <div class="panel-head">
      <h2><span class="code">${esc(c.code)}</span> ${esc(c.name)}</h2>
      <span class="hint">${esc(c.module)}${mn ? ` (${esc(mn)})` : ""}${g ? " · " + esc(g) : ""} · ${c.episodes.length}${esc(t("times"))}</span>
    </div>
    <div class="chains">${[...c.signatures].map(([s, n]) => `<span class="chain">${s.split(" → ").map((y, i) => `<b class="${i ? "" : "first"}">${esc(y)}</b>`).join("<i>→</i>")}<small>${n}${esc(t("times"))}</small></span>`).join("")}</div>

    <h3>${esc(t("occurrences"))}</h3>
    <div class="eps">${c.episodes.map((ep, i) => `<button type="button" class="ep ${i === S.selEp ? "on" : ""}" data-ep="${i}" aria-pressed="${i === S.selEp}">
      <b>${hms(ep.t0)}</b><small>${esc(t("alarmsN", ep.alarms.length))} · ${Math.max(1, Math.round((ep.t1 - ep.t0) / 1000))}${esc(t("sec"))} · ${esc(t("lineN", ep.trigger.n))}</small></button>`).join("")}</div>
    <div class="row"><span></span><button class="btn ghost sm" type="button" id="save-case">${esc(t("saveCase"))}</button></div>

    <h3>${esc(t("preTitle"))}
      <label class="sr-only" for="lookback">${esc(t("lookbackLabel"))}</label>
      <select id="lookback">${LOOKBACKS.map((m) => `<option value="${m}" ${m === S.config.lookback ? "selected" : ""}>${esc(t("fromMin", m))}</option>`).join("")}</select></h3>
    ${x.pre.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>${esc(t("thModule"))}</th><th>${esc(t("thWarning"))}</th>
      <th title="${esc(t("thBeforeTip"))}">${esc(t("thBefore"))}</th><th title="${esc(t("thSpecTip"))}">${esc(t("thSpec"))}</th><th title="${esc(t("thLeadTip"))}">${esc(t("thLead"))}</th><th><span class="sr-only">${esc(t("addRule"))}</span></th></tr></thead><tbody>
      ${x.pre.slice(0, 6).map((p, i) => `<tr><td class="nw">${esc(p.module)}</td><td class="mono">${esc(p.tpl)}</td><td class="num">${p.coverage}/${p.of}</td>
        <td class="num"><span class="meter" aria-hidden="true"><span style="width:${Math.round(p.spec * 100)}%"></span></span>${Math.round(p.spec * 100)}% <small>(${p.inWin}/${p.total})</small></td>
        <td class="num"><b>${mins(p.leadMed)}</b>${esc(t("min"))} <small>(${mins(p.leadMin)}~${mins(p.leadMax)})</small></td>
        <td><button type="button" class="rowbtn nw" data-addrule="${i}" aria-label="${esc(t("addRule"))}: [${esc(p.module)}] ${esc(p.tpl)}">${esc(t("addRuleShort"))}</button></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="hint">${esc(t("noWarnWin"))}</p>`}

    <h3>${esc(t("causesTitle"))}</h3>
    <div class="gen-row">
      <button class="btn sm" type="button" id="gen" ${S.busy ? "disabled" : ""}>${esc(t("genLlm"))}</button>
      ${llm ? "" : `<button class="btn ghost sm" type="button" id="use-rule">${esc(t("useRule"))}</button>`}
      ${!llm && x.example ? `<button class="btn ghost sm" type="button" id="use-example">${esc(t("useExample"))}</button>` : ""}
    </div>
    <div class="cause-cols">
      <div class="cause-col"><h4>${esc(t("decision"))}: ${esc(llm ? t("decLlm") : t("decRule"))} <small>${esc(t("how_" + x.main.how))}</small></h4>
        ${causeList(x.main.out)}
        ${mainBad.length ? `<div class="verdict"><p class="state bad">${esc(t("verifyFail"))}</p><ul>${mainBad.map((b) => `<li>${esc(b)}</li>`).join("")}</ul><small>${esc(t("exampleNarrow"))}</small></div>` : ""}
      </div>
      <div class="cause-col side"><h4>${esc(llm ? t("decRule") : t("shadowCol"))}</h4>
        ${llm ? causeList(x.side.out) : shadowBlock(x)}
      </div>
    </div>`;
}

// ---------- 타임라인 (canvas) ----------
const TL = { left: 78, right: 12, top: 24, lane: 30 };
let tlDrag = null;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function lanesNow() { return S.stats && S.cd ? A.lanes(S.cd, Object.keys(S.stats.modules)) : []; }

function drawTimeline(sel) {
  const cv = $("#timeline");
  const L = lanesNow();
  const w = cv.parentElement.clientWidth;
  const h = TL.top + Math.max(1, L.length) * TL.lane + 6;
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr;
  cv.style.width = w + "px"; cv.style.height = h + "px";
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!S.view) { cv.setAttribute("aria-label", t("noLines")); return; }
  if (w < TL.left + TL.right + 20) return; // 숨김 · 레이아웃 전 (폭 0)
  const COL = { alarm: css("--red"), warn: css("--amber-mark"), info: "#9e9e9e", band: "rgba(192,0,0,.16)", band2: "rgba(128,128,128,.10)", grid: css("--line"), text: css("--mid"), lane1: css("--card"), lane2: css("--pale"), ink: css("--ink") };
  const [a, b] = S.view;
  const pw = w - TL.left - TL.right;
  const X = (tt) => TL.left + (tt - a) / (b - a) * pw;
  g.font = "12px Pretendard, 'Malgun Gothic', sans-serif";
  L.forEach((m, i) => {
    const y = TL.top + i * TL.lane;
    g.fillStyle = i % 2 ? COL.lane2 : COL.lane1;
    g.fillRect(TL.left, y, pw, TL.lane);
    g.fillStyle = COL.text;
    g.textBaseline = "middle";
    g.fillText(m.length > 9 ? m.slice(0, 8) + "…" : m, 6, y + TL.lane / 2);
  });
  const span = b - a;
  const steps = [60e3, 300e3, 600e3, 1800e3, 3600e3, 7200e3, 21600e3, 86400e3, 7 * 86400e3];
  const step = steps.find((s) => span / s <= Math.max(4, pw / 90)) || steps.at(-1);
  g.textBaseline = "alphabetic";
  for (let tt = Math.ceil(a / step) * step; tt <= b; tt += step) {
    const x = X(tt);
    g.strokeStyle = COL.grid; g.beginPath(); g.moveTo(x, TL.top); g.lineTo(x, h - 6); g.stroke();
    const label = step >= 86400e3 ? day(tt).slice(5) : S.multiDay && step >= 3600e3 && new Date(tt).getUTCHours() === 0 ? day(tt).slice(5) : new Date(tt).toISOString().slice(11, 16);
    g.fillStyle = COL.text; g.fillText(label, x - 15, 15);
  }
  const c = cluster();
  for (const ep of S.eps) {
    if (ep.t1 < a || ep.t0 > b) continue;
    const mine = c && ep.trigger.code === c.code;
    g.fillStyle = mine ? COL.band : COL.band2;
    const x0 = X(ep.t0) - 3, x1 = Math.max(X(ep.t1) + 3, x0 + 6);
    g.fillRect(x0, TL.top, x1 - x0, L.length * TL.lane);
  }
  const li = new Map(L.map((m, i) => [m, i]));
  const bins = L.map(() => new Uint16Array(Math.ceil(pw) + 1));
  let max = 1;
  const i0 = A.lowerBound(S.entries, a), E = S.entries;
  for (let i = i0; i < E.length && E[i].t <= b; i++) {
    const e = E[i];
    if (e.sev !== 1) continue;
    const k = Math.floor((e.t - a) / (b - a) * pw);
    const v = ++bins[li.get(e.module)][k];
    if (v > max) max = v;
  }
  g.fillStyle = COL.info;
  bins.forEach((arr, i) => {
    const y = TL.top + (i + 1) * TL.lane - 2;
    for (let k = 0; k < arr.length; k++) if (arr[k]) { const hh = 2 + (TL.lane * 0.4) * Math.min(1, arr[k] / max); g.fillRect(TL.left + k, y - hh, 1, hh); }
  });
  for (const lvl of [2, 3]) {
    g.fillStyle = lvl === 3 ? COL.alarm : COL.warn;
    for (let i = i0; i < E.length && E[i].t <= b; i++) {
      const e = E[i];
      if (e.sev !== lvl) continue;
      const y = TL.top + li.get(e.module) * TL.lane;
      const x = X(e.t);
      if (lvl === 3) g.fillRect(x - 1.5, y + 3, 3, TL.lane - 6);
      else g.fillRect(x - 1, y + 8, 2, TL.lane - 16);
    }
  }
  const f = S.focus && byLine().get(S.focus);
  if (f && f.t >= a && f.t <= b) {
    const x = X(f.t);
    g.strokeStyle = COL.ink; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, TL.top - 4); g.lineTo(x, h - 6); g.stroke(); g.setLineDash([]);
  }
  if (sel) { g.fillStyle = "rgba(128,128,128,.2)"; g.fillRect(Math.min(sel[0], sel[1]), TL.top, Math.abs(sel[1] - sel[0]), L.length * TL.lane); }
  const zoomed = a !== S.stats.t0 || b !== S.stats.t1;
  $("#range").textContent = `${hms(a)} ~ ${hms(b)}${zoomed ? " " + t("zoomed") : ""}`;
  const alarms = S.eps.reduce((n, e) => n + e.alarms.length, 0);
  cv.setAttribute("aria-label", t("tlAria", { from: hms(a), to: hms(b), lanes: L.length, alarms, eps: S.eps.length }));
}

function renderTlTable() {
  const el = $("#tl-table");
  el.hidden = !S.tlTable;
  $("#timeline").parentElement.hidden = S.tlTable;
  $("#tl-table-toggle").textContent = t(S.tlTable ? "asChart" : "asTable");
  $("#tl-table-toggle").setAttribute("aria-pressed", S.tlTable);
  if (!S.tlTable) return;
  el.innerHTML = `<table class="t"><caption class="sr-only">${esc(t("timeline"))}</caption><thead><tr><th>${esc(t("tlTime"))}</th><th>${esc(t("tlEnd"))}</th><th>${esc(t("thCode"))}</th><th>${esc(t("thModule"))}</th><th>${esc(t("tlAlarms"))}</th><th>${esc(t("tlChain"))}</th><th></th></tr></thead><tbody>
    ${S.eps.map((ep) => `<tr class="${ep.trigger.code === S.sel ? "changed" : ""}"><td class="num">${hms(ep.t0)}</td><td class="num">${hms(ep.t1)}</td><td class="mono">${esc(ep.trigger.code)}</td><td>${esc(ep.trigger.module)}</td><td class="num">${ep.alarms.length}</td><td class="mono">${esc(ep.signature)}</td>
      <td><button type="button" class="rowbtn" data-cl="${esc(ep.trigger.code)}" data-cl-ep="${S.clusters.find((c) => c.code === ep.trigger.code).episodes.indexOf(ep)}">${esc(t("tlGo"))}</button></td></tr>`).join("")}
  </tbody></table>`;
}

function tAt(x) {
  const w = $("#timeline").clientWidth - TL.left - TL.right;
  const [a, b] = S.view;
  return a + Math.min(1, Math.max(0, (x - TL.left) / w)) * (b - a);
}
function nearest(x, y, minSev) {
  const [a, b] = S.view;
  const w = $("#timeline").clientWidth - TL.left - TL.right;
  const lane = lanesNow()[Math.floor((y - TL.top) / TL.lane)];
  let best = null, bd = 9;
  const E = S.entries;
  const lo = A.lowerBound(E, tAt(x - 10)), hiT = tAt(x + 10);
  for (let i = lo; i < E.length && E[i].t <= hiT; i++) {
    const e = E[i];
    if (e.sev < minSev || e.t < a || e.t > b) continue;
    const d = Math.abs(TL.left + (e.t - a) / (b - a) * w - x) + (lane && e.module !== lane ? 4 : 0);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function resetView() { if (!S.stats || !S.entries.length) return; S.view = [S.stats.t0, S.stats.t1]; drawTimeline(); renderRows(true); }
function zoomView(k, center) {
  if (!S.view) return;
  const [a, b] = S.view, span = b - a;
  const c = center ?? (a + b) / 2;
  const ns = Math.min(S.stats.t1 - S.stats.t0, Math.max(10e3, span * k));
  let na = c - ns / 2;
  na = Math.max(S.stats.t0, Math.min(na, S.stats.t1 - ns));
  S.view = [na, na + ns];
  drawTimeline();
}
function panView(frac) {
  if (!S.view) return;
  const [a, b] = S.view, span = b - a;
  const na = Math.max(S.stats.t0, Math.min(a + span * frac, S.stats.t1 - span));
  S.view = [na, na + span];
  drawTimeline();
}

function bindTimeline() {
  const cv = $("#timeline");
  cv.addEventListener("pointerdown", (e) => { if (!S.view) return; tlDrag = [e.offsetX, e.offsetX]; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointermove", (e) => {
    if (!S.view) return;
    if (tlDrag) { tlDrag[1] = e.offsetX; drawTimeline(tlDrag); return; }
    const n = nearest(e.offsetX, e.offsetY, 2);
    const tip = $("#tip");
    tip.hidden = false;
    tip.innerHTML = n ? `<b>${n.n}</b> ${hmsms(n.t)} <i class="lv lv-${n.level}">${n.level}</i> [${esc(n.module)}] ${esc(n.msg)}` : hms(tAt(e.offsetX));
    tip.style.left = Math.max(0, Math.min(e.offsetX + 12, cv.clientWidth - tip.offsetWidth - 4)) + "px";
    tip.style.top = e.offsetY + 14 + "px";
  });
  cv.addEventListener("pointerleave", () => { $("#tip").hidden = true; });
  cv.addEventListener("pointerup", (e) => {
    if (!tlDrag) return;
    const [x0, x1] = tlDrag;
    tlDrag = null;
    if (Math.abs(x1 - x0) > 6) {
      const a = tAt(Math.min(x0, x1)), b = tAt(Math.max(x0, x1));
      if (b - a > 5e3) S.view = [a, b];
      drawTimeline();
      renderRows(true);
      return;
    }
    const al = nearest(e.offsetX, e.offsetY, 3);
    if (al) {
      const c = S.clusters.find((cc) => cc.episodes.some((ep) => ep.alarms.includes(al)));
      const i = c.episodes.findIndex((ep) => ep.alarms.includes(al));
      S.sel = c.code; S.selEp = i;
      renderClusters(); renderDetail();
      S.highlight = new Set(ctx(c).main.out.causes.flatMap((x) => x.evidence));
      focusLine(al.n);
      return;
    }
    const w = nearest(e.offsetX, e.offsetY, 2);
    if (w) focusLine(w.n); else drawTimeline();
  });
  cv.addEventListener("dblclick", resetView);
  cv.addEventListener("keydown", (e) => {
    const k = { ArrowLeft: () => panView(-0.2), ArrowRight: () => panView(0.2), "+": () => zoomView(0.5), "=": () => zoomView(0.5), "-": () => zoomView(2), "0": resetView }[e.key];
    if (k) { e.preventDefault(); k(); renderRows(true); }
  });
  new ResizeObserver(() => drawTimeline()).observe(cv.parentElement);
}

// ---------- 로그 뷰어 ----------
function filtered() {
  const lv = +$("#f-level").value, mod = $("#f-module").value, q = $("#f-text").value.trim().toLowerCase();
  const [a, b] = S.view || [-Infinity, Infinity];
  const E = S.entries, out = [];
  for (let i = S.view ? A.lowerBound(E, a) : 0; i < E.length && E[i].t <= b; i++) {
    const e = E[i];
    if (e.sev >= lv && (!mod || e.module === mod) && (!q || (e.module + " " + e.msg).toLowerCase().includes(q))) out.push(e);
  }
  return out;
}

function renderRows(scroll) {
  const list = filtered();
  let i0 = 0;
  const fi = S.focus ? list.findIndex((e) => e.n === S.focus) : -1;
  if (fi >= 0) i0 = Math.max(0, fi - 120);
  const shown = list.slice(i0, i0 + 400);
  $("#viewer-count").textContent = list.length > shown.length ? t("shownFrom", fmtN(list.length), shown.length, shown.length ? shown[0].n : 0) : `${fmtN(list.length)} ${t("lines")}`;
  const box = $("#rows");
  box.innerHTML = shown.map((e) => `<div class="r ${e.n === S.focus ? "focus" : ""} ${S.highlight.has(e.n) ? "hl" : ""} sev${e.sev}" data-row="${e.n}" id="row-${e.n}" role="option" aria-selected="${e.n === S.focus}">
    <span class="n">${e.n}</span><span class="t">${hmsms(e.t)}</span><span class="lv lv-${e.level}">${e.level}</span><span class="m">${esc(e.module)}</span><span class="tx">${esc(e.msg)}${e.cont ? ` <small>(+${e.cont})</small>` : ""}</span></div>`).join("")
    || `<p class="hint pad">${esc(t("noRows"))}</p>`;
  if (S.focus && shown.some((e) => e.n === S.focus)) box.setAttribute("aria-activedescendant", "row-" + S.focus); else box.removeAttribute("aria-activedescendant");
  if (scroll) {
    const row = box.querySelector(".r.focus");
    box.scrollTop = row ? row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2 : 0;
  }
}

function focusLine(n) {
  S.focus = n;
  const e = byLine().get(n);
  if (e && S.view && (e.t < S.view[0] || e.t > S.view[1])) S.view = [S.stats.t0, S.stats.t1];
  const lv = +$("#f-level").value;
  if (e && (e.sev < lv || ($("#f-module").value && $("#f-module").value !== e.module))) { $("#f-level").value = "0"; $("#f-module").value = ""; }
  drawTimeline();
  renderRows(true);
  $("#rows").closest(".viewer").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
}

function bindViewer() {
  for (const id of ["f-level", "f-module"]) $("#" + id).addEventListener("change", () => renderRows(true));
  $("#f-text").addEventListener("input", () => renderRows(false));
  $("#rows").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "PageDown" && e.key !== "PageUp") return;
    e.preventDefault();
    const list = filtered();
    if (!list.length) return;
    const i = Math.max(0, list.findIndex((x) => x.n === S.focus));
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 20, PageUp: -20 }[e.key];
    S.focus = list[Math.max(0, Math.min(list.length - 1, i + step))].n;
    renderRows(true);
    drawTimeline();
  });
}

// ---------- 현장 검증: 재현 ----------
let sampleText = null;
const sample = () => (sampleText ||= generate());

function builtinCases() {
  const lang = getLang();
  return CASES.map((c) => ({ id: c.id, builtin: true, label: c.label[lang], code: c.code, t: Date.parse(`${DATE}T${c.at}Z`), source: SAMPLE_NAME }));
}
const allCases = () => [...builtinCases(), ...S.cases];

// 사례 발췌 텍스트 → 항목 (사전 · 간격이 바뀌면 코드 · 발생을 다시 계산)
function caseEntries(c) {
  let e = S.caseData.get(c.id);
  if (!e) {
    const text = c.builtin ? sampleCut(c.t) : c.lines;
    e = parseText(text, { format: "iso", tz: 0 }).entries;
    S.caseData.set(c.id, e);
  }
  return e;
}
function sampleCut(T) {
  const p = sampleCut.p ||= parseText(sample(), { format: "iso", tz: 0 }).entries;
  return p.filter((e) => e.t >= T - CASE_BEFORE * 60e3 && e.t <= T + CASE_AFTER * 60e3).map(isoLine).join("\n");
}

function runBacktest(config) {
  const cd = A.compileDict(config.dict);
  const rows = allCases().map((c) => {
    const E = caseEntries(c);
    A.assignCodes(E, cd);
    const eps = A.episodes(E, config.gap * 1000);
    return { ...A.backtest(E, eps, [c], config.rules).rows[0], source: c.source, builtin: c.builtin };
  });
  A.assignCodes(S.entries, cd);
  const cur = A.backtest(S.entries, A.episodes(S.entries, config.gap * 1000), [], config.rules);
  const leads = rows.filter((r) => r.lead != null).map((r) => r.lead).sort((a, b) => a - b);
  const med = leads.length ? (leads.length % 2 ? leads[leads.length >> 1] : (leads[leads.length / 2 - 1] + leads[leads.length / 2]) / 2) : null;
  return { rows, caught: leads.length, total: rows.length, leadMed: med, fires: cur.fires, falseAlarms: cur.falseAlarms };
}

function btTable(bt) {
  return `<div class="tbl-wrap"><table class="t"><thead><tr><th>${esc(t("thCase"))}</th><th>${esc(t("thCode"))}</th><th>${esc(t("thDown"))}</th><th>${esc(t("thFirstWarn"))}</th><th>${esc(t("thFire"))}</th><th>${esc(t("thLeadMin"))}</th><th>${esc(t("thResult"))}</th></tr></thead><tbody>
    ${bt.rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="mono">${esc(r.code)}</td><td class="num">${esc(full(r.t))}</td>
      <td class="num">${r.warn ? `${mins(r.warnLead)}${esc(t("min"))}` : "–"}</td><td class="num">${r.fire ? esc(full(r.fire.t).slice(11)) : "–"}</td>
      <td class="num"><b>${r.lead != null ? mins(r.lead) + esc(t("min")) : "–"}</b></td>
      <td>${r.rules ? (r.lead != null ? `<span class="ok-t">${esc(t("caught"))}</span>` : `<span class="bad-t">${esc(t("missed"))}</span>`) : `<span class="hint">${esc(t("noRule"))}</span>`}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function renderRepro() {
  const bt = runBacktest(S.config);
  A.assignCodes(S.entries, S.cd);
  $("#vp-repro").innerHTML = `
    <h3>${esc(t("reproTitle"))} <small>${esc(t("reproHint"))}</small></h3>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>${esc(t("thCase"))}</th><th>${esc(t("thCode"))}</th><th>${esc(t("thDown"))}</th><th>${esc(t("thSource"))}</th><th></th></tr></thead><tbody>
      ${allCases().map((c) => `<tr><td>${esc(c.label)}${c.builtin ? ` <span class="grp">${esc(t("builtin"))}</span>` : ""}</td><td class="mono">${esc(c.code)}</td><td class="num">${esc(full(c.t))}</td><td>${esc(c.source)}</td>
        <td><button type="button" class="rowbtn" data-case-open="${esc(c.id)}">${esc(t("open"))}</button> ${c.builtin ? "" : `<button type="button" class="rowbtn" data-case-del="${esc(c.id)}">${esc(t("del"))}</button>`}</td></tr>`).join("")}
    </tbody></table></div>
    <h3>${esc(t("btTitle"))}</h3>
    <div class="kpis">
      <div class="kpi"><b>${bt.caught} / ${bt.total}</b><small>${esc(t("btCaught"))}</small></div>
      <div class="kpi"><b>${mins(bt.leadMed)}${bt.leadMed != null ? esc(t("min")) : ""}</b><small>${esc(t("btLead"))}</small></div>
      <div class="kpi"><b>${esc(t("btFalseOf", bt.falseAlarms, bt.fires))}</b><small>${esc(t("btFalse"))}</small></div>
    </div>
    ${S.config.rules.length ? btTable(bt) : `<p class="empty">${esc(t("noRules"))}</p>`}`;
}

// ---------- 현장 검증: 비교 ----------
function ruleRows(cfg, editable) {
  if (!cfg.rules.length) return `<p class="hint">${esc(t("noRules"))}</p>`;
  return `<div class="tbl-wrap"><table class="t"><thead><tr><th>${esc(t("thTarget"))}</th><th>${esc(t("thWarning"))}</th><th>${esc(t("thCount"))}</th><th>${esc(t("thWithin"))}</th><th>${esc(t("thHorizon"))}</th>${editable ? "<th></th>" : ""}</tr></thead><tbody>
    ${cfg.rules.map((r, i) => `<tr><td class="mono">${esc(r.target)}</td><td class="mono">[${esc(r.module)}] ${esc(r.tpl)}</td>
      ${["count", "within", "horizon"].map((k) => `<td class="num">${editable ? `<input type="number" min="1" max="${k === "count" ? 50 : 600}" value="${r[k]}" data-rk="${k}" data-ri="${i}" aria-label="${esc(t(k === "count" ? "thCount" : k === "within" ? "thWithin" : "thHorizon"))} ${esc(r.target)}">` : r[k]}</td>`).join("")}
      ${editable ? `<td><button type="button" class="rowbtn" data-rdel="${i}">${esc(t("del"))}</button></td>` : ""}</tr>`).join("")}
  </tbody></table></div>`;
}

function renderCompare() {
  S.draft ||= clone(S.config);
  const d = S.draft;
  const cmp = S.cmp;
  let res = "";
  if (cmp) {
    const kp = (label, a, b, fmt = (x) => x) => `<div class="kpi ${a !== b ? "fail" : ""}"><b>${esc(fmt(a))} → ${esc(fmt(b))}</b><small>${esc(label)}</small></div>`;
    const rows = cmp.diff.filter((r) => !S.cmpChangedOnly || Object.values(r.changed).some(Boolean));
    const cell = (v, ch) => `<td class="${ch ? "changed" : ""}">${ch ? `<b>${esc(v ?? "–")}</b>` : esc(v ?? "–")}</td>`;
    const caseRows = cmp.btA.rows.map((ra, i) => ({ ra, rb: cmp.btB.rows[i] }));
    const nChanged = cmp.diff.filter((r) => Object.values(r.changed).some(Boolean)).length + caseRows.filter(({ ra, rb }) => ra.lead !== rb.lead).length;
    res = `<h3>${esc(t("cmpSummary"))} <small>${esc(t("changedN", nChanged))}</small></h3>
      <div class="kpis">
        ${kp(t("episodes"), cmp.A.eps, cmp.B.eps)}${kp(t("clusterUnit"), cmp.A.clusters.length, cmp.B.clusters.length)}
        ${kp(t("btCaught"), `${cmp.btA.caught}/${cmp.btA.total}`, `${cmp.btB.caught}/${cmp.btB.total}`)}
        ${kp(t("btLead"), cmp.btA.leadMed, cmp.btB.leadMed, (x) => mins(x) + (x != null ? t("min") : ""))}
        ${kp(t("btFalse"), t("btFalseOf", cmp.btA.falseAlarms, cmp.btA.fires), t("btFalseOf", cmp.btB.falseAlarms, cmp.btB.fires))}
      </div>
      <h3>${esc(t("cmpCases"))}</h3>
      <div class="tbl-wrap"><table class="t"><thead><tr><th>${esc(t("thCase"))}</th><th>${esc(t("thCode"))}</th><th>A ${esc(t("thLeadMin"))}</th><th>B ${esc(t("thLeadMin"))}</th></tr></thead><tbody>
        ${caseRows.map(({ ra, rb }) => `<tr><td>${esc(ra.label)}</td><td class="mono">${esc(ra.code)}</td>${cell(ra.lead != null ? mins(ra.lead) + t("min") : t("missed"), false)}${cell(rb.lead != null ? mins(rb.lead) + t("min") : t("missed"), ra.lead !== rb.lead)}</tr>`).join("")}
      </tbody></table></div>
      <h3>${esc(t("cmpClusters"))} <label class="hint"><input type="checkbox" id="cmp-changed" ${S.cmpChangedOnly ? "checked" : ""}> ${esc(t("changedOnly"))}</label></h3>
      <div class="tbl-wrap"><table class="t"><thead><tr><th>${esc(t("thCode"))}</th><th>A ${esc(t("occurrences"))}</th><th>B ${esc(t("occurrences"))}</th><th>A ${esc(t("topPre"))}</th><th>B ${esc(t("topPre"))}</th><th>A ${esc(t("thLead"))}</th><th>B ${esc(t("thLead"))}</th><th>B ${esc(t("topCause"))}</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r.changed.exist ? "changed" : ""}"><td class="mono nw">${esc(r.code)}</td>${cell(r.a?.n, false)}${cell(r.b?.n, r.changed.n)}${cell(r.a?.pre, false)}${cell(r.b?.pre, r.changed.pre)}
          ${cell(r.a ? mins(r.a.lead) : null, false)}${cell(r.b ? mins(r.b.lead) : null, r.changed.lead)}${cell(r.b?.top, r.changed.top)}</tr>`).join("")}
      </tbody></table></div>
      <div class="row end"><button class="btn ghost sm" type="button" id="cmp-reset">${esc(t("resetDraft"))}</button><button class="btn sm" type="button" id="cmp-apply">${esc(t("applyB"))}</button></div>`;
  }
  $("#vp-compare").innerHTML = `
    <h3>${esc(t("cmpTitle"))} <small>${esc(t("cmpHint"))}</small></h3>
    <div class="vs">
      <div class="cfg"><h4>${esc(t("cfgA"))}</h4>
        <p class="hint">${esc(t("gapLabel"))} <b>${S.config.gap}</b> · ${esc(t("lookbackLabel"))} <b>${S.config.lookback}</b></p>
        ${ruleRows(S.config, false)}</div>
      <div class="cfg"><h4>${esc(t("cfgB"))}</h4>
        <div class="row" style="justify-content:flex-start">
          <label class="field">${esc(t("gapLabel"))}<input type="number" id="d-gap" min="10" max="3600" step="10" value="${d.gap}"></label>
          <label class="field">${esc(t("lookbackLabel"))}<input type="number" id="d-lookback" min="1" max="240" value="${d.lookback}"></label>
        </div>
        <h4>${esc(t("rulesTitle"))}</h4>
        ${ruleRows(d, true)}
        <div class="row"><button class="btn ghost sm" type="button" id="d-suggest">${esc(t("suggest"))}</button></div>
        <details><summary class="hint">${esc(t("dictTitle"))}</summary><textarea id="d-dict" rows="10" spellcheck="false">${esc(JSON.stringify(d.dict, null, 2))}</textarea></details>
        <p id="d-err" class="msg err" role="alert"></p>
        <div class="row end"><button class="btn sm" type="button" id="d-run">${esc(t("runCompare"))}</button></div>
      </div>
    </div>
    <div id="cmp-res">${res}</div>`;
}

function readDraftDict() {
  const ta = $("#d-dict");
  if (!ta) return true;
  try { S.draft.dict = JSON.parse(ta.value); A.compileDict(S.draft.dict); return true; }
  catch { $("#d-err").textContent = t("dictErr"); return false; }
}

function runCompare() {
  if (!readDraftDict()) return;
  if (JSON.stringify(S.draft) === JSON.stringify(S.config)) { $("#d-err").textContent = t("cmpNone"); S.cmp = null; return; }
  const lang = getLang();
  const As = A.summarize(S.entries, S.config, lang), Bs = A.summarize(S.entries, S.draft, lang);
  const btA = runBacktest(S.config), btB = runBacktest(S.draft);
  A.assignCodes(S.entries, S.cd);
  S.cmp = { A: As, B: Bs, diff: A.diffSummaries(As, Bs), btA, btB };
  renderCompare();
}

// ---------- 현장 검증: Shadow · 전환 ----------
function shadowStats() {
  const recs = S.shadowLog.filter((r) => r.provider === S.settings.provider);
  const valid = recs.filter((r) => r.valid);
  const vr = recs.length ? valid.length / recs.length : 0;
  const ar = valid.length ? valid.filter((r) => r.agree).length / valid.length : 0;
  return { recs, n: recs.length, vr, ar, ok: recs.length >= CRIT.runs && vr >= CRIT.valid && ar >= CRIT.agree };
}

function renderShadow() {
  const st = shadowStats();
  const list = [...S.shadowLog].reverse().filter((r) => !S.shadowDiffOnly || !r.valid || !r.agree);
  const pc = (x) => Math.round(x * 100) + "%";
  $("#vp-shadow").innerHTML = `
    <h3>${esc(t("shTitle"))} <small>${esc(t("shHint"))}</small></h3>
    <div class="kpis">
      <div class="kpi ${st.n >= CRIT.runs ? "pass" : "fail"}"><b>${st.n}</b><small>${esc(t("crRuns", CRIT.runs))}</small></div>
      <div class="kpi ${st.vr >= CRIT.valid && st.n ? "pass" : "fail"}"><b>${pc(st.vr)}</b><small>${esc(t("crValid", CRIT.valid * 100))}</small></div>
      <div class="kpi ${st.ar >= CRIT.agree && st.n ? "pass" : "fail"}"><b>${pc(st.ar)}</b><small>${esc(t("crAgree", CRIT.agree * 100))}</small></div>
    </div>
    ${S.shadowLog.length ? `<div class="row"><label class="hint"><input type="checkbox" id="sh-diff" ${S.shadowDiffOnly ? "checked" : ""}> ${esc(t("diffOnly"))}</label><button class="btn ghost sm" type="button" id="sh-clear">${esc(t("clearShadow"))}</button></div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>${esc(t("thTime"))}</th><th>${esc(t("thCode"))}</th><th>${esc(t("thModel"))}</th><th>${esc(t("thValid"))}</th><th>${esc(t("thAgree"))}</th><th>${esc(t("thRuleTop"))}</th><th>${esc(t("thLlmTop"))}</th></tr></thead><tbody>
      ${list.slice(0, 100).map((r) => `<tr class="${!r.valid || !r.agree ? "changed" : ""}"><td class="num">${esc(local(r.t))}</td><td class="mono">${esc(r.code)}</td><td>${esc(r.provider)} · ${esc(r.model)}</td>
        <td>${r.valid ? `<span class="ok-t">${esc(t("yes"))}</span>` : `<span class="bad-t">${esc(t("no"))}</span>`}</td><td>${r.valid ? esc(r.agree ? t("yes") : t("no")) : "–"}</td>
        <td>${esc(r.ruleTop)}</td><td>${esc(r.llmTop || (r.reasons || []).join("; "))}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="empty">${esc(t("noShadow"))}</p>`}`;
}

function renderSwitch() {
  const st = shadowStats();
  const llm = S.config.mode === "llm";
  const curV = S.history.at(-1)?.v;
  $("#vp-switch").innerHTML = `
    <h3>${esc(t("swTitle"))}</h3>
    <p><b>${esc(llm ? t("modeLlm") : t("modeRule"))}</b></p>
    <div class="row" style="justify-content:flex-start">
      ${llm ? `<button class="btn sm" type="button" id="sw-back">${esc(t("swBack"))}</button>`
        : `<button class="btn sm" type="button" id="sw-go" ${st.ok ? "" : "disabled aria-describedby=\"sw-why\""}>${esc(t("swGo"))}</button>${st.ok ? "" : `<span class="hint" id="sw-why">${esc(t("swLocked"))}</span>`}`}
    </div>
    <h3>${esc(t("histTitle"))}</h3>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>${esc(t("thVer"))}</th><th>${esc(t("thTime"))}</th><th>${esc(t("thWhat"))}</th><th>${esc(t("gapLabel"))}</th><th>${esc(t("lookbackLabel"))}</th><th>${esc(t("rulesTitle"))}</th><th>${esc(t("swTitle"))}</th><th></th></tr></thead><tbody>
      ${[...S.history].reverse().map((h) => `<tr><td class="num">v${h.v}</td><td class="num">${esc(local(h.t))}</td><td>${esc(histWhat(h.what))}</td>
        <td class="num">${h.config.gap}</td><td class="num">${h.config.lookback}</td><td class="num">${h.config.rules.length}</td><td>${esc(t(h.config.mode === "llm" ? "decLlm" : "decRule"))}</td>
        <td>${h.v === curV ? `<span class="hint">${esc(t("current"))}</span>` : `<button type="button" class="rowbtn" data-restore="${h.v}">${esc(t("restore"))}</button>`}</td></tr>`).join("")}
    </tbody></table></div>`;
}
const histWhat = (w) => (Array.isArray(w) ? t(w[0], ...w.slice(1)) : t(w));

function renderVerify() {
  $("#mode-badge").textContent = S.config.mode === "llm" ? t("decLlm") : t("modeRule");
  $("#mode-badge").className = "badge" + (S.config.mode === "llm" ? " llm" : "");
  if (S.tab === "repro") renderRepro();
  if (S.tab === "compare") renderCompare();
  if (S.tab === "shadow") renderShadow();
  if (S.tab === "switch") renderSwitch();
}

function selectTab(tab, focus) {
  S.tab = tab;
  for (const b of $$(".vtabs [role=tab]")) {
    const on = b.id === "vt-" + tab;
    b.setAttribute("aria-selected", on);
    b.tabIndex = on ? 0 : -1;
    $("#" + b.getAttribute("aria-controls")).hidden = !on;
    if (on && focus) b.focus();
  }
  renderVerify();
  saveUi();
}

async function applyConfig(cfg, what) {
  S.config = clone(cfg);
  S.draft = clone(cfg);
  S.cmp = null;
  S.shadowRes = {};
  await pushHistory(what);
  S.caseData = new Map();
  analyze(true);
}

// 대화상자 결과: close 이벤트 대신 submit(누른 버튼 값) · cancel(Esc) 으로 받는다
function ask(dlg, yes) {
  const f = dlg.querySelector("form");
  dlg.showModal();
  return new Promise((r) => {
    const done = (v) => { f.removeEventListener("submit", onSub); dlg.removeEventListener("cancel", onCancel); r(v); };
    const onSub = (e) => done(e.submitter?.value === yes);
    const onCancel = () => done(false);
    f.addEventListener("submit", onSub);
    dlg.addEventListener("cancel", onCancel);
  });
}

// ---------- LLM (Shadow) ----------
function llmReady() {
  const s = S.settings;
  if (s.provider === "anthropic") return !!S.apiKey;
  if (s.provider === "ollama") return !!s.ollamaModel;
  return s.provider === "mock";
}
function modelLabel() {
  const s = S.settings;
  return s.provider === "anthropic" ? s.model : s.provider === "ollama" ? s.ollamaModel : "mock";
}

async function analyzeWithLLM(c) {
  if (!llmReady()) { openSettings(); $("#settings-err").textContent = t("needKey"); return; }
  if (S.busy) return;
  const x = ctx(c), s = S.settings;
  const m = mask(x.prompt, compileMasks(s.maskBuiltin, s.maskCustom));
  const html = esc(m.text).replace(/\[(IP|MAC|MAIL|PATH|ID|LOT|HOST|SN|X\d+)-\d+\]/g, (z) => `<mark>${z}</mark>`);
  $("#pv-text").innerHTML = html;
  $("#pv-meta").textContent = t("pvMeta", { provider: s.provider, model: modelLabel(), lines: x.pool.length, chars: m.text.length, masked: m.masked, timeout: s.timeout });
  const ok = await ask($("#preview"), "send");
  if (!ok) return;
  const ctl = new AbortController();
  S.busy = { code: c.code, ctl };
  renderDetail();
  const lang = getLang();
  try {
    const res = await runValidated({ provider: s.provider, apiKey: S.apiKey, model: modelLabel(), ollamaUrl: s.ollamaUrl, prompt: m.text, pool: x.pool, lang,
      timeoutS: s.timeout, signal: ctl.signal, ctx: { pool: x.pool, pre: x.pre, code: c.code, lang } });
    const agreeV = res.valid ? A.agree(x.rule, res.out, byLine()) : false;
    S.shadowRes[c.code] = { lb: x.lb, out: res.out, valid: res.valid, log: res.log, model: res.model, agree: agreeV, mock: s.provider === "mock" };
    const canceled = res.log.some((l) => l.error === "canceled");
    if (!canceled) {
      const rec = { t: new Date().toISOString(), file: S.name, code: c.code, provider: s.provider, model: res.model, valid: res.valid, attempts: res.attempts, agree: agreeV,
        ruleTop: x.rule.causes[0]?.cause || "", llmTop: res.valid ? res.out.causes[0]?.cause || "" : "", reasons: res.log.flatMap((l) => l.bad || (l.message ? [l.message] : [])).slice(0, 4) };
      S.shadowLog.push(rec);
      await db.put("shadow", rec);
    }
  } finally {
    S.busy = null;
  }
  if (cluster() === c) { renderDetail(); renderClusters(); S.highlight = new Set(ctx(c).main.out.causes.flatMap((y) => y.evidence)); renderRows(false); }
  else renderClusters();
  renderVerify();
}

// ---------- 파일 ----------
let worker = null;
function readFile(file, opts = S.readOpts) {
  if (!file) return;
  const mb = file.size / 1048576;
  if (mb > 1024 && !confirm(t("tooBig", Math.round(mb)))) return;
  if (mb > 200) toast(t("big"));
  S.file = file;
  worker?.terminate();
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  const parts = [];
  $("#progress").hidden = false;
  $("#progress-bar").style.width = "0";
  $("#progress-text").textContent = t("reading");
  worker.onmessage = async ({ data }) => {
    if (data.type === "batch") { parts.push(data.entries); return; }
    if (data.type === "progress") {
      $("#progress-bar").style.width = (100 * data.done / data.total).toFixed(1) + "%";
      $("#progress-text").textContent = `${t("reading")} ${Math.round(data.done / 1048576)} / ${Math.round(data.total / 1048576)} MB`;
      return;
    }
    $("#progress").hidden = true;
    worker.terminate(); worker = null;
    if (data.type === "canceled") return;
    if (data.type === "error") {
      const key = { "csv-columns": "err_csvColumns", "regex-invalid": "err_regexInvalid", "regex-groups": "err_regexGroups" }[data.code];
      $("#stats").innerHTML = `<p class="msg err" role="alert">${esc(key ? t(key) : t("err_read") + ": " + data.code)}</p>`;
      if (key) $("#read-opts").open = true;
      return;
    }
    const entries = data.replace ? data.entries : parts.length ? parts.flat().concat(data.entries) : data.entries;
    $("#load-sample").classList.remove("on");
    setData(entries, file.name, false, data.meta);
    try {
      if (file.size < 200 * 1048576) { await db.put("files", file, "last"); await db.put("kv", { name: file.name, sample: false }, "last"); }
      else await db.put("kv", { name: file.name, sample: false, notSaved: true }, "last");
    } catch (e) { db.logError(e); }
  };
  worker.onerror = (e) => { $("#progress").hidden = true; $("#stats").innerHTML = `<p class="msg err" role="alert">${esc(t("err_read"))}: ${esc(e.message)}</p>`; db.logError(e); };
  worker.postMessage({ type: "parse", file, opts: { ...opts, csv: { ...opts.csv }, json: { ...opts.json } } });
}

function loadSample() {
  const p = parseText(sample(), { format: "iso", tz: 0 });
  $("#load-sample").classList.add("on");
  S.file = null;
  setData(p.entries, SAMPLE_NAME, true, { format: "iso", encoding: "utf-8", badCount: 0, bad: [], reasons: {}, cont: 0 });
  db.put("kv", { name: SAMPLE_NAME, sample: true }, "last");
}

function loadCase(id) {
  const c = allCases().find((x) => x.id === id);
  if (!c) return;
  const text = c.builtin ? sampleCut(c.t) : c.lines;
  const p = parseText(text, { format: "iso", tz: 0 });
  S.file = null;
  $("#load-sample").classList.remove("on");
  setData(p.entries, c.label, c.builtin, { format: "iso", encoding: "utf-8", badCount: 0, bad: [], reasons: {}, cont: 0 });
  const cl = S.clusters.find((x) => x.code === c.code);
  if (cl) selectCluster(cl.code, Math.max(0, cl.episodes.findIndex((ep) => Math.abs(ep.t0 - c.t) < 1000)));
}

async function saveCase() {
  const c = cluster();
  if (!c) return;
  const ep = c.episodes[S.selEp] || c.episodes[0];
  const label = prompt(t("casePrompt"), `${c.code} ${c.name} ${full(ep.t0)}`);
  if (!label) return;
  const lo = A.lowerBound(S.entries, ep.t0 - CASE_BEFORE * 60e3);
  const lines = [];
  for (let i = lo; i < S.entries.length && S.entries[i].t <= ep.t1 + CASE_AFTER * 60e3 && lines.length < 50000; i++) lines.push(isoLine(S.entries[i]));
  const rec = { id: "c" + Date.now().toString(36), label: label.slice(0, 120), code: c.code, t: ep.t0, source: S.name, created: new Date().toISOString(), lines: lines.join("\n") };
  S.cases.push(rec);
  await db.put("cases", rec);
  toast(t("caseSaved"));
  if (S.tab === "repro") renderRepro();
}

function downloadSample() { download(SAMPLE_NAME, sample(), "text/plain"); }

// ---------- 내보내기 ----------
function report() {
  const lang = getLang();
  const L = new Proxy({}, { get: (_, k) => t(k) });
  const bl = byLine();
  const lines = new Map();
  const cls = S.clusters.map((c) => {
    const x = ctx(c);
    for (const ca of x.main.out.causes) for (const n of ca.evidence) lines.set(n, bl.get(n) ? isoLine(bl.get(n)) : "");
    return { code: c.code, name: c.name, module: c.module, group: A.groupOf(S.cd, c.code, lang), n: c.episodes.length, signatures: c.signatures, episodes: c.episodes, pre: x.pre,
      causes: x.main.out.causes.map((ca) => ({ ...ca, confidenceLabel: confLabel(ca.confidence) })), checks: x.main.out.checks, how: x.main.how, howLabel: t("how_" + x.main.how), lines,
      firstWarn: (ep, p) => { const lo = A.lowerBound(S.warns, ep.t0 - x.lb); for (let i = lo; i < S.warns.length && S.warns[i].t < ep.t0; i++) if (S.warns[i].module === p.module && S.warns[i].tpl === p.tpl) return S.warns[i].t; return null; } };
  });
  const bt = S.config.rules.length ? runBacktest(S.config) : null;
  A.assignCodes(S.entries, S.cd);
  return { title: t("reportTitle"), name: S.name, generated: new Date().toISOString().slice(0, 19).replace("T", " "), version: VERSION, lang, L,
    stats: { t0: S.stats.t0, t1: S.stats.t1, lines: S.entries.length, eps: S.eps.length }, clusters: cls, backtest: bt, config: S.config };
}
const baseName = () => S.name.replace(/\.[^.]+$/, "") || "log";

// ---------- 설정 ----------
function openSettings() {
  const s = S.settings;
  $("#s-provider").value = s.provider;
  $("#s-key").value = S.apiKey;
  $("#s-remember").checked = s.remember;
  $("#s-model").innerHTML = MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model ? "selected" : ""}>${esc(m.label)}</option>`).join("");
  $("#s-ourl").value = s.ollamaUrl;
  $("#s-omodel").value = s.ollamaModel;
  $("#s-timeout").value = s.timeout;
  $("#s-mask-builtin").checked = s.maskBuiltin;
  $("#s-mask-custom").value = s.maskCustom;
  $("#settings-err").textContent = "";
  showProv();
  $("#settings").showModal();
}
const showProv = () => $$("[data-prov]").forEach((el) => { el.hidden = el.dataset.prov !== $("#s-provider").value; });

async function saveSettingsForm(e) {
  const to = +$("#s-timeout").value;
  if (!(to >= 10 && to <= 600)) { e.preventDefault(); $("#settings-err").textContent = "10 ~ 600"; return; }
  const s = S.settings;
  Object.assign(s, { provider: $("#s-provider").value, model: $("#s-model").value, remember: $("#s-remember").checked, ollamaUrl: $("#s-ourl").value.trim() || "http://localhost:11434",
    ollamaModel: $("#s-omodel").value.trim(), timeout: to, maskBuiltin: $("#s-mask-builtin").checked, maskCustom: $("#s-mask-custom").value });
  S.apiKey = $("#s-key").value.trim();
  await saveSettings();
  if (s.remember && S.apiKey) await db.put("kv", S.apiKey, "apiKey"); else await db.del("kv", "apiKey");
  toast(t("savedSettings"));
  renderVerify();
}

// ---------- 읽기 설정 ----------
function tzOptions() {
  const list = [];
  for (let m = -12 * 60; m <= 14 * 60; m += 60) list.push(m);
  list.push(330, 345, 570);
  list.sort((a, b) => a - b);
  const lab = (m) => `UTC${m < 0 ? "−" : "+"}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}:${String(Math.abs(m) % 60).padStart(2, "0")}`;
  $("#o-tz").innerHTML = list.map((m) => `<option value="${m}" ${m === S.readOpts.tz ? "selected" : ""}>${lab(m)}</option>`).join("");
}
function readOptsToForm() {
  const o = S.readOpts;
  $("#o-format").value = FORMATS.includes(o.format) ? o.format : "auto";
  $("#o-enc").value = o.encoding;
  $("#o-year").value = o.year;
  $("#o-delim").value = o.csv.delim || "auto";
  $("#o-header").checked = o.csv.header !== false;
  $("#o-ctime").value = o.csv.time || ""; $("#o-clevel").value = o.csv.level || ""; $("#o-cmodule").value = o.csv.module || ""; $("#o-cmsg").value = o.csv.msg || "";
  $("#o-jtime").value = o.json.time || ""; $("#o-jlevel").value = o.json.level || ""; $("#o-jmodule").value = o.json.module || ""; $("#o-jmsg").value = o.json.msg || "";
  $("#o-regex").value = o.regex || "";
  tzOptions();
  showFormatFields();
}
function formToReadOpts() {
  const v = (id) => $(id).value.trim();
  S.readOpts = {
    format: $("#o-format").value, encoding: $("#o-enc").value, tz: +$("#o-tz").value, year: +$("#o-year").value || new Date().getFullYear(),
    csv: { delim: $("#o-delim").value, header: $("#o-header").checked, time: v("#o-ctime"), level: v("#o-clevel"), module: v("#o-cmodule"), msg: v("#o-cmsg") },
    json: { time: v("#o-jtime"), level: v("#o-jlevel"), module: v("#o-jmodule"), msg: v("#o-jmsg") },
    regex: $("#o-regex").value,
  };
  saveUi();
}
const showFormatFields = () => $$("[data-show]").forEach((el) => { el.hidden = el.dataset.show !== $("#o-format").value; });

// ---------- 도움말 ----------
async function renderHelp() {
  const errs = (await db.all("errors")).slice(-20).reverse();
  const ko = getLang() === "ko";
  const H = ko ? {
    use: ["사용 순서", ["로그를 열면 ERROR 이상 줄을 알람으로 보고, 알람 사이가 '발생 묶기 간격'보다 짧으면 한 발생으로 묶습니다.", "첫 알람 코드가 같은 발생끼리 군집이 됩니다. 군집을 누르면 첫 알람 앞 구간의 경고 통계(발생 앞 · 집중도 · 리드 타임)와 원인 후보가 나옵니다.", "근거 줄 번호를 누르면 로그 뷰어와 타임라인이 그 줄로 이동합니다."]],
    fmt: ["읽을 수 있는 형식", ["ISO: <code>2026-11-10 09:12:40.123 WARN [STAGE] Motor temp high</code> (레벨 앞뒤 [모듈] 모두 가능, 날짜 구분자 - / .)", "syslog: RFC 3164 <code>&lt;34&gt;Nov 10 09:12:40 host app[12]: msg</code>, RFC 5424 <code>&lt;34&gt;1 2026-11-10T09:12:40Z host app - - - msg</code>", "CSV · TSV: 머리글 이름 또는 열 번호로 시각 · 레벨 · 모듈 · 메시지 지정. 날짜와 시각이 나뉜 경우 1+2", "JSON Lines: time · level · module · msg 키 자동 감지, 다른 키 이름은 직접 지정 (점으로 중첩 키)", "사용자 정규식: 이름 그룹 (?&lt;time&gt;…) (?&lt;msg&gt;…) 필수", "인코딩: UTF-8 · EUC-KR(CP949) · UTF-16 자동 감지. 공백으로 시작하는 줄은 앞 줄에 이어진 줄(스택 등)로 셉니다.", "읽지 못한 줄은 줄 번호와 사유를 보여줍니다."]],
    flow: ["현장 검증 절차", ["재현: 합성 Down 사례 3종이 기본으로 들어 있고, 내 로그의 발생을 '사례로 저장'해 세트에 더합니다.", "비교: 간격 · 직전 구간 · 조기 경보 규칙 · 설비 사전을 바꾼 초안(B)을 지금 설정(A)과 같은 데이터로 계산해 바뀐 칸만 강조합니다.", "Shadow: LLM 결과는 옆 칸에만 보이고 결정은 규칙이 합니다. 실행마다 검증 통과 · 규칙과 일치 여부가 기록됩니다.", "전환 · 롤백: Shadow 기록이 기준(5회 이상, 검증 90%, 일치 80%)을 넘으면 LLM 결정으로 전환할 수 있고, 모든 설정 변경은 버전으로 남아 한 번에 되돌립니다."]],
    keys: ["키보드", ["<kbd>/</kbd> 메시지 검색", "타임라인에서 <kbd>←</kbd> <kbd>→</kbd> 이동, <kbd>+</kbd> <kbd>−</kbd> 확대 · 축소, <kbd>0</kbd> 전체", "로그 목록에서 <kbd>↑</kbd> <kbd>↓</kbd> <kbd>PgUp</kbd> <kbd>PgDn</kbd>", "현장 검증 탭에서 <kbd>←</kbd> <kbd>→</kbd>", "<kbd>?</kbd> 이 도움말"]],
    priv: ["개인정보", ["로그 파일은 이 브라우저 안에서만 읽습니다. 서버가 없고, 외부 오류 수집도 하지 않습니다.", "저장: 사례 · 규칙 · 설정 이력 · Shadow 기록 · 마지막 파일(200MB 미만)이 이 브라우저의 IndexedDB 에만 남습니다. 설정 → 데이터에서 백업 · 삭제합니다.", "LLM 을 쓸 때만, 미리보기에서 확인한 프롬프트(군집 통계 + 근거 줄 최대 80줄, 마스킹 적용)가 선택한 제공자(Anthropic API 또는 이 PC 의 Ollama)로 갑니다.", "API 키는 기본적으로 메모리에만 둡니다."]],
    faq: ["FAQ", ["<b>알람이 하나도 안 나와요</b> — 레벨이 ERROR · ALARM · FATAL 인 줄이 있어야 합니다. 레벨 낱말이 다르면 사용자 정규식으로 level 그룹을 지정하세요.", "<b>코드가 아닌 문장으로 묶여요</b> — 설비 사전(비교 탭)의 codePattern 을 내 알람 코드 형식에 맞게 바꾸세요.", "<b>Ollama 연결이 안 돼요</b> — 이 PC 에서 <code>python -m http.server</code> 처럼 localhost 로 연 페이지는 기본 설정으로 연결됩니다. 웹 주소에서 열었다면 OLLAMA_ORIGINS 환경 변수에 그 주소를 넣고 Ollama 를 다시 시작하세요 (예: <code>OLLAMA_ORIGINS=https://내-주소</code>). 브라우저가 로컬 네트워크 접근을 물으면 허용해야 합니다.", "<b>시각이 9시간 밀려요</b> — 로그에 Z 나 +00:00 이 붙어 있으면 '표시 시간대'를 장비 현지 시간대로 고르세요.", "<b>오프라인에서도 되나요</b> — 한 번 열면 앱 파일이 저장되어 오프라인으로 열립니다 (LLM 제외)."]],
  } : {
    use: ["How to use", ["When a log opens, lines at ERROR and above are alarms; alarms closer than the 'occurrence gap' form one occurrence.", "Occurrences with the same first alarm code form a cluster. Click one to see warning statistics before the first alarm (before · concentration · lead time) and cause candidates.", "Click an evidence line number to jump the log viewer and timeline to it."]],
    fmt: ["Supported formats", ["ISO: <code>2026-11-10 09:12:40.123 WARN [STAGE] Motor temp high</code> ([module] before or after the level; date separators - / .)", "syslog: RFC 3164 <code>&lt;34&gt;Nov 10 09:12:40 host app[12]: msg</code>, RFC 5424 <code>&lt;34&gt;1 2026-11-10T09:12:40Z host app - - - msg</code>", "CSV · TSV: pick time · level · module · message by header name or column number; use 1+2 for split date and time", "JSON Lines: time · level · module · msg keys auto-detected; set other key names (dots for nested keys)", "Custom regex: named groups (?&lt;time&gt;…) (?&lt;msg&gt;…) required", "Encoding: UTF-8 · EUC-KR (CP949) · UTF-16 auto-detected. Lines starting with whitespace count as continuations (stack traces).", "Unreadable lines are listed with line number and reason."]],
    flow: ["Field validation", ["Reproduce: three synthetic down cases are built in; add your own with 'Save as a case'.", "Compare: a draft (B) with a new gap · window · early-warning rules · equipment dictionary runs on the same data as the current settings (A); only changed cells are highlighted.", "Shadow: LLM results appear only alongside while rules decide. Each run records whether it validated and agreed with the rules.", "Switch · rollback: when the shadow log passes the criteria (5+ runs, 90% validated, 80% agreement) you can switch to LLM decisions; every settings change is versioned and can be restored in one click."]],
    keys: ["Keyboard", ["<kbd>/</kbd> search messages", "Timeline: <kbd>←</kbd> <kbd>→</kbd> pan, <kbd>+</kbd> <kbd>−</kbd> zoom, <kbd>0</kbd> show all", "Log list: <kbd>↑</kbd> <kbd>↓</kbd> <kbd>PgUp</kbd> <kbd>PgDn</kbd>", "Validation tabs: <kbd>←</kbd> <kbd>→</kbd>", "<kbd>?</kbd> this help"]],
    priv: ["Privacy", ["Log files are read only inside this browser. There is no server and no external error reporting.", "Stored only in this browser's IndexedDB: cases · rules · settings history · shadow log · last file (under 200 MB). Back up or erase in Settings → Data.", "Only when you use an LLM, the prompt you reviewed in the preview (cluster statistics + up to 80 evidence lines, masked) goes to the chosen provider (Anthropic API or Ollama on this PC).", "The API key is kept in memory by default."]],
    faq: ["FAQ", ["<b>No alarms show up</b> — the log needs lines at ERROR · ALARM · FATAL. If your level words differ, set a level group with a custom regex.", "<b>Alarms are grouped by sentence instead of code</b> — change codePattern in the equipment dictionary (Compare tab) to match your alarm codes.", "<b>Ollama will not connect</b> — a page opened from localhost on this PC (for example with <code>python -m http.server</code>) connects with default settings. From a web address, add it to OLLAMA_ORIGINS and restart Ollama (e.g. <code>OLLAMA_ORIGINS=https://your-host</code>); allow local network access if the browser asks.", "<b>Times are shifted by hours</b> — if the log has Z or +00:00, pick the equipment's local zone as the display time zone.", "<b>Does it work offline?</b> — after the first visit the app files are cached and open offline (except the LLM)."]],
  };
  const sec = ([h, items]) => `<h3>${h}</h3><ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  $("#help-body").innerHTML = [H.use, H.fmt, H.flow, H.keys, H.priv, H.faq].map(sec).join("") + `
    <h3>${ko ? "오류 기록" : "Error log"} <small>${ko ? "이 기기에만 저장 · 최근 200건" : "stored on this device · last 200"}</small></h3>
    ${errs.length ? `<pre class="pv">${esc(errs.map((e) => `${e.t}  ${e.msg}`).join("\n"))}</pre><div class="row"><button class="btn ghost sm" type="button" id="err-export">${ko ? "오류 기록 내보내기" : "Export error log"}</button><button class="btn ghost sm" type="button" id="err-clear">${ko ? "지우기" : "Clear"}</button></div>` : `<p class="hint">${ko ? "기록된 오류가 없습니다." : "No errors recorded."}</p>`}
    <h3>${ko ? "버전" : "Version"}</h3><p>log-analyzer v${VERSION} · MIT License · Pretendard (OFL-1.1) · Anthropic TypeScript SDK 1.6.0 (Apache-2.0)</p>`;
}

// ---------- 언어 · 테마 ----------
function applyLang(l) {
  setLang(l);
  S.settings.lang = l;
  applyStatic();
  document.title = t("appName");
  document.body.dataset.drop = t("dropHere");
  $("#lang").value = l;
  if (S.stats) { renderModuleFilter(); renderStats(); renderClusters(); renderDetail(); drawTimeline(); renderTlTable(); renderRows(false); renderVerify(); }
}
function applyTheme() {
  const th = S.settings.theme;
  if (th === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = th;
  $("#theme").textContent = { auto: "◐", light: "☀", dark: "☾" }[th];
  drawTimeline();
}

// ---------- 이벤트 ----------
function bind() {
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button, .r");
    if (!b) return;
    const d = b.dataset;
    if (d.cl) return selectCluster(d.cl, d.clEp ? +d.clEp : 0);
    if (d.ep) { const c = cluster(); S.selEp = +d.ep; renderDetail(); focusLine(c.episodes[+d.ep].trigger.n); return; }
    if (d.ln) return focusLine(+d.ln);
    if (d.row) { S.focus = +d.row; drawTimeline(); renderRows(false); return; }
    if (d.addrule) {
      const c = cluster(), p = ctx(c).pre[+d.addrule];
      S.draft ||= clone(S.config);
      const id = `${c.code}:${p.module}:${p.tpl}`.slice(0, 120);
      if (!S.draft.rules.some((r) => r.id === id)) S.draft.rules.push({ id, target: c.code, module: p.module, tpl: p.tpl, count: 2, within: 10, horizon: 30 });
      toast(t("ruleAdded"), { label: t("vtCompare"), run: () => { selectTab("compare", true); $("#verify").scrollIntoView({ block: "start" }); } });
      return;
    }
    if (d.caseOpen) return loadCase(d.caseOpen);
    if (d.caseDel) { S.cases = S.cases.filter((c) => c.id !== d.caseDel); S.caseData.delete(d.caseDel); await db.del("cases", d.caseDel); return renderRepro(); }
    if (d.rdel) { S.draft.rules.splice(+d.rdel, 1); S.cmp = null; return renderCompare(); }
    if (d.restore) {
      const h = S.history.find((x) => x.v === +d.restore);
      if (h) { await applyConfig(h.config, ["histRestore", h.v]); toast(t("restored", h.v)); }
      return;
    }
    switch (b.id) {
      case "load-sample": return loadSample();
      case "download-sample": return downloadSample();
      case "reset-view": return resetView();
      case "open-settings": return openSettings();
      case "open-help": await renderHelp(); return $("#help").showModal();
      case "theme": S.settings.theme = { auto: "light", light: "dark", dark: "auto" }[S.settings.theme]; applyTheme(); return saveSettings();
      case "tl-table-toggle": S.tlTable = !S.tlTable; renderTlTable(); if (!S.tlTable) drawTimeline(); return;
      case "use-rule": S.baseChoice[S.sel] = "rule"; return refreshCluster();
      case "use-example": S.baseChoice[S.sel] = "example"; return refreshCluster();
      case "gen": return analyzeWithLLM(cluster());
      case "llm-cancel": S.busy?.ctl.abort(); return;
      case "save-case": return saveCase();
      case "reread": formToReadOpts(); if (S.file) readFile(S.file); return;
      case "cancel-read": worker?.postMessage({ type: "cancel" }); return;
      case "exp-html": return download(baseName() + "-report.html", toHtml(report()), "text/html");
      case "exp-csv": return download(baseName() + "-occurrences.csv", toCsv(report()), "text/csv");
      case "exp-json": return download(baseName() + "-analysis.json", toJson(report()), "application/json");
      case "d-suggest": S.draft.rules = A.suggestRules(S.entries, S.clusters, S.draft.lookback * 60e3, S.warns); S.cmp = null; return renderCompare();
      case "d-run": return runCompare();
      case "cmp-apply": { const cfg = S.draft; await applyConfig(cfg, "histApply"); toast(t("applied")); return selectTab("compare"); }
      case "cmp-reset": S.draft = clone(S.config); S.cmp = null; return renderCompare();
      case "sh-clear": S.shadowLog = []; await db.clear("shadow"); return renderShadow();
      case "sw-go": return applyConfig({ ...S.config, mode: "llm" }, "histMode");
      case "sw-back": return applyConfig({ ...S.config, mode: "rule" }, "histMode");
      case "backup-export": return download("log-analyzer-backup.json", JSON.stringify(await db.exportBackup(), null, 2), "application/json");
      case "reset-all":
        if (!confirm(t("resetConfirm"))) return;
        await db.clearAll();
        location.reload();
        return;
      case "err-export": return download("log-analyzer-errors.json", JSON.stringify(await db.all("errors"), null, 2), "application/json");
      case "err-clear": await db.clear("errors"); return renderHelp();
    }
  });
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.id === "lookback") { S.config.lookback = +el.value; S.draft = null; S.cmp = null; pushHistory(["histLookback", +el.value]); refreshCluster(); renderVerify(); }
    if (el.id === "lang") { applyLang(el.value); saveSettings(); }
    if (el.id === "o-format") showFormatFields();
    if (el.id === "s-provider") showProv();
    if (el.id === "cmp-changed") { S.cmpChangedOnly = el.checked; renderCompare(); }
    if (el.id === "sh-diff") { S.shadowDiffOnly = el.checked; renderShadow(); }
    if (el.id === "d-gap" || el.id === "d-lookback") { S.draft[el.id === "d-gap" ? "gap" : "lookback"] = Math.max(1, +el.value || 1); S.cmp = null; }
    if (el.dataset.rk) { S.draft.rules[+el.dataset.ri][el.dataset.rk] = Math.max(1, +el.value || 1); S.cmp = null; }
    if (el.id === "file") readFile(el.files[0]);
    if (el.id === "backup-import") importBackup(el.files[0]);
  });
  $("#settings-save").addEventListener("click", saveSettingsForm);
  $(".vtabs").addEventListener("click", (e) => { const b = e.target.closest("[role=tab]"); if (b) selectTab(b.id.slice(3)); });
  $(".vtabs").addEventListener("keydown", (e) => {
    const tabs = ["repro", "compare", "shadow", "switch"];
    const i = tabs.indexOf(S.tab);
    const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (k) { e.preventDefault(); selectTab(tabs[(i + k + tabs.length) % tabs.length], true); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
    if (e.key === "/") { e.preventDefault(); $("#f-text").focus(); }
    if (e.key === "?") { renderHelp().then(() => $("#help").showModal()); }
  });
  document.addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("dragging"); });
  document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dragging"); });
  document.addEventListener("drop", (e) => { e.preventDefault(); document.body.classList.remove("dragging"); readFile(e.dataTransfer.files[0]); });
  $("#onboard form").addEventListener("submit", () => db.put("kv", true, "onboarded"));
  $("#onboard").addEventListener("cancel", () => db.put("kv", true, "onboarded"));
  bindTimeline();
  bindViewer();
}

function refreshCluster() {
  const c = cluster();
  if (!c) return;
  renderClusters();
  renderDetail();
  S.highlight = new Set(ctx(c).main.out.causes.flatMap((x) => x.evidence));
  renderRows(false);
}

async function importBackup(file) {
  if (!file) return;
  try {
    await db.importBackup(JSON.parse(await file.text()));
    await loadState();
    analyze(true);
    toast(t("importDone"));
  } catch (e) { $("#settings-err").textContent = t("importErr") + ": " + e.message; }
}

// ---------- 시작 ----------
async function loadState() {
  const s = await db.get("kv", "settings");
  if (s) Object.assign(S.settings, s);
  if (S.settings.remember) S.apiKey = (await db.get("kv", "apiKey")) || "";
  const ui = await db.get("kv", "ui");
  if (ui?.readOpts) S.readOpts = { ...S.readOpts, ...ui.readOpts, csv: { ...ui.readOpts.csv }, json: { ...ui.readOpts.json } };
  if (ui?.tab) S.tab = ui.tab;
  S.history = (await db.all("history")).sort((a, b) => a.v - b.v);
  const cfg = await db.get("kv", "config");
  if (cfg) S.config = { ...clone(A.DEFAULT_CONFIG), ...cfg };
  S.cases = await db.all("cases");
  S.shadowLog = await db.all("shadow");
  S.draft = null;
  return ui;
}

function registerSW() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      nw?.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) toast(t("updateReady"), { label: t("reload"), run: () => { nw.postMessage("skip"); } });
      });
    });
  }).catch((e) => db.logError(e));
  // 첫 설치(clients.claim)에서는 다시 읽지 않고, 새 버전으로 바뀔 때만 다시 읽는다
  const had = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (had && !reloaded) { reloaded = true; location.reload(); } });
}

async function start() {
  window.addEventListener("error", (e) => { db.logError(e.error || e.message); toast(t("errLogged")); });
  window.addEventListener("unhandledrejection", (e) => { db.logError(e.reason); toast(t("errLogged")); });
  const ui = await loadState();
  S.sel = ui?.sel ?? null;
  $("#version").textContent = "v" + VERSION;
  applyLang(S.settings.lang || (navigator.language?.startsWith("ko") ? "ko" : "en"));
  applyTheme();
  readOptsToForm();
  bind();
  selectTab(S.tab);
  const last = await db.get("kv", "last");
  const blob = last && !last.sample && !last.notSaved ? await db.get("files", "last") : null;
  if (blob) {
    readFile(new File([blob], last.name, { type: blob.type }));
    toast(t("restoredFile", last.name));
  } else loadSample();
  if (!S.history.length) {
    // 처음 실행: 예시 로그의 직전 경고로 조기 경보 규칙을 만들어 v1 로 둔다
    if (!S.config.rules.length && S.sample) S.config.rules = A.suggestRules(S.entries, S.clusters, S.config.lookback * 60e3, S.warns);
    await pushHistory("histInit");
    renderVerify();
  }
  if (ui?.sel && S.clusters.some((c) => c.code === ui.sel)) selectCluster(ui.sel);
  if (!(await db.get("kv", "onboarded"))) $("#onboard").showModal();
  registerSW();
}

start();
