// Verifies the contributors-please version references stay in sync:
//   1. embedded   - VERSION exported by dist/contributors-please-lib.js
//   2. lockfile   - package-lock.json snapshot of the file:../contributors-please dep
//   3. trackedRef - tracked engine release ref in .contributors-please-engine-ref
//   4. localEngine- package.json version of the ../contributors-please checkout
//   5. pin/latest - compatibility override vs latest engine release
//
// Usage:
//   node scripts/check-engine-sync.mjs           # trusted check (needs network)
//   node scripts/check-engine-sync.mjs --local   # offline checks only (pre-commit)
//   node scripts/check-engine-sync.mjs --release # strict release gate
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ENGINE_REPO = "smorinlabs/contributors-please";
const VARIABLE = "CONTRIBUTORS_PLEASE_LIBRARY_REF";
const TRACKED_REF_FILE = ".contributors-please-engine-ref";

function modeFromArgs(argv) {
  const flags = argv.filter(arg => ["--local", "--trusted", "--release"].includes(arg));
  if (flags.length > 1) {
    throw new Error(`Choose only one engine sync mode, got: ${flags.join(", ")}`);
  }
  if (flags[0] === "--local") return "local";
  if (flags[0] === "--release") return "release";
  return "trusted";
}

function stripV(ref) {
  return ref?.trim().replace(/^v/, "");
}

function isSemverRef(ref) {
  return /^v?\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(ref ?? "");
}

function refMismatch(left, right) {
  return left !== undefined && right !== undefined && stripV(left) !== stripV(right);
}

const rebuildCommands = target =>
  [
    `# with ../contributors-please checked out at ${target}:`,
    "npm install && npm run build && npm test",
    "git add dist package-lock.json",
    `git commit -m "fix(deps): rebuild dist against contributors-please ${target}"`,
  ].join("\n");

export function diagnose(
  { embedded, lockfile, localEngine, trackedRef, pin, latestRelease },
  { mode = "trusted" } = {}
) {
  const failures = [];
  const notes = [];
  const checksLatestRelease = mode === "trusted" || mode === "release";

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

  if (refMismatch(trackedRef, lockfile)) {
    failures.push({
      id: "tracked-ref-vs-lockfile",
      message: `tracked engine ref (${trackedRef}) != lockfile snapshot (${lockfile})`,
      remedy: rebuildCommands(trackedRef),
    });
  }

  if (refMismatch(trackedRef, embedded)) {
    failures.push({
      id: "tracked-ref-vs-embedded",
      message: `tracked engine ref (${trackedRef}) != embedded lib version (${embedded})`,
      remedy: rebuildCommands(trackedRef),
    });
  }

  if (refMismatch(trackedRef, localEngine)) {
    failures.push({
      id: "tracked-ref-vs-local-engine",
      message: `tracked engine ref (${trackedRef}) != ../contributors-please checkout (${localEngine})`,
      remedy: rebuildCommands(trackedRef),
    });
  }

  if (pin !== undefined && !isSemverRef(pin)) {
    notes.push(
      `${VARIABLE} is "${pin}" (floating compatibility override); ` +
        "use a release tag for reproducible sync checks."
    );
  }

  if (pin !== undefined && latestRelease !== undefined && isSemverRef(pin)) {
    if (stripV(pin) !== stripV(latestRelease)) {
      failures.push({
        id: "pin-vs-latest-release",
        message: `compatibility pin ${VARIABLE}=${pin} != latest engine release (${latestRelease})`,
        remedy: `Unset ${VARIABLE} or set it to ${latestRelease}.`,
      });
    }
  }

  if (pin !== undefined && trackedRef !== undefined && isSemverRef(pin)) {
    if (stripV(pin) !== stripV(trackedRef)) {
      failures.push({
        id: "pin-vs-tracked-ref",
        message: `compatibility pin ${VARIABLE}=${pin} != tracked engine ref (${trackedRef})`,
        remedy: `Unset ${VARIABLE} or set it to ${trackedRef}.`,
      });
    }
  }

  if (checksLatestRelease && refMismatch(trackedRef, latestRelease)) {
    failures.push({
      id: "tracked-ref-vs-latest-release",
      message: `tracked engine ref (${trackedRef}) != latest engine release (${latestRelease})`,
      remedy: [
        `printf '%s\\n' '${latestRelease}' > ${TRACKED_REF_FILE}`,
        `# then rebuild dist and package-lock against ${latestRelease}`,
      ].join("\n"),
    });
  }

  if (checksLatestRelease && refMismatch(embedded, latestRelease)) {
    failures.push({
      id: "embedded-vs-latest-release",
      message: `embedded lib version (${embedded}) != latest engine release (${latestRelease})`,
      remedy: rebuildCommands(latestRelease),
    });
  }

  return { ok: failures.length === 0, failures, notes };
}

function readTrackedRef(root) {
  const refPath = resolve(root, TRACKED_REF_FILE);
  if (!existsSync(refPath)) return undefined;
  const ref = readFileSync(refPath, "utf8").trim();
  return ref || undefined;
}

async function gather(mode) {
  const root = process.cwd();
  const versions = {};

  const lib = await import(
    pathToFileURL(resolve(root, "dist/contributors-please-lib.js")).href
  );
  versions.embedded = lib.VERSION;

  const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  versions.lockfile = lock.packages?.["../contributors-please"]?.version;
  versions.trackedRef = readTrackedRef(root);

  const enginePkg = resolve(root, "../contributors-please/package.json");
  if (existsSync(enginePkg)) {
    versions.localEngine = JSON.parse(readFileSync(enginePkg, "utf8")).version;
  }

  if (mode !== "local") {
    versions.pin = process.env[VARIABLE];
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

async function fetchLatestRelease() {
  const data = await githubApi(`/repos/${ENGINE_REPO}/releases/latest`);
  return data.tag_name;
}

function report(versions, result) {
  const rows = [
    ["embedded lib version", versions.embedded],
    ["lockfile snapshot", versions.lockfile],
    ["tracked engine ref", versions.trackedRef],
    ["../contributors-please checkout", versions.localEngine],
    [`compatibility pin (${VARIABLE})`, versions.pin],
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
  const mode = modeFromArgs(process.argv.slice(2));
  const versions = await gather(mode);
  const result = diagnose(versions, { mode });
  report(versions, result);
  process.exit(result.ok ? 0 : 1);
}
