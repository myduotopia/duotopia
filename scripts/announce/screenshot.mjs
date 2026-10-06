#!/usr/bin/env node
/**
 * 更新公告截圖工具（issue #1100）。
 *
 * 兩種模式：
 *
 * 1. 實際畫面截圖（新功能 / 改版）：開 per-issue preview 環境，以「Demo 教師」快速登入後截圖
 *    node screenshot.mjs --issue 1046 --path /teacher/classrooms --out shot.png
 *      [--steps steps.json]   進到畫面前的操作（點擊、輸入、等待…），格式見下方
 *      [--selector CSS]       只截某個元素
 *      [--hero]               主圖：1200×780（20:13，LINE 卡片 hero）JPEG
 *      [--base URL]           指定網站（預設 per-issue preview，不存在時改用 staging）
 *
 * 2. 圖卡（修正類）：把 HTML 轉成 1200×780 PNG
 *    node screenshot.mjs --html card.html --out card.png
 *
 * steps.json：
 *   [
 *     { "goto": "/teacher/classrooms" },
 *     { "click": "text=分組" },
 *     { "fill": ["input[name=name]", "第一組"] },
 *     { "waitFor": "text=第一組" },
 *     { "wait": 800 }
 *   ]
 *
 * 只登入 Demo 教師帳號（非 production 環境才有快速登入按鈕），畫面只會出現 demo 資料。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const PROJECT_HASH = "316409492201";
const REGION = "asia-east1";
const STAGING = `https://duotopia-staging-frontend-${PROJECT_HASH}.${REGION}.run.app`;
const HERO = { width: 1200, height: 780 }; // 20:13
const PAGE = { width: 1280, height: 800 };

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = next;
      i += 1;
    }
  }
  return args;
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function reachable(url) {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveBase(args) {
  if (args.base) return String(args.base).replace(/\/$/, "");
  if (!args.issue) return STAGING;
  const preview = `https://duotopia-preview-issue-${args.issue}-frontend-${PROJECT_HASH}.${REGION}.run.app`;
  if (await reachable(preview)) return preview;
  console.warn(
    `⚠️  找不到 #${args.issue} 的 preview 環境（${preview}），改用 staging 截圖。\n` +
      "   staging 的畫面可能還不包含這個 issue 的改動，請確認截圖內容。",
  );
  return STAGING;
}

async function loginAsDemoTeacher(page, base) {
  await page.goto(`${base}/teacher/login`, { waitUntil: "networkidle" });
  const demo = page.getByRole("button", { name: /Demo 教師|demo@duotopia\.com/ });
  if ((await demo.count()) === 0) {
    fail("登入頁沒有「Demo 教師」快速登入按鈕（production 不提供，請改用 preview / staging）");
  }
  await demo.first().click();
  await page.waitForURL((url) => !url.pathname.endsWith("/teacher/login"), {
    timeout: 30000,
  });
  await page.waitForLoadState("networkidle");
}

async function runSteps(page, base, steps) {
  for (const step of steps) {
    if (step.goto) await page.goto(`${base}${step.goto}`, { waitUntil: "networkidle" });
    else if (step.click) await page.locator(step.click).first().click();
    else if (step.fill) await page.locator(step.fill[0]).first().fill(step.fill[1]);
    else if (step.hover) await page.locator(step.hover).first().hover();
    else if (step.waitFor) await page.locator(step.waitFor).first().waitFor();
    else if (step.wait) await page.waitForTimeout(Number(step.wait));
    else fail(`不認得的步驟：${JSON.stringify(step)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) fail("缺少 --out <輸出檔案>");
  const out = resolve(String(args.out));

  const browser = await chromium.launch();
  try {
    if (args.html) {
      // 圖卡模式：固定 1200×780
      const page = await browser.newPage({ viewport: HERO, deviceScaleFactor: 1 });
      await page.setContent(readFileSync(String(args.html), "utf8"), {
        waitUntil: "networkidle",
      });
      await page.screenshot({ path: out, type: "png" });
      console.log(out);
      return;
    }

    const base = await resolveBase(args);
    const hero = Boolean(args.hero);
    const context = await browser.newContext({
      viewport: hero ? HERO : PAGE,
      deviceScaleFactor: 1.5,
      locale: "zh-TW",
    });
    // 截圖畫面保持乾淨：不跳「操作手冊」、收合右側教學工具列（只存在這個瀏覽器的 localStorage）
    await context.addInitScript(() => {
      localStorage.setItem("duotopia_help_dismissed", "true");
      localStorage.setItem("duotopia-toolbar-collapsed", "true");
    });
    const page = await context.newPage();
    await loginAsDemoTeacher(page, base);
    if (args.path) await page.goto(`${base}${args.path}`, { waitUntil: "networkidle" });
    if (args.steps) {
      await runSteps(page, base, JSON.parse(readFileSync(String(args.steps), "utf8")));
    }
    await page.waitForTimeout(500); // 等動畫結束

    const options = hero
      ? { path: out, type: "jpeg", quality: 85 }
      : { path: out, type: "png" };
    if (args.selector) await page.locator(String(args.selector)).first().screenshot(options);
    else await page.screenshot(options);
    console.error(`📸 ${base}${args.path || ""}`);
    console.log(out);
  } finally {
    await browser.close();
  }
}

main().catch((err) => fail(err.message));
