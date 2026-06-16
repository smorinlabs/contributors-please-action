#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REF_FILE = ".contributors-please-engine-ref";
const PR_BODY_FILE = ".sync-engine-release-pr-body.md";
const UPDATE_FILES = [
  REF_FILE,
  "package-lock.json",
  "dist/contributors-please-lib.js",
];

function isTruthy(value) {
  return /^(1|true|yes)$/i.test(value ?? "");
}

export function validateEngineRef(ref, { allowPrerelease = false } = {}) {
  const normalized = ref?.trim();
  if (!normalized) {
    throw new Error("engine ref is required");
  }
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`engine ref must be a release tag like v1.4.0, got ${normalized}`);
  }
  if (!allowPrerelease && normalized.includes("-")) {
    throw new Error(
      `engine ref ${normalized} is a prerelease; set ALLOW_PRERELEASE=true to sync it`
    );
  }
  return normalized;
}

export function isPrereleaseRef(ref) {
  return /^v\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(ref?.trim() ?? "");
}

export function syncBranchName(ref) {
  return `sync/contributors-please-${validateEngineRef(ref, { allowPrerelease: true })}`;
}

export function prTitle(ref) {
  return `chore: sync contributors-please ${validateEngineRef(ref, { allowPrerelease: true })}`;
}

export function plannedUpdateFiles() {
  return [...UPDATE_FILES];
}

export function prBody(ref) {
  const engineRef = validateEngineRef(ref, { allowPrerelease: true });
  const syncCommand = isPrereleaseRef(engineRef)
    ? "npm run check:sync:local"
    : "npm run check:sync:trusted";
  return [
    `Sync the action wrapper to contributors-please ${engineRef}.`,
    "",
    "Updated files:",
    ...plannedUpdateFiles().map(file => `- \`${file}\``),
    "",
    "Validation run by workflow:",
    "- `npm install`",
    "- `npm run build`",
    `- \`${syncCommand}\``,
    "- `npm test`",
  ].join("\n");
}

function readEventRef(eventPath) {
  if (!eventPath) return undefined;
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  return (
    event.inputs?.engine_ref ||
    event.client_payload?.engine_ref ||
    event.client_payload?.tag_name ||
    event.client_payload?.release?.tag_name ||
    event.release?.tag_name
  );
}

function resolveEngineRef(env = process.env) {
  return env.ENGINE_REF || env.INPUT_ENGINE_REF || readEventRef(env.GITHUB_EVENT_PATH);
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function runCli() {
  const ref = validateEngineRef(resolveEngineRef(), {
    allowPrerelease: isTruthy(process.env.ALLOW_PRERELEASE),
  });
  const branch = syncBranchName(ref);
  const title = prTitle(ref);
  const body = prBody(ref);
  const bodyPath = resolve(process.cwd(), PR_BODY_FILE);

  execFileSync("git", ["checkout", "-B", branch], { stdio: "inherit" });
  writeFileSync(resolve(process.cwd(), REF_FILE), `${ref}\n`);
  writeFileSync(bodyPath, `${body}\n`);

  writeOutput("engine_ref", ref);
  writeOutput("branch", branch);
  writeOutput("title", title);
  writeOutput("body_path", bodyPath);
  writeOutput("prerelease", isPrereleaseRef(ref) ? "true" : "false");

  console.log(`prepared ${branch} for contributors-please ${ref}`);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  runCli();
}
