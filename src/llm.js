// LLM 호출 · 마스킹 · 검증 재시도. 규칙이 먼저 판단하고, LLM 결과는 근거 줄 번호와 수치로 검증한다.
// 검증에 실패하면 이유를 알려 1회 다시 묻고, 그래도 실패하면 호출한 쪽이 규칙 결과로 대체한다.
import { OUTPUT_SCHEMA, SYSTEM, validateCauses, CONF } from "./analyze.js";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", fallbacks: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", fallbacks: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", fallbacks: false },
];

// ---------- 마스킹 ----------
// 괄호 그룹이 있으면 그 부분만 가린다. 같은 값은 같은 표지로 바꿔 줄 사이 관계는 남긴다.
export const BUILTIN_MASKS = [
  ["IP", "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b"],
  ["MAC", "\\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\\b"],
  ["MAIL", "[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+"],
  ["PATH", "(?:[A-Za-z]:\\\\|\\\\\\\\)[^\\s\"']+"],
  ["ID", "\\b(?:id|user|operator)=([\\w.-]+)"],
  ["LOT", "\\blot=([\\w.-]+)"],
  ["HOST", "\\bhost(?:name)?=([\\w.-]+)"],
  ["SN", "\\b(?:serial|sn)=([\\w.-]+)"],
];

export function compileMasks(builtin = true, custom = "") {
  const out = [];
  if (builtin) for (const [tag, src] of BUILTIN_MASKS) out.push({ tag, re: new RegExp(src, "gi") });
  String(custom || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((src, i) => {
    try { out.push({ tag: `X${i + 1}`, re: new RegExp(src, "g") }); } catch { /* 잘못된 정규식은 건너뜀 */ }
  });
  return out;
}

export function mask(text, masks) {
  const seen = new Map(), count = {};
  let n = 0;
  const token = (tag, v) => {
    const k = tag + "\u0000" + v;
    if (!seen.has(k)) { count[tag] = (count[tag] || 0) + 1; seen.set(k, `[${tag}-${count[tag]}]`); }
    n++;
    return seen.get(k);
  };
  let out = text;
  for (const { tag, re } of masks) {
    out = out.replace(re, (m, g1) => (typeof g1 === "string" && g1 ? m.replace(g1, token(tag, g1)) : token(tag, m)));
  }
  return { text: out, masked: n, values: seen.size };
}

// ---------- 제공자 ----------
let sdkMod = null;
async function sdk() {
  if (!sdkMod) sdkMod = await import("../vendor/anthropic-sdk/anthropic-sdk.js");
  return sdkMod;
}

export class LlmError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

function anthropicError(Anthropic, err, timeoutS) {
  if (err instanceof Anthropic.APIUserAbortError) return new LlmError("canceled", "canceled");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new LlmError("timeout", `timeout ${timeoutS}s`);
  if (err instanceof Anthropic.AuthenticationError) return new LlmError("auth", "API key rejected (401)");
  if (err instanceof Anthropic.PermissionDeniedError) return new LlmError("auth", "This key cannot use the model (403)");
  if (err instanceof Anthropic.RateLimitError) return new LlmError("rate", "Rate limited — try again later (429)");
  if (err instanceof Anthropic.BadRequestError) return new LlmError("request", "Bad request (400): " + err.message);
  if (err instanceof Anthropic.APIConnectionError) return new LlmError("network", "Network error: " + err.message);
  if (err instanceof Anthropic.APIError) return new LlmError("api", `API error (${err.status ?? "?"}): ${err.message}`);
  return err;
}

async function callAnthropic(o) {
  const mod = await sdk();
  const Anthropic = mod.default;
  const m = MODELS.find((x) => x.id === o.model) || MODELS[0];
  const client = new Anthropic({ apiKey: o.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 }); // 사용자 본인 키, 메모리에만
  const params = {
    model: m.id,
    max_tokens: 16000,
    system: o.system,
    messages: [{ role: "user", content: o.prompt }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
  };
  const req = { timeout: o.timeoutS * 1000, signal: o.signal };
  let res;
  try {
    // Opus 5.5 · Sonnet 5.5: 안전 분류기가 거절하면 서버가 다른 모델로 이어서 처리 (Haiku 5.5 는 미지원)
    res = m.fallbacks
      ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, req)
      : await client.messages.create(params, req);
  } catch (err) { throw anthropicError(Anthropic, err, o.timeoutS); }
  if (res.stop_reason === "refusal") throw new LlmError("refusal", "The model declined" + (res.stop_details?.category ? ` (${res.stop_details.category})` : ""));
  if (res.stop_reason === "max_tokens") throw new LlmError("length", "Output cut off at the length limit");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { out: JSON.parse(text), model: res.model };
}

// Ollama 는 스키마를 문법으로 강제한다. 소형 모델이 빈 배열로 빠지지 않게 후보 1~3개를 요구한다
// (Anthropic 요청에는 원래 스키마를 쓰고, 개수는 validateCauses 가 검사한다)
const OLLAMA_SCHEMA = structuredClone(OUTPUT_SCHEMA);
Object.assign(OLLAMA_SCHEMA.properties.causes, { minItems: 1, maxItems: 3 });
Object.assign(OLLAMA_SCHEMA.properties.causes.items.properties.evidence, { minItems: 1, maxItems: 5 });

async function callOllama(o) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort("timeout"), o.timeoutS * 1000);
  const onAbort = () => ctl.abort("canceled");
  o.signal?.addEventListener("abort", onAbort);
  try {
    const r = await fetch(String(o.ollamaUrl || "http://localhost:11434").replace(/\/+$/, "") + "/api/chat", {
      method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal,
      body: JSON.stringify({ model: o.model, stream: false, format: OLLAMA_SCHEMA,
        options: { temperature: 0, num_ctx: 8192, num_predict: 1500 }, // 기본 문맥은 근거 80줄을 다 못 담을 수 있고, 출력이 끝나지 않는 경우를 막는다
        messages: [{ role: "system", content: o.system }, { role: "user", content: o.prompt }] }),
    });
    if (!r.ok) throw new LlmError("api", `Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return { out: JSON.parse(j.message?.content || "{}"), model: j.model || o.model };
  } catch (err) {
    if (ctl.signal.aborted) throw new LlmError(ctl.signal.reason === "timeout" ? "timeout" : "canceled", String(ctl.signal.reason));
    if (err instanceof LlmError) throw err;
    if (err instanceof SyntaxError) throw err;
    throw new LlmError("network", "Ollama connection failed: " + err.message + " (OLLAMA_ORIGINS?)");
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
  }
}

// 모의 응답: 오프라인 시연용. 실제 모델이 아니며, 근거 검증 · 재시도 · 대체 흐름을 보여주려고
// 군집마다 정해진 결함(없는 줄 번호 · 지어낸 수치)을 섞는다. 화면과 기록에 "모의"로 표시된다.
export function mockAnswer(ctx, attempt) {
  const { pool, pre, code, lang } = ctx;
  const h = [...code].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const warnLines = pool.filter((e) => e.sev === 2);
  const top = pre[0];
  const ev = top ? pool.filter((e) => e.module === top.module && e.tpl === top.tpl).slice(-3).map((e) => e.n) : [];
  const alarms = pool.filter((e) => e.sev === 3).slice(0, 2).map((e) => e.n);
  const en = lang === "en";
  const causes = [];
  if (top && ev.length) causes.push({
    cause: en ? `Repeated [${top.module}] warning before the alarm points to the cause` : `알람 앞에 반복된 [${top.module}] 경고가 원인을 가리킴`,
    reasoning: en ? `Seen before ${top.coverage} of ${top.of} occurrences` : `${top.of}번 발생 중 ${top.coverage}번 앞에 나타남`,
    evidence: ev, confidence: "medium",
  });
  causes.push({
    cause: en ? "The first alarm in the chain is the place to start" : "연쇄의 첫 알람부터 확인",
    reasoning: en ? "Later alarms follow the first one in each occurrence" : "각 발생에서 뒤 알람이 첫 알람을 따라옴",
    evidence: alarms.length ? alarms : warnLines.slice(0, 1).map((e) => e.n), confidence: "low",
  });
  // 결함 규칙: 군집 코드 해시가 3의 배수면 1차만 틀림(재시도로 통과),
  // 직전 경고 근거가 약하면(집중도 20% 미만) 두 번 다 지어낸 수치를 넣음 → 규칙 결과로 대체
  const faultFirst = h % 3 === 0, faultAlways = !top || top.spec < 0.2;
  if ((attempt === 1 && faultFirst) || faultAlways) {
    causes[0].evidence = [...causes[0].evidence, 9999999];
    causes[0].reasoning += en ? " (about 73.4 kPa)" : " (약 73.4 kPa)";
  }
  return { out: { causes, checks: en ? ["Check the module named in the top warning"] : ["1순위 경고의 모듈 점검"] }, model: "mock" };
}

export async function callLLM(o) {
  if (o.provider === "anthropic") return callAnthropic(o);
  if (o.provider === "ollama") return callOllama(o);
  if (o.provider === "mock") {
    await new Promise((r, j) => { const id = setTimeout(r, 300); o.signal?.addEventListener("abort", () => { clearTimeout(id); j(new LlmError("canceled", "canceled")); }); });
    return mockAnswer(o.ctx, o.attempt);
  }
  throw new LlmError("config", "no provider");
}

// 분석 → 근거 검증 → 실패 이유를 알려 1회 재시도. 반환 { out|null, valid, attempts, log[], model }
export async function runValidated(o, call = callLLM) {
  const log = [];
  let note = "", model = o.model;
  const system = SYSTEM[o.lang] || SYSTEM.ko;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await call({ ...o, system, attempt, prompt: o.prompt + (note ? "\n\n" + note : "") });
      model = r.model || model;
      if (r.out && Array.isArray(r.out.causes)) for (const c of r.out.causes) if (!CONF.includes(c.confidence)) c.confidence = String(c.confidence || "").toLowerCase();
      const bad = validateCauses(r.out, o.pool, o.prompt, o.lang);
      log.push({ attempt, ok: !bad.length, bad });
      if (!bad.length) return { out: r.out, valid: true, attempts: attempt, log, model };
      note = (o.lang === "en" ? "Problems in the previous output: " : "이전 출력의 문제: ") + bad.join("; ") + (o.lang === "en" ? ". Fix them and answer again." : ". 고쳐서 다시 쓴다.");
    } catch (err) {
      log.push({ attempt, ok: false, error: err.kind || "error", message: err.message });
      if (err.kind === "canceled" || err.kind === "auth" || err.kind === "config") break;
    }
  }
  return { out: null, valid: false, attempts: log.length, log, model };
}
