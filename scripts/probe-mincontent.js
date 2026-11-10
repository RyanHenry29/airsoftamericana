// Diagnóstico de min-content: em 320px, quem força o documento a 341?
const { chromium } = require("playwright");
const BASE = process.env.AUDIT_BASE || "http://localhost:3000";
const W = Number(process.env.W || 320);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: W, height: 900 });
  await page.goto(BASE + (process.env.ROUTE || "/"), { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(500);
  const rows = await page.evaluate((vw) => {
    const avail = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const prevW = el.style.width;
      el.style.width = "min-content";
      const mc = el.getBoundingClientRect().width;
      el.style.width = prevW;
      if (mc > avail + 1) {
        out.push({
          sel: `${el.tagName.toLowerCase()}.${String(el.className || "").replace(/\s+/g, ".").slice(0, 70)}`,
          mc: Math.round(mc),
          text: (el.textContent || "").trim().slice(0, 60),
        });
      }
    }
    out.sort((a, b) => b.mc - a.mc);
    return { avail, rows: out.slice(0, 25) };
  }, W);
  console.log(`viewport clientWidth=${rows.avail}`);
  for (const r of rows.rows) console.log(`  ${r.mc}px  ${r.sel}  | ${r.text}`);
  await browser.close();
})();
