// language: JS (ESM), file: scripts/validate-deploy-yaml.mjs
// Valida o contrato do deploy.yml: sintaxe YAML, gating de produção
// (needs nos três previews + if de workflow_dispatch) e ausência de --prod
// nos caminhos de preview.
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const doc = parse(readFileSync(".github/workflows/deploy.yml", "utf8"));
const jobs = Object.entries(doc.jobs);
const errors = [];

const prodJobs = jobs.filter(([n]) => n.startsWith("production-"));
const previewJobs = jobs.filter(([n]) => n.startsWith("preview-"));

for (const [name, job] of prodJobs) {
  const needs = job.needs ?? [];
  for (const p of ["preview-store", "preview-admin", "preview-api"]) {
    if (!needs.includes(p)) errors.push(`${name}: needs não inclui ${p}`);
  }
  const cond = job["if"] ?? "";
  if (!cond.includes("inputs.environment == 'production'")) {
    errors.push(`${name}: if não exige inputs.environment == 'production'`);
  }
  if (job.environment !== "production") {
    errors.push(`${name}: environment 'production' ausente (proteção GitHub)`);
  }
  const stepStr = JSON.stringify(job.steps ?? []);
  if (!stepStr.includes("--prod")) errors.push(`${name}: sem --prod nos comandos`);
}

for (const [name, job] of previewJobs) {
  const stepStr = JSON.stringify(job.steps ?? []);
  if (stepStr.includes("--prod")) errors.push(`${name}: preview NÃO pode usar --prod`);
  if (!stepStr.includes("--environment=preview")) errors.push(`${name}: pull preview ausente`);
}

console.log(`jobs: ${jobs.length} (preview: ${previewJobs.length}, production: ${prodJobs.length})`);
console.log(prodJobs.map(([n, j]) => `${n}: needs=[${(j.needs ?? []).join(",")}] if="${j["if"]}" env=${j.environment}`).join("\n"));
if (errors.length) {
  console.error("FALHAS:\n" + errors.map((e) => `- ${e}`).join("\n"));
  process.exit(1);
}
console.log("CONTRATO OK: push→preview apenas; produção exige previews verdes + workflow_dispatch production");
