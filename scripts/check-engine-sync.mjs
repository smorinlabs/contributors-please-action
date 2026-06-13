// Verifies the four contributors-please version references stay in sync:
//   1. embedded   - VERSION exported by dist/contributors-please-lib.js
//   2. lockfile   - package-lock.json snapshot of the file:../contributors-please dep
//   3. localEngine- package.json version of the ../contributors-please checkout
//   4. pin/latest - CONTRIBUTORS_PLEASE_LIBRARY_REF repo variable vs latest engine release
//
// Usage:
//   node scripts/check-engine-sync.mjs           # full check (needs network)
//   node scripts/check-engine-sync.mjs --local   # offline checks only (pre-commit)
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ENGINE_REPO = "smorinlabs/contributors-please";
const ACTION_REPO = "smorinlabs/contributors-please-action";
const VARIABLE = "CONTRIBUTORS_PLEASE_LIBRARY_REF";

function stripV(ref) {
  return ref?.replace(/^v/, "");
}

function isSemverRef(ref) {
  return /^v?\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(ref ?? "");
}

const rebuildCommands = target =>
  [
    `# with ../contributors-please checked out at ${target}:`,
    "npm install && npm run build && npm test",
    "git add dist package-lock.json",
    `git commit -m "fix(deps): rebuild dist against contributors-please ${target}"`,
  ].join("\n");

export function diagnose({ embedded, lockfile, localEngine, pin, latestRelease }) {
  const failures = [];
  const notes = [];

  if (embedded !== undefined && lockfile !== undefined && embedded !== lockfile) {
    failures.push({
      id: "embedded-vs-lockfile",
      message: `embedded lib version (${embedded}) != lockfile snapshot (${lockfile})`,
      remedy: rebuildCommands(`v${lockfile}`),
    });
  }

  if (embedded !== undefined && localEngine !== undefined && embedded !== localEngine) {
    failures.push({
      id: "embedded-vs-local-engine",
      message: `embedded lib version (${embedded}) != ../contributors-please checkout (${localEngine})`,
      remedy: rebuildCommands(`v${localEngine}`),
    });
  }

  if (pin !== undefined && !isSemverRef(pin)) {
    notes.push(
      `${VARIABLE} is "${pin}" (floating ref). CI tracks the engine branch head; ` +
        "pin a release tag for reproducible CI."
    );
  }

  if (pin !== undefined && latestRelease !== undefined && isSemverRef(pin)) {
    if (stripV(pin) !== stripV(latestRelease)) {
      failures.push({
        id: "pin-vs-latest-release",
        message: `CI pin ${VARIABLE}=${pin} != latest engine release (${latestRelease})`,
        remedy: [
          `gh api --method PATCH repos/${ACTION_REPO}/actions/variables/${VARIABLE} \\`,
          `  -f name=${VARIABLE} -f value=${latestRelease}`,
        ].join("\n"),
      });
    }
  }

  if (
    embedded !== undefined &&
    latestRelease !== undefined &&
    embedded !== stripV(latestRelease)
  ) {
    failures.push({
      id: "embedded-vs-latest-release",
      message: `embedded lib version (${embedded}) != latest engine release (${latestRelease})`,
      remedy: rebuildCommands(latestRelease),
    });
  }

  return { ok: failures.length === 0, failures, notes };
}

async function gather(local) {
  const root = process.cwd();
  const versions = {};

  const lib = await import(
    pathToFileURL(resolve(root, "dist/contributors-please-lib.js")).href
  );
  versions.embedded = lib.VERSION;

  const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  versions.lockfile = lock.packages?.["../contributors-please"]?.version;

  const enginePkg = resolve(root, "../contributors-please/package.json");
  if (existsSync(enginePkg)) {
    versions.localEngine = JSON.parse(readFileSync(enginePkg, "utf8")).version;
  }

  if (!local) {
    versions.pin = process.env[VARIABLE] || (await fetchVariable());
    versions.latestRelease = await fetchLatestRelease();
  }

  return versions;
}

async function githubApi(path) {
  const headers = { accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed: ${response.status}`);
  }
  return response.json();
}

async function fetchVariable() {
  try {
    const data = await githubApi(`/repos/${ACTION_REPO}/actions/variables/${VARIABLE}`);
    return data.value;
  } catch {
    return undefined; // variable lookup needs a token; skip the pin check without one
  }
}

async function fetchLatestRelease() {
  const data = await githubApi(`/repos/${ENGINE_REPO}/releases/latest`);
  return data.tag_name;
}

function report(versions, result) {
  const rows = [
    ["embedded lib version", versions.embedded],
    ["lockfile snapshot", versions.lockfile],
    ["../contributors-please checkout", versions.localEngine],
    [`CI pin (${VARIABLE})`, versions.pin],
    ["latest engine release", versions.latestRelease],
  ].filter(([, value]) => value !== undefined);

  const lines = [];
  lines.push(result.ok ? "✓ engine sync check passed" : "✖ engine sync check failed", "");
  for (const [label, value] of rows) {
    lines.push(`  ${label.padEnd(32)}: ${value}`);
  }
  for (const note of result.notes) {
    lines.push("", `note: ${note}`);
  }
  if (!result.ok) {
    lines.push("", "Actions required:");
    result.failures.forEach((failure, index) => {
      lines.push("", `${index + 1}. ${failure.message}`, failure.remedy.replace(/^/gm, "   "));
    });
  }
  const text = lines.join("\n");
  console.log(text);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      "## engine sync check",
      "",
      "| reference | version |",
      "|---|---|",
      ...rows.map(([label, value]) => `| ${label} | \`${value}\` |`),
      "",
      ...(result.ok
        ? ["✓ in sync"]
        : result.failures.flatMap(f => [`### ✖ ${f.message}`, "```bash", f.remedy, "```"])),
    ].join("\n");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  for (const failure of result.failures) {
    console.error(`::error::engine-sync ${failure.id}: ${failure.message}`);
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  const local = process.argv.includes("--local");
  const versions = await gather(local);
  const result = diagnose(versions);
  report(versions, result);
  process.exit(result.ok ? 0 : 1);
}
