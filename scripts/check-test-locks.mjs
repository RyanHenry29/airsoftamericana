import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const testLockDirs = [
  path.join(root, "apps", "api", "data-test"),
  path.join(root, "vitest", "data-test-root"),
];
const devLock = path.join(root, "apps", "api", "data", ".pglite.lock");

function findLocks(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === ".pglite.lock") out.push(p);
    }
  };
  walk(dir);
  return out;
}

const leaks = testLockDirs.flatMap(findLocks);

// O lock do banco de desenvolvimento (apps/api/data) pode existir se um
// processo dev estiver rodando — não é vazamento de teste. Reporta, mas não
// falha por ele.
let devHeld = false;
if (fs.existsSync(devLock)) {
  try {
    const pid = Number(fs.readFileSync(devLock, "utf8").trim());
    if (process.platform === "win32" && Number.isFinite(pid)) {
      const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
      }).toString();
      devHeld = !/No tasks are running/i.test(out) && /"(node|tsx|vitest|electron)"/i.test(out);
    } else if (Number.isFinite(pid)) {
      try { process.kill(pid, 0); devHeld = true; } catch { devHeld = false; }
    }
  } catch { devHeld = false; }
  console.log(`info: dev lock presente (${devLock}) holder_vivo=${devHeld} — ignorado (não é vazamento de teste)`);
}

if (leaks.length) {
  console.error("ERRO: locks PGlite vazaram em diretórios de teste:");
  for (const l of leaks) console.error(" - " + path.relative(root, l));
  process.exit(1);
}
console.log("ok: nenhum lock PGlite em diretórios de teste");
