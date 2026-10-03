// Discover the exact source-run marker, then poll the child's REST run status.
// Only completed/success passes; dispatch acceptance alone never passes.
// Env: GH_TOKEN, TARGET_REPO, TARGET_WORKFLOW, SOURCE_RUN_ID,
//      MAX_DISCOVERY_ATTEMPTS? (60), WAIT_TIMEOUT_MS? (45 minutes, overall).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleepMs } from "node:timers/promises";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 15000;
const REQUEST_TIMEOUT_MS = 30000;

export function findChildRun(runs, sourceRunId) {
  const marker = new RegExp(`(?:^|\\s)source-run ${escapeRegExp(sourceRunId)}(?=\\s|$)`);
  return runs.find(run => marker.test(String(run.displayTitle ?? "")));
}

// Use only Actions REST endpoints, avoiding gh run watch's Checks dependency.
export async function githubGet(path, timeout, exec = execFileAsync) {
  let stdout;
  try {
    ({ stdout } = await exec("gh", ["api", "--method", "GET", path], { timeout, maxBuffer: 8 * 1024 * 1024 }));
  } catch (error) {
    const status = Number(String(error.stderr ?? "").match(/HTTP (\d{3})/)?.[1]);
    // Do not echo subprocess output, which may contain sensitive diagnostics.
    const failure = new Error(status ? `GitHub API returned HTTP ${status}` : "GitHub API request failed");
    failure.retryable = status === 429 || status >= 500 || error.killed === true;
    throw failure;
  }
  return JSON.parse(stdout);
}

export async function waitForSuite(env, deps = {}) {
  const sourceRunId = required(env, "SOURCE_RUN_ID");
  const repo = required(env, "TARGET_REPO");
  const workflow = required(env, "TARGET_WORKFLOW");
  const maxAttempts = positiveInteger(env.MAX_DISCOVERY_ATTEMPTS ?? 60, "MAX_DISCOVERY_ATTEMPTS");
  const timeout = positiveInteger(env.WAIT_TIMEOUT_MS ?? 45 * 60 * 1000, "WAIT_TIMEOUT_MS");
  const { sleep = sleepMs, now = () => performance.now(), logger = () => {}, get = githubGet } = deps;
  const deadline = now() + timeout;
  const checkDeadline = () => {
    if (now() >= deadline) throw new Error(`Timed out waiting for downstream source-run ${sourceRunId}`);
  };
  const pause = async () => {
    checkDeadline();
    await sleep(Math.min(POLL_INTERVAL_MS, deadline - now()));
    checkDeadline();
  };
  const request = async path => {
    for (let attempt = 1; ; attempt += 1) {
      checkDeadline();
      try {
        const result = await get(path, Math.max(1, Math.min(REQUEST_TIMEOUT_MS, Math.floor(deadline - now()))));
        checkDeadline();
        return result;
      } catch (error) {
        if (!error.retryable || attempt >= 3) throw error;
        logger(`Retrying downstream status request (${attempt}/3)`);
        await pause();
      }
    }
  };
  const listRuns = deps.listRuns ?? (async () => {
    const result = await request(`repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=repository_dispatch&per_page=50`);
    return result.workflow_runs.map(run => ({
      databaseId: run.id, displayTitle: run.display_title, url: run.html_url,
    }));
  });

  let child;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    checkDeadline();
    child = findChildRun(await listRuns(), sourceRunId);
    checkDeadline();
    if (child) break;
    logger(`Could not find downstream suite run for source-run ${sourceRunId} (attempt ${attempt}/${maxAttempts})`);
    if (attempt < maxAttempts) await pause();
  }
  if (!child) {
    logger(`Could not find downstream suite run for source-run ${sourceRunId}`);
    return 1;
  }

  logger(`Found downstream suite run ${child.databaseId} (${child.url})`);
  for (;;) {
    const run = await request(`repos/${repo}/actions/runs/${child.databaseId}`);
    if (run.id !== child.databaseId || typeof run.status !== "string") {
      throw new Error("Invalid downstream workflow run response");
    }
    if (run.status === "completed") {
      logger(`Downstream suite run ${child.databaseId} concluded ${run.conclusion}`);
      return run.conclusion === "success" ? 0 : 1;
    }
    await pause();
  }
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}

function required(env, name) {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new Error(`wait-downstream-suite requires ${name}`);
  return value;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
