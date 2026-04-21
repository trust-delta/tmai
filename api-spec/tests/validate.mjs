// Validate corevents.schema.json and the OpenAPI TmaiError schema against the
// fixture corpus in tests/fixtures/. Exits non-zero on the first mismatch so
// CI catches contract drift between this repo, tmai-core, and UI consumers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

const readJson = (rel) =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"));

const listJson = (rel) => {
  const dir = path.join(repoRoot, rel);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(rel, f));
};

const openapi = readJson("openapi.json");
const corevents = readJson("corevents.schema.json");

// `strict: false` — OpenAPI 3.1 documents use vocabulary (`example`, `tags`,
// `operationId`, `x-*`) that Ajv's strict mode rejects. We only care about
// schema-shape validation, not OpenAPI linting (redocly handles that).
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Register openapi.json as a root schema so we can $ref into its subschemas.
// Internal `#/components/schemas/X` references inside TmaiError resolve
// against this root, as intended.
ajv.addSchema(openapi, "openapi.json");

const validateCoreEvent = ajv.compile(corevents);
const validateTmaiError = ajv.compile({
  $ref: "openapi.json#/components/schemas/TmaiError",
});

let failed = 0;

const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
    if (detail) console.log(`       ${detail}`);
  }
};

const runSuite = (name, validator, validDir, invalidDir) => {
  console.log(`\n# ${name}`);
  for (const rel of listJson(validDir)) {
    const doc = readJson(rel);
    const ok = validator(doc);
    check(
      `valid:   ${path.basename(rel)}`,
      ok,
      ok ? "" : ajv.errorsText(validator.errors),
    );
  }
  for (const rel of listJson(invalidDir)) {
    const doc = readJson(rel);
    const ok = validator(doc);
    // invalid fixtures MUST be rejected
    check(
      `invalid: ${path.basename(rel)}`,
      !ok,
      ok ? "fixture was accepted but should have been rejected" : "",
    );
  }
};

runSuite(
  "CoreEvent (corevents.schema.json)",
  validateCoreEvent,
  "tests/fixtures/corevents/valid",
  "tests/fixtures/corevents/invalid",
);

runSuite(
  "TmaiError (openapi.json#/components/schemas/TmaiError)",
  validateTmaiError,
  "tests/fixtures/tmai-error/valid",
  "tests/fixtures/tmai-error/invalid",
);

if (failed > 0) {
  console.error(`\n${failed} fixture(s) failed validation`);
  process.exit(1);
} else {
  console.log(`\nall fixtures validated successfully`);
}
