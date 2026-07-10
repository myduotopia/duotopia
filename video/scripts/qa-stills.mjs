// QA 檢查點批次渲染：bundle 一次＋共用瀏覽器 → renderStill 多張（每張 ~0.5-1s）
// 取代「整片渲染後抽幀」，QA loop 每輪省 15-20 分鐘。
// 用法: node scripts/qa-stills.mjs <compositionId> <checkpoints.json 絕對路徑> <outDir 絕對路徑>
// checkpoints.json: [{ "name": "03_scene_start.png", "frame": 123 }, ...]
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [compId, checkpointsFile, outDir] = process.argv.slice(2);
if (!compId || !checkpointsFile || !outDir) {
  console.error("usage: node scripts/qa-stills.mjs <compId> <checkpoints.json> <outDir>");
  process.exit(1);
}

const root = path.dirname(fileURLToPath(import.meta.url));
const checkpoints = JSON.parse(fs.readFileSync(checkpointsFile, "utf-8"));
fs.mkdirSync(outDir, { recursive: true });

console.log("bundling...");
const serveUrl = await bundle({ entryPoint: path.join(root, "..", "src", "index.ts") });
const composition = await selectComposition({ serveUrl, id: compId });
console.log(`rendering ${checkpoints.length} stills for ${compId} (${composition.durationInFrames} frames total)`);

// 共用一個瀏覽器：renderStill 預設每張各開一個，量大時 compositor socket 會 EPIPE。
// 每張加 45s 硬 timeout（OffthreadVideo 抽幀偶發死鎖、且掛在 renderStill 內建 timeout 管不到處）
// → 逾時就砍掉瀏覽器重開，該張重試一次。
const STILL_TIMEOUT_MS = 45000;
let browser = await openBrowser("chrome");

const renderOne = (frame, output) =>
  Promise.race([
    renderStill({ composition, serveUrl, frame, output, puppeteerInstance: browser }),
    new Promise((_, rej) => setTimeout(() => rej(new Error("STILL_TIMEOUT")), STILL_TIMEOUT_MS)),
  ]);

let done = 0;
let failed = [];
for (const cp of checkpoints) {
  const frame = Math.max(0, Math.min(composition.durationInFrames - 1, cp.frame));
  const output = path.join(outDir, cp.name);
  let ok = false;
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    try {
      await renderOne(frame, output);
      ok = true;
    } catch (e) {
      console.error(`  ${e.message === "STILL_TIMEOUT" ? "TIMEOUT" : "ERR"} ${cp.name} (attempt ${attempt + 1}): ${e.message?.slice(0, 100)}`);
      // 死鎖恢復：砍掉瀏覽器重開再試
      try { await browser.close({ silent: true }); } catch {}
      browser = await openBrowser("chrome");
      if (attempt === 1) failed.push(cp.name);
    }
  }
  done += ok ? 1 : 0;
  if (done % 20 === 0) console.log(`  ${done}/${checkpoints.length}`);
}
try { await browser.close({ silent: true }); } catch {}
console.log(`done: ${done}/${checkpoints.length} stills -> ${outDir}` +
  (failed.length ? ` (failed: ${failed.join(", ")})` : ""));
process.exit(failed.length ? 1 : 0);
