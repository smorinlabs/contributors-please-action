// Discover and wait for the downstream child suite run, correlating on an exact
// source-run marker in the run's display title. Fails if the child is not found or
// does not succeed.
//
// Env: GH_TOKEN, TARGET_REPO, TARGET_WORKFLOW, SOURCE_RUN_ID, MAX_DISCOVERY_ATTEMPTS?
// Run discovery is inherently heuristic: GitHub's dispatch APIs do not return the
// created run id, so we match the exact "source-run <id>" marker (word-boundary, not
// substring) to avoid correlating with a different run.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleepMs } from "node:timers/promises";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 15000;

export function findChildRun(runs, sourceRunId) {
  const marker = new RegExp(`source-run ${escapeRegExp(sourceRunId)}(?!\\d)`);
  return runs.find(run => marker.test(String(run.displayTitle ?? "")));
}

export async function waitForSuite(env, deps) {
  const sourceRunId = required(env, "SOURCE_RUN_ID");
  const repo = required(env, "TARGET_REPO");
  const workflow = required(env, "TARGET_WORKFLOW");
  const { listRuns, watchRun, sleep = sleepMs, logger } = deps;
  // ~15 min discovery window at the 15s poll interval, matching the prior inline
  // loop, so a slow-starting child suite is not spuriously declared missing.
  const maxAttempts = Number(env.MAX_DISCOVERY_ATTEMPTS ?? 60);

  let child;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const runs = await (listRuns ?? defaultListRuns(repo, workflow))();
    child = findChildRun(runs, sourceRunId);
    if (child) {
      break;
    }
    logger(`Could not find downstream suite run for source-run ${sourceRunId} (attempt ${attempt}/${maxAttempts})`);
    if (attempt < maxAttempts) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  if (!child) {
    logger(`Could not find downstream suite run for source-run ${sourceRunId}`);
    return 1;
  }

  logger(`Found downstream suite run ${child.databaseId} (${child.url})`);
  const code = await (watchRun ?? defaultWatchRun(repo))(child);
  logger(`Downstream suite run ${child.databaseId} concluded with exit ${code}`);
  return code;
}

function required(env, name) {
  const value = String(env[name] ?? "").trim();
  if (!value) {
    throw new Error(`wait-downstream-suite requires ${name}`);
  }
  return value;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function defaultListRuns(repo, workflow) {
  return async () => {
    const { stdout } = await execFileAsync("gh", [
      "run",
      "list",
      "--repo",
      repo,
      "--workflow",
      workflow,
      "--json",
      "databaseId,displayTitle,status,conclusion,url",
      "--limit",
      "50",
    ]);
    return JSON.parse(stdout);
  };
}

function defaultWatchRun(repo) {
  return async run => {
    try {
      await execFileAsync(
        "gh",
        ["run", "watch", String(run.databaseId), "--repo", repo, "--exit-status", "--interval", "15"],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      return 0;
    } catch (error) {
      return typeof error?.code === "number" ? error.code : 1;
    }
  };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("wait-downstream-suite.mjs");
if (invokedDirectly) {
  waitForSuite(process.env, { logger: line => process.stderr.write(`${line}\n`) })
    .then(code => process.exit(code))
    .catch(error => {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    });
}
