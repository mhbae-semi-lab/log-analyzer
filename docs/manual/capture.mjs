// 매뉴얼 · 보고서용 화면 캡처 (합성 데이터만). headless Chrome 을 DevTools 프로토콜로 움직인다.
//   1) python -m http.server 8731 --bind 127.0.0.1      (저장소 루트에서)
//   2) node docs/manual/capture.mjs [http://127.0.0.1:8731/]
// 결과: docs/manual/shots/*.png (1280 x 800, 배율 1.5). Chrome 경로는 CHROME 환경 변수로 바꾼다.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const URL0 = process.argv[2] || "http://127.0.0.1:8731/";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "shots");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "la-capture-"));
const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "--window-size=1280,800", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, seq = 0;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((x) => x.type === "page");
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch { /* 아직 시작 중 */ }
    await sleep(200);
  }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
  });
}
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function js(expr) {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function view(w, h, scheme = "light", mobile = false) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1.5, mobile });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
}
// 요소를 화면 맨 위로 올리고 그 화면(뷰포트)을 찍는다. sel 이 없으면 현재 화면.
// marks: 말풍선 자리로 쓸 요소들 → shots/marks.json 에 CSS px 사각형 [x0, y0, x1, y1] (화면 밖이면 null)
const MARKS = {};
async function shot(name, sel, offset = 70, marks = []) {
  if (sel) await js(`const el = document.querySelector(${JSON.stringify(sel)}); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - ${offset});`);
  await sleep(250);
  MARKS[name] = await js(`return ${JSON.stringify(marks)}.map((m) => { const el = document.querySelector(m); if (!el) return null;
    const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight || !r.width) return null;
    return [r.left, r.top, r.right, Math.min(r.bottom, innerHeight)].map(Math.round); });`);
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, name + ".png"), Buffer.from(r.data, "base64"));
  console.log("shot", name, MARKS[name].map((x) => (x ? "o" : "-")).join(""));
}
async function load(lang = "ko") {
  await send("Page.navigate", { url: URL0 });
  await sleep(1500);
  await js(`await document.fonts.ready;
    if (document.querySelector("#onboard").open) document.querySelector("#onboard form button").click();
    const s = document.querySelector("#lang"); if (s.value !== "${lang}") { s.value = "${lang}"; s.dispatchEvent(new Event("change", { bubbles: true })); }`);
  await sleep(400);
}
const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
async function mockLLM(codes) {
  await js(`document.querySelector("#open-settings").click(); const p = document.querySelector("#s-provider"); p.value = "mock"; p.dispatchEvent(new Event("change", { bubbles: true })); document.querySelector("#settings-save").click();`);
  for (const c of codes) {
    await click(`[data-cl="${c}"]`); await sleep(150);
    await click("#gen"); await sleep(250);
    await click("#pv-send"); await sleep(1200);
  }
}

try {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  // 깨끗한 상태로 시작
  await send("Page.navigate", { url: URL0 });
  await sleep(1200);
  await js(`for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); await new Promise(r => { const q = indexedDB.deleteDatabase("log-analyzer"); q.onsuccess = q.onerror = q.onblocked = r; });`);

  await view(1280, 800);
  await send("Page.navigate", { url: URL0 });
  await sleep(1800);
  await js(`await document.fonts.ready`);
  await shot("Onboard");
  await load("ko");
  await shot("Home", null, 70, ["#lang", "#theme", "#open-help", "#open-settings", "#load-sample", ".file-btn", "#read-opts summary", "#stats", "#export-row"]);
  await js(`document.querySelector("#read-opts").open = true; const f = document.querySelector("#o-format"); f.value = "csv"; f.dispatchEvent(new Event("change", { bubbles: true }));`);
  await shot("ReadOpts", "#drop", 66, ["#o-format", "#o-enc", "#o-tz", "[data-show=csv] .field:nth-of-type(3)", "#o-ctime", "#reread"]);
  await js(`const f = document.querySelector("#o-format"); f.value = "auto"; f.dispatchEvent(new Event("change", { bubbles: true })); document.querySelector("#read-opts").open = false;`);

  // 깨진 줄이 섞인 내 형식 파일 (CSV, 합성)
  await js(`const csv = ["time,level,unit,message", "2026-11-10 09:00:00,INFO,LOADER,Lot start (lot=SC001101)", "2026-11-10 09:00:03,WARN,LOADER,Vacuum pressure low (P=-64.8 kPa)",
      "2026-11-10 09:00:04,WARN,LOADER", "2026-11-10 09:00:09,ALARM,LOADER,L103 Wafer vacuum lost", "10/11/2026 09:01,INFO,LOADER,Process paused", "2026-11-10 09:02:00,NOTE,STAGE,Move done"].join("\\n");
    const dt = new DataTransfer(); dt.items.add(new File([csv], "my-tool.csv", { type: "text/csv" }));
    document.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));`);
  await sleep(1200);
  await js(`document.querySelector("#bad").open = true;`);
  await shot("BadLines", "#drop", 66, ["#stats > div:nth-child(2)", "#bad summary", "#bad tbody tr"]);
  await load("ko");
  await click("#load-sample"); await sleep(400);

  await shot("Timeline", "#tl-h", 80, ["#timeline", ".legend", "#tl-table-toggle", "#range", "#reset-view"]);
  await click(`[data-cl="L103"]`); await sleep(300);
  await shot("Clusters", ".work", 66, [".cl.on .cl-head", ".cl.on .cl-chain", ".cl.on .cl-lead", ".cl.on .cl-top", "#detail .eps", "#save-case"]);
  await js(`document.querySelector("#detail h3:nth-of-type(2)").scrollIntoView()`);
  await shot("Precursors", "#detail h3:nth-of-type(2)", 80, ["#lookback", "#detail table.t th:nth-child(3)", "#detail table.t th:nth-child(4)", "#detail table.t th:nth-child(5)", "[data-addrule=\"0\"]", "#gen"]);
  await mockLLM(["C401", "L104", "S301", "L103"]);
  await shot("Causes", "#detail .cause-cols", 170, ["#gen", "#use-rule", ".cause-col h4", ".cause-col:not(.side) .ln", ".cause-col.side .verdict", ".cause-col.side pre.log"]);
  await click(`[data-cl="L104"]`); await sleep(200);
  await click("#gen"); await sleep(300);
  await shot("Preview", null, 70, ["#pv-meta", "#pv-text mark", "#pv-send"]);
  await js(`document.querySelector("#preview form button[value=cancel]").click()`);
  await sleep(200);
  await click(`[data-cl="C401"]`); await sleep(200);
  await shot("ShadowFail", "#detail .cause-cols", 170, [".cause-col:not(.side) h4", ".cause-col.side .verdict", ".cause-col.side pre.log"]);

  await click("#vt-repro"); await sleep(300);
  await shot("Repro", "#verify", 66, ["#vt-repro", "#vp-repro .tbl-wrap", "[data-case-open]", "#vp-repro .kpis", "#vp-repro .tbl-wrap:last-child"]);
  await click("#vt-compare"); await sleep(300);
  await js(`const c = document.querySelectorAll('#vp-compare input[data-rk="count"]')[0]; c.value = 3; c.dispatchEvent(new Event("change", { bubbles: true }));
    const g = document.querySelector("#d-gap"); g.value = 300; g.dispatchEvent(new Event("change", { bubbles: true })); document.querySelector("#d-run").click();`);
  await sleep(400);
  await shot("CompareEdit", "#verify", 66, ["#vp-compare .cfg", "#d-gap", "#vp-compare input[data-rk=count]", "#d-suggest", "#vp-compare details summary", "#d-run"]);
  await shot("CompareResult", "#cmp-res", 80, ["#cmp-res .kpis", "#cmp-res td.changed", "#cmp-changed", "#cmp-apply"]);
  await click("#vt-shadow"); await sleep(300);
  await shot("Shadow", "#verify", 66, ["#vp-shadow .kpis", "#sh-diff", "#vp-shadow tbody tr.changed"]);
  // 기준을 넘길 만큼 근거가 뚜렷한 군집으로 더 돌린다 (모의 응답)
  await js(`document.querySelector("#sh-clear").click()`); await sleep(200);
  await mockLLM(["L103", "S301", "C402", "L103", "S301", "C402"]);
  await click("#vt-shadow"); await sleep(300);
  await shot("ShadowPass", "#verify", 66, ["#vp-shadow .kpis", "#sh-diff", "#vp-shadow tbody"]);
  await click("#vt-switch"); await sleep(300);
  await click("#sw-go"); await sleep(500);
  await click("#vt-switch"); await sleep(300);
  await shot("Switch", "#verify", 66, ["#mode-badge", "#sw-back", "#vp-switch tbody tr", "[data-restore]"]);
  await click("#sw-back"); await sleep(500);

  await js(`window.scrollTo(0, 0)`);
  await shot("Viewer", ".viewer", 66, ["#f-level", "#f-module", "#f-text", ".r.focus"]);
  await click("#tl-table-toggle"); await sleep(300);
  await shot("TimelineTable", "#tl-h", 80, ["#tl-table-toggle", "#tl-table tr.changed", "#tl-table .rowbtn"]);
  await click("#tl-table-toggle"); await sleep(200);
  await click("#open-settings"); await sleep(300);
  await js(`const p = document.querySelector("#s-provider"); p.value = "anthropic"; p.dispatchEvent(new Event("change", { bubbles: true }));`);
  await shot("Settings", null, 70, ["#s-provider", "#s-key", "#s-remember", "#s-model", "#s-timeout", "#s-mask-builtin"]);
  await js(`document.querySelector("#settings form button[value=cancel]").click()`);
  await click("#open-help"); await sleep(400);
  await shot("Help");
  await js(`document.querySelector("#help form button").click()`);

  await load("en");
  await click(`[data-cl="L103"]`); await sleep(300);
  await shot("EnHome");
  await shot("EnDetail", "#detail", 66);

  await view(390, 844, "dark", true);
  await load("ko");
  await shot("MobileDark");
  await shot("MobileDetail", "#detail", 66);
  await view(1280, 800, "dark");
  await load("ko");
  await shot("DarkDetail", ".work", 66);

  // 선택: 로컬 Ollama 실제 모델로 Shadow 칸 (OLLAMA_MODEL=qwen2.5:3b node docs/manual/capture.mjs)
  if (process.env.OLLAMA_MODEL) {
    await view(1280, 800);
    await load("ko");
    await js(`document.querySelector("#open-settings").click(); const p = document.querySelector("#s-provider"); p.value = "ollama"; p.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector("#s-omodel").value = ${JSON.stringify(process.env.OLLAMA_MODEL)}; document.querySelector("#settings-save").click();`);
    await click(`[data-cl="L103"]`); await sleep(200);
    await click("#gen"); await sleep(300);
    await click("#pv-send");
    await js(`for (let i = 0; i < 240 && document.querySelector("#llm-cancel"); i++) await new Promise((r) => setTimeout(r, 500));`);
    await shot("ShadowOllama", "#detail .cause-cols", 170, [".cause-col.side .verdict", ".cause-col.side pre.log"]);
  }
  writeFileSync(join(OUT, "marks.json"), JSON.stringify(MARKS, null, 1));
} finally {
  try { ws?.close(); } catch { /* */ }
  proc.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 잠긴 파일은 남긴다 */ }
}
