// Screenshots do topo (header + strip + hero) e do rodapé, em várias larguras.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.AUDIT_BASE || "http://localhost:3000";
const OUT = process.env.OUT_DIR || path.join(require("os").tmpdir(), "aa-shots");
const WIDTHS = (process.env.WS || "1920,1180,961,900,768,640,480,360").split(",").map(Number);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setViewportSize({ width: 961, height: 900 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(800);
  const count = await page.evaluate(() => ({
    items: document.querySelectorAll(".dept-strip__item").length,
    stripH: Math.round(document.querySelector(".dept-strip")?.getBoundingClientRect().height || 0),
    stripSW: document.querySelector(".dept-strip")?.scrollWidth || 0,
    stripCW: document.querySelector(".dept-strip")?.clientWidth || 0,
  }));
  console.log("strip:", JSON.stringify(count));

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `top-${w}.png`), clip: { x: 0, y: 0, width: w, height: 460 } });
    console.log(`shot top-${w}.png`);
  }

  // rodapé em 320
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector(".footer")?.scrollIntoView());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "footer-320.png") });
  console.log("shot footer-320.png");

  // faixa de promoção em 700 (linha quebrada esperada)
  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "topbar-700.png"), clip: { x: 0, y: 0, width: 700, height: 160 } });
  console.log("shot topbar-700.png");

  console.log("OUT=" + OUT);
  await browser.close();
})();
