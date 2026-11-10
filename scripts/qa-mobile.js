// language: JS, file: scripts/qa-mobile.js, target: Node 22+ (playwright no repo root)
// QA visual + DOM do redesign mobile e do header desktop:
//   - larguras de celular e desktop, screenshots de topo/rodapé/menu;
//   - checagens objetivas: strip escondida ≤860, hambúrguer encostado à direita,
//     ícone de carrinho visível no mobile, faixa de benefícios do rodapé escondida
//     ≤640, endereço da loja presente no DOM do rodapé, busca mobile com campo.
// Uso: node scripts/qa-mobile.js  (servidor em AUDIT_BASE, default localhost:3000)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.AUDIT_BASE || "http://localhost:3000";
const OUT = process.env.OUT_DIR || path.join(require("os").tmpdir(), "aa-qa");
const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` :: ${detail}` : ""}`);
};

async function measure(page) {
  return page.evaluate(() => {
    const strip = document.querySelector(".dept-strip");
    const burger = document.querySelector(".header-burger");
    const actions = document.querySelector(".header-actions");
    const topbar = document.querySelector(".footer__topbar");
    const address = document.querySelector(".footer address.footer__line");
    const searchForm = document.querySelector(".header-search form");
    const vw = window.innerWidth;
    const rect = (el) => (el ? el.getBoundingClientRect() : null);
    const cs = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
    const overflow = Array.from(document.querySelectorAll("body *"))
      .filter((el) => el.getBoundingClientRect().right > vw + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`);
    return {
      vw,
      stripDisplay: cs(strip, "display"),
      stripVisible: Boolean(strip && cs(strip, "display") !== "none" && rect(strip).height > 0),
      burgerShown: Boolean(burger && cs(burger, "display") !== "none"),
      burgerRightGap: rect(burger) ? Math.round(vw - rect(burger).right) : null,
      actionsShown: Boolean(actions && cs(actions, "display") !== "none"),
      accountShown: (() => {
        const a = document.querySelector(".header-action--account");
        return Boolean(a && cs(a, "display") !== "none");
      })(),
      cartLabelShown: (() => {
        const l = document.querySelector(".header-action .header-action__label");
        return Boolean(l && cs(l, "display") !== "none");
      })(),
      searchBox: Boolean(searchForm && cs(searchForm, "backgroundColor") !== "rgba(0, 0, 0, 0)"),
      footerTopbarShown: Boolean(topbar && cs(topbar, "display") !== "none"),
      footerAddress: address ? address.textContent.replace(/\s+/g, " ").trim() : "",
      footerHours: document.querySelector(".footer__block:nth-of-type(2) .footer__line")?.textContent || "",
      overflow,
    };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // ── Desktop 1920: strip visível, ações com rótulo, sem regressão
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(900);
  let m = await measure(page);
  ok("desktop strip visível", m.stripVisible, `display=${m.stripDisplay}`);
  ok("desktop ações com rótulo", m.actionsShown && m.cartLabelShown, `label=${m.cartLabelShown}`);
  ok("desktop sem overflow", m.overflow.length === 0, m.overflow.join(" | "));
  await page.screenshot({ path: path.join(OUT, "top-1920.png"), clip: { x: 0, y: 0, width: 1920, height: 420 } });

  // ── Tablet 768: strip escondida (≤860), hambúrguer no canto, só ícones
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(700);
  m = await measure(page);
  ok("≤860 strip escondida", !m.stripVisible, `display=${m.stripDisplay}`);
  ok("≤860 hambúrguer no canto direito", m.burgerShown && m.burgerRightGap !== null && m.burgerRightGap <= 45, `gap=${m.burgerRightGap}px`);
  ok("≤860 carrinho visível só ícone", m.actionsShown && !m.accountShown, `actions=${m.actionsShown} account=${m.accountShown}`);
  ok("≤860 sem overflow", m.overflow.length === 0, m.overflow.join(" | "));
  await page.screenshot({ path: path.join(OUT, "top-768.png"), clip: { x: 0, y: 0, width: 768, height: 420 } });

  // ── Celular 390: busca com campo, menu com departamentos, rodapé completo
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(900);
  m = await measure(page);
  ok("390 busca com campo visível", m.searchBox, `bg=${m.searchBox}`);
  ok("390 sem overflow", m.overflow.length === 0, m.overflow.join(" | "));
  ok("390 rodapé com endereço da loja", m.footerAddress.includes("Rua") && m.footerAddress.includes("Americana"), m.footerAddress);
  await page.screenshot({ path: path.join(OUT, "top-390.png"), clip: { x: 0, y: 0, width: 390, height: 420 } });

  // menu hambúrguer aberto
  await page.click(".header-burger");
  await page.waitForTimeout(350);
  const menu = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll(".header-mobile a")).map((a) => a.textContent.trim());
    const labels = Array.from(document.querySelectorAll(".header-mobile__label")).map((s) => s.textContent.trim());
    return { links, labels, hasDepts: links.some((l) => ["Airsoft", "Tiro Esportivo", "Loadout"].includes(l)) };
  });
  ok("menu mobile lista departamentos", menu.hasDepts, `labels=${menu.labels.join("/")} links=${menu.links.length}`);
  await page.screenshot({ path: path.join(OUT, "menu-390.png"), clip: { x: 0, y: 0, width: 390, height: 844 } });
  await page.click(".header-burger");

  // rodapé no celular (390 e 360) + repetição de benefícios
  for (const w of [390, 360, 320]) {
    await page.setViewportSize({ width: w, height: 844 });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(700);
    m = await measure(page);
    ok(`${w} faixa de benefícios do rodapé escondida`, !m.footerTopbarShown, `display=${m.footerTopbarShown}`);
    ok(`${w} endereço presente`, m.footerAddress.includes("Rua"), m.footerAddress);
    await page.evaluate(() => document.querySelector(".footer")?.scrollIntoView());
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `footer-${w}.png`) });
  }

  // ── 900 (transição): strip de volta? não — ≤860 esconde; 900 mostra strip
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(700);
  m = await measure(page);
  ok("900 strip visível de volta", m.stripVisible, `display=${m.stripDisplay}`);
  await page.screenshot({ path: path.join(OUT, "top-900.png"), clip: { x: 0, y: 0, width: 900, height: 420 } });

  // ── og card (gerado em dev pelo Next)
  try {
    const res = await page.request.get(BASE + "/opengraph-image", { timeout: 45000 });
    const body = await res.body();
    fs.writeFileSync(path.join(OUT, "og-card.png"), body);
    ok("og card 200 png", res.status() === 200 && body.length > 10000, `status=${res.status()} bytes=${body.length}`);
  } catch (e) {
    ok("og card 200 png", false, String(e));
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\nTOTAL: ${results.length - failed.length}/${results.length} pass, ${failed.length} fail`);
  console.log("OUT=" + OUT);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
