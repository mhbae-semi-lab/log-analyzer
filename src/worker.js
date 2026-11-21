// 파일 읽기 Worker: File 을 조각으로 읽어 디코딩 → 줄 나누기 → 파싱. 결과는 묶음으로 나눠 보내 화면이 멈추지 않게 한다.
import { createReader, detectEncoding } from "./parse.js";

const CHUNK = 8 << 20;
const BATCH = 100000;
let stop = false;

self.onmessage = async ({ data }) => {
  if (data.type === "cancel") { stop = true; return; }
  if (data.type !== "parse") return;
  stop = false;
  const { file, opts } = data;
  const t0 = performance.now();
  try {
    let enc = opts.encoding;
    if (!enc || enc === "auto") enc = detectEncoding(new Uint8Array(await file.slice(0, 1 << 16).arrayBuffer()));
    const dec = new TextDecoder(enc);
    const rd = createReader(opts);
    let rest = "", sent = 0, err = null;
    const flush = () => {
      const E = rd.res.entries;
      if (E.length - sent >= BATCH) { self.postMessage({ type: "batch", entries: E.slice(sent) }); sent = E.length; }
    };
    for (let off = 0; off < file.size && !stop; off += CHUNK) {
      const buf = await file.slice(off, off + CHUNK).arrayBuffer();
      const text = rest + dec.decode(buf, { stream: off + CHUNK < file.size });
      const cut = text.lastIndexOf("\n");
      const body = cut >= 0 ? text.slice(0, cut) : text;
      rest = cut >= 0 ? text.slice(cut + 1) : "";
      if (cut < 0 && off + CHUNK < file.size) { rest = text; continue; }
      try { rd.push(body.split("\n")); } catch (e) { err = e; break; }
      flush();
      self.postMessage({ type: "progress", done: Math.min(file.size, off + CHUNK), total: file.size });
    }
    if (stop) { self.postMessage({ type: "canceled" }); return; }
    if (err) { self.postMessage({ type: "error", code: err.message }); return; }
    if (rest) rd.push([rest]);
    const res = rd.end(); // 시각 순서가 뒤섞였으면 여기서 정렬된다 → 정렬된 전체를 다시 보낸다
    const resent = res.entries.length && sent && res.sorted === false;
    const tail = resent ? res.entries : res.entries.slice(sent);
    const { entries, ...meta } = res;
    self.postMessage({ type: "done", entries: tail, replace: resent, meta: { ...meta, encoding: enc, ms: performance.now() - t0 } });
  } catch (e) {
    self.postMessage({ type: "error", code: e.message || String(e) });
  }
};
