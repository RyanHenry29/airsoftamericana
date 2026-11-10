// Auditoria de responsividade — loja em produção/dados reais.
// Marcadores:
//   OVERFLOW  → barra horizontal de página (docSW > clientWidth)
//   CLIPPED   → elemento cortado por ancestral com overflow hidden/clip
//   NOSCRUB   → scroller (auto/scroll) com rolagem interna e scrollbar escondida
//               → conteúdo recortado sem afordância (o "BLO" da barra)
const { chromium } = require("playwright");

const BASE = process.env.AUDIT_BASE || "http://localhost:3000";
const ROUTES = (process.env.AUDIT_ROUTES || "/").split(",");
const WIDTHS = (process.env.AUDIT_WIDTHS ||
  "1920,1440,1280,1180,1100,1024,990,980,970,961,955,950,946,940,930,920,910,900,860,820,768,700,640,560,520,480,414,390,360,320"
).split(",").map(Number);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let problems = 0;

  for (const route of ROUTES) {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(250);
      const res = await page.evaluate((vw) => {
        const out = { docSW: 0, cw: 0, overflow: [], clipped: [], noscrub: [] };
        const de = document.documentElement;
        out.docSW = de.scrollWidth;
        out.cw = de.clientWidth;

        const name = (el) => `${el.tagName.toLowerCase()}.${String(el.className || "").replace(/\s+/g, ".").slice(0, 64)}`;

        if (de.scrollWidth > de.clientWidth + 1) {
          for (const el of document.querySelectorAll("body *")) {
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.right <= de.clientWidth + 1) continue;
            let p = el.parentElement, sealed = false;
            while (p && p !== document.body) {
              if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) { sealed = true; break; }
              p = p.parentElement;
            }
            if (!sealed) out.overflow.push(`${name(el)} [..${Math.round(r.right)}]`);
          }
        }

        for (const el of document.querySelectorAll("body *")) {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          if (el.getAttribute("aria-hidden") === "true" || el.tagName.toLowerCase() === "svg") continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;

          let p = el.parentElement;
          while (p && p !== document.body) {
            const ps = getComputedStyle(p);
            if (/hidden|clip/.test(ps.overflowX)) {
              const pr = p.getBoundingClientRect();
              if (r.right > pr.right + 1 || r.left < pr.left - 1) out.clipped.push(`${name(el)} em ${name(p)}`);
              break;
            }
            p = p.parentElement;
          }
        }

        // scrollers com conteúdo além da borda SEM afordância (scrollbar escondida
        // por CSS). Tabela com barra visível é padrão legítimo e não é marcada.
        for (const el of document.querySelectorAll("body *")) {
          const cs = getComputedStyle(el);
          if (!/auto|scroll/.test(cs.overflowX)) continue;
          if (el.scrollWidth <= el.clientWidth + 1) continue;
          const webkitHidden =
            getComputedStyle(el, "::-webkit-scrollbar").display === "none";
          if (cs.scrollbarWidth !== "none" && !webkitHidden) continue;
          out.noscrub.push(`${name(el)} rola ${el.scrollWidth - el.clientWidth}px (barra escondida)`);
        }

        out.overflow = [...new Set(out.overflow)].slice(0, 8);
        out.clipped = [...new Set(out.clipped)].slice(0, 8);
        out.noscrub = [...new Set(out.noscrub)].slice(0, 8);
        return out;
      }, w);

      const bad = res.docSW > res.cw + 1 || res.overflow.length || res.clipped.length || res.noscrub.length;
      if (bad) {
        problems++;
        console.log(`\n== ${route} @ ${w}px == docSW=${res.docSW} cw=${res.cw}`);
        res.overflow.forEach((s) => console.log(`   OVERFLOW ${s}`));
        res.clipped.forEach((s) => console.log(`   CLIPPED  ${s}`));
        res.noscrub.forEach((s) => console.log(`   NOSCRUB  ${s}`));
      }
    }
  }
  console.log(`\nTOTAL: ${problems} combinações com marcação.`);
  await browser.close();
})();
