// 내보내기: HTML 보고서(단일 파일) · CSV(발생 단위) · JSON(분석 결과 전체)
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = (t) => new Date(t).toISOString().replace("T", " ").slice(0, 19);
const mins = (ms) => (ms == null ? "" : (ms / 60e3).toFixed(1));
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// rep = { title, name, generated, version, lang, stats, clusters:[{code,name,module,group,n,signatures,episodes:[{t0,t1,alarms,trigger}],pre,causes,checks,how,lines:Map}], backtest, L(라벨) }
export function toHtml(rep) {
  const L = rep.L;
  const cl = rep.clusters.map((c) => `
    <section><h2><code>${esc(c.code)}</code> ${esc(c.name)} <small>${esc(c.module)}${c.group ? " · " + esc(c.group) : ""} · ${c.n}${esc(L.times)}</small></h2>
    <p class="chain">${[...c.signatures].map(([s, n]) => `${esc(s)} (${n})`).join(" / ")}</p>
    <table><thead><tr><th>${esc(L.thModule)}</th><th>${esc(L.thWarning)}</th><th>${esc(L.thBefore)}</th><th>${esc(L.thSpec)}</th><th>${esc(L.thLead)} (${esc(L.min)})</th></tr></thead><tbody>
    ${c.pre.slice(0, 6).map((p) => `<tr><td>${esc(p.module)}</td><td><code>${esc(p.tpl)}</code></td><td>${p.coverage}/${p.of}</td><td>${Math.round(p.spec * 100)}%</td><td>${mins(p.leadMed)} (${mins(p.leadMin)}~${mins(p.leadMax)})</td></tr>`).join("") || `<tr><td colspan="5">-</td></tr>`}
    </tbody></table>
    <h3>${esc(L.causesTitle)} <small>${esc(c.howLabel)}</small></h3>
    <ol>${c.causes.map((x) => `<li><b>[${esc(x.confidenceLabel)}] ${esc(x.cause)}</b><br>${esc(x.reasoning)}
      <pre>${x.evidence.map((n) => `${n}: ${esc(c.lines.get(n) ?? "")}`).join("\n")}</pre></li>`).join("")}</ol>
    ${c.checks?.length ? `<h3>${esc(L.checksTitle)}</h3><ul>${c.checks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </section>`).join("");
  const bt = rep.backtest;
  return `<!doctype html><html lang="${rep.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(rep.title)} — ${esc(rep.name)}</title>
<style>body{font:15px/1.6 system-ui,"Malgun Gothic",sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#1f1f1f}
h1{font-size:24px}h2{font-size:18px;margin-top:28px;border-top:1px solid #ddd;padding-top:16px}small{color:#5e5e5e;font-weight:400}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #e5e5e5;padding:5px 8px;text-align:left;vertical-align:top}
code,pre{font:12px ui-monospace,Consolas,monospace}pre{background:#f4f4f4;padding:8px;border-radius:6px;white-space:pre-wrap}.chain{font-family:ui-monospace,Consolas,monospace;font-size:13px;color:#3d3d3d}
@media (prefers-color-scheme: dark){body{background:#121212;color:#ececec}pre{background:#222}th,td{border-color:#333}small,.chain{color:#a8a8a8}}</style></head><body>
<h1>${esc(rep.title)}</h1>
<p><b>${esc(rep.name)}</b> · ${esc(iso(rep.stats.t0))} ~ ${esc(iso(rep.stats.t1))} · ${rep.stats.lines.toLocaleString()} ${esc(L.lines)} · ${rep.stats.eps} ${esc(L.episodes)} · ${rep.clusters.length} ${esc(L.clusterUnit)}</p>
<p><small>${esc(L.generated)} ${esc(rep.generated)} · ${esc(L.appVersion)} ${esc(rep.version)}</small></p>
${bt ? `<h2>${esc(L.btTitle)}</h2><table><thead><tr><th>${esc(L.thCase)}</th><th>${esc(L.thCode)}</th><th>${esc(L.thDown)}</th><th>${esc(L.thLeadMin)} (${esc(L.min)})</th></tr></thead><tbody>
${bt.rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.code)}</td><td>${esc(iso(r.t))}</td><td>${r.lead == null ? esc(L.missed) : mins(r.lead)}</td></tr>`).join("")}</tbody></table>` : ""}
${cl}
</body></html>`;
}

export function toCsv(rep) {
  const head = ["cluster", "name", "module", "group", "start", "end", "alarms", "chain", "trigger_line", "top_warning", "lead_min"];
  const rows = [head];
  for (const c of rep.clusters) for (const ep of c.episodes) {
    const p = c.pre[0];
    const first = p ? c.firstWarn(ep, p) : null;
    rows.push([c.code, c.name, c.module, c.group || "", iso(ep.t0), iso(ep.t1), ep.alarms.length, ep.signature, ep.trigger.n,
      p ? `[${p.module}] ${p.tpl}` : "", first == null ? "" : mins(ep.t0 - first)]);
  }
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function toJson(rep) {
  return JSON.stringify({
    app: "log-analyzer", version: rep.version, generated: rep.generated, file: rep.name, lang: rep.lang,
    stats: { ...rep.stats, t0: iso(rep.stats.t0), t1: iso(rep.stats.t1) },
    config: rep.config,
    clusters: rep.clusters.map((c) => ({
      code: c.code, name: c.name, module: c.module, group: c.group, occurrences: c.n,
      chains: Object.fromEntries(c.signatures),
      episodes: c.episodes.map((ep) => ({ start: iso(ep.t0), end: iso(ep.t1), alarms: ep.alarms.length, chain: ep.signature, triggerLine: ep.trigger.n })),
      precursors: c.pre.slice(0, 10).map((p) => ({ module: p.module, template: p.tpl, coverage: p.coverage, of: p.of, concentration: +p.spec.toFixed(3),
        leadMinMedian: p.leadMed == null ? null : +(p.leadMed / 60e3).toFixed(2), leadMinMin: +(p.leadMin / 60e3).toFixed(2), leadMinMax: +(p.leadMax / 60e3).toFixed(2) })),
      causeSource: c.how,
      causes: c.causes.map((x) => ({ cause: x.cause, reasoning: x.reasoning, confidence: x.confidence, evidence: x.evidence.map((n) => ({ line: n, text: c.lines.get(n) ?? "" })) })),
      checks: c.checks || [],
    })),
    backtest: rep.backtest ? rep.backtest.rows.map((r) => ({ case: r.label, code: r.code, down: iso(r.t), leadMin: r.lead == null ? null : +(r.lead / 60e3).toFixed(2) })) : null,
  }, null, 2);
}

export function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
