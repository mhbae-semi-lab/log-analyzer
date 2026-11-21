// IndexedDB 저장소. 스키마 버전 1: kv(설정 · 화면 상태) · cases(사례) · history(설정 이력) · shadow(LLM 기록) · errors(오류 기록) · files(마지막 파일)
// IndexedDB 를 못 쓰는 환경(사생활 보호 창 등)에서는 메모리로 대신하고 새로고침하면 사라진다.
const DB = "log-analyzer", VER = 1;
const STORES = { kv: {}, cases: { keyPath: "id" }, history: { keyPath: "v" }, shadow: { autoIncrement: true }, errors: { autoIncrement: true }, files: {} };

let dbp = null;
const mem = Object.fromEntries(Object.keys(STORES).map((k) => [k, new Map()]));
let memSeq = 0;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    let req;
    try { req = indexedDB.open(DB, VER); } catch { res(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, o] of Object.entries(STORES)) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, o);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
    req.onblocked = () => res(null);
  });
  return dbp;
}

const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function tx(store, mode, fn) {
  const db = await open();
  if (!db) return fn(null);
  return fn(db.transaction(store, mode).objectStore(store));
}

export const get = (store, key) => tx(store, "readonly", (s) => (s ? wrap(s.get(key)) : mem[store].get(key)));
export const put = (store, value, key) => tx(store, "readwrite", (s) => {
  if (s) return wrap(key === undefined ? s.put(value) : s.put(value, key));
  const k = key ?? value?.[STORES[store].keyPath] ?? ++memSeq;
  mem[store].set(k, value);
  return k;
});
export const del = (store, key) => tx(store, "readwrite", (s) => (s ? wrap(s.delete(key)) : mem[store].delete(key)));
export const all = (store) => tx(store, "readonly", (s) => (s ? wrap(s.getAll()) : [...mem[store].values()]));
export const clear = (store) => tx(store, "readwrite", (s) => (s ? wrap(s.clear()) : mem[store].clear()));
export const clearAll = async () => { for (const s of Object.keys(STORES)) await clear(s); };
export const persistent = async () => !!(await open());

// 오류 기록은 최근 200건만 둔다
export async function logError(e) {
  try {
    await put("errors", { t: new Date().toISOString(), msg: String(e?.message || e).slice(0, 500), stack: String(e?.stack || "").slice(0, 1500) });
    const list = await tx("errors", "readonly", (s) => (s ? wrap(s.getAllKeys()) : [...mem.errors.keys()]));
    for (const k of list.slice(0, Math.max(0, list.length - 200))) await del("errors", k);
  } catch { /* 기록 실패는 무시 */ }
}

// 백업: kv · cases · history · shadow (파일 본문은 넣지 않는다)
export async function exportBackup() {
  const kv = {};
  const db = await open();
  if (db) {
    const keys = await wrap(db.transaction("kv").objectStore("kv").getAllKeys());
    for (const k of keys) if (k !== "apiKey") kv[k] = await get("kv", k);
  } else for (const [k, v] of mem.kv) if (k !== "apiKey") kv[k] = v;
  return { app: "log-analyzer", schema: VER, exported: new Date().toISOString(), kv, cases: await all("cases"), history: await all("history"), shadow: await all("shadow") };
}
export async function importBackup(b) {
  if (!b || b.app !== "log-analyzer" || !b.kv) throw new Error("not a log-analyzer backup");
  for (const [k, v] of Object.entries(b.kv)) await put("kv", v, k);
  for (const c of b.cases || []) await put("cases", c);
  await clear("history");
  for (const h of b.history || []) await put("history", h);
  await clear("shadow");
  for (const s of b.shadow || []) await put("shadow", s);
}
