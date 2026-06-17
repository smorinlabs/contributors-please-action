// Dispatch the downstream suite via repository_dispatch, validating required inputs
// before sending, retrying with backoff, and writing a machine-readable replay
// artifact plus a human replay command.
//
// Env: GH_TOKEN, TARGET_REPO, TARGET_WORKFLOW, ACTION_REF, LIBRARY_REF, SOURCE_RUN_ID,
//      SOURCE_WORKFLOW_RUN_ID?, SOURCE_SHA?, SOURCE_WORKFLOW?, REPLAY_PATH?
// SEC3: never prints GH_TOKEN; the replay command prints "${GH_TOKEN}" literally.

import { writeFile as fsWriteFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleepMs } from "node:timers/promises";

const execFileAsync = promisify(execFile);
const EVENT_TYPE = "contributors-please-action-updated";

export function validateDispatchEnv(env) {
  const need = name => {
    const value = String(env[name] ?? "").trim();
    if (!value) {
      throw new Error(`dispatch-downstream-suite requires ${name}`);
    }
    return value;
  };
  // GH_TOKEN must be present, but is not returned in the structured result.
  need("GH_TOKEN");
  return {
    repo: need("TARGET_REPO"),
    actionRef: need("ACTION_REF"),
    libraryRef: need("LIBRARY_REF"),
    sourceRunId: need("SOURCE_RUN_ID"),
    sourceRepo: String(env.SOURCE_REPO ?? "").trim() || undefined,
    sourceWorkflowRunId: String(env.SOURCE_WORKFLOW_RUN_ID ?? "").trim() || undefined,
    sourceSha: String(env.SOURCE_SHA ?? "").trim() || undefined,
    sourceWorkflow: String(env.SOURCE_WORKFLOW ?? "").trim() || undefined,
    suiteScope: normalizeSuiteScope(env.SUITE_SCOPE),
  };
}

// Lane selector (Task 9): "fast" for PR/ref validation, "full" for release/main.
// Defaults to "full" so omitting it preserves comprehensive validation.
export function normalizeSuiteScope(value) {
  const scope = String(value ?? "").trim().toLowerCase();
  if (scope === "fast") return "fast";
  if (scope === "full" || scope === "") return "full";
  throw new Error(`SUITE_SCOPE must be "fast" or "full", got "${value}"`);
}

export function buildReplay(validated) {
  const payload = {
    action_ref: validated.actionRef,
    library_ref: validated.libraryRef,
    source_run_id: validated.sourceRunId,
  };
  if (validated.sourceRepo) payload.source_repo = validated.sourceRepo;
  if (validated.suiteScope) payload.suite_scope = validated.suiteScope;
  if (validated.sourceWorkflowRunId) payload.source_workflow_run_id = validated.sourceWorkflowRunId;
  if (validated.sourceSha) payload.source_sha = validated.sourceSha;
  if (validated.sourceWorkflow) payload.source_workflow = validated.sourceWorkflow;

  const fields = Object.entries(payload)
    .map(([key, value]) => `  -f "client_payload[${key}]=${value}" \\`)
    .join("\n");
  const command = [
    "GH_TOKEN=${GH_TOKEN} gh api --method POST \\",
    `  repos/${validated.repo}/dispatches \\`,
    `  -f "event_type=${EVENT_TYPE}" \\`,
    fields.replace(/ \\$/, ""),
  ].join("\n");

  return { payload, command };
}

export async function dispatchWithRetry({ dispatch, attempts = 3, backoff = 10000, sleep = sleepMs, logger }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await dispatch();
      return;
    } catch (error) {
      lastError = error;
      logger(`Dispatch attempt ${attempt} failed: ${error.message}`);
      if (attempt < attempts) {
        await sleep(attempt * backoff);
      }
    }
  }
  throw lastError;
}

export async function runDispatch(env, deps) {
  const validated = validateDispatchEnv(env);
  const { dispatch, writeFile, sleep, logger } = deps;
  const replay = buildReplay(validated);

  const dispatchFn = dispatch ?? defaultDispatch(env, validated, replay.payload);
  try {
    await dispatchWithRetry({ dispatch: dispatchFn, sleep, logger });
  } catch (error) {
    logger("Dispatch failed after retries. Manual replay command:");
    logger(replay.command);
    throw error;
  }

  const replayPath = String(env.REPLAY_PATH ?? "").trim();
  if (replayPath) {
    await writeFile(replayPath, `${JSON.stringify(replay, null, 2)}\n`);
    logger(`Replay artifact written to ${replayPath}`);
  }
  return replay;
}

function defaultDispatch(env, validated, payload) {
  return async () => {
    const args = ["api", "--method", "POST", `repos/${validated.repo}/dispatches`, "-f", `event_type=${EVENT_TYPE}`];
    for (const [key, value] of Object.entries(payload)) {
      args.push("-f", `client_payload[${key}]=${value}`);
    }
    try {
      await execFileAsync("gh", args, { env: { ...process.env, GH_TOKEN: env.GH_TOKEN } });
    } catch (error) {
      const message = error?.stderr ? String(error.stderr) : error?.message;
      throw new Error(message);
    }
  };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("dispatch-downstream-suite.mjs");
if (invokedDirectly) {
  runDispatch(process.env, {
    writeFile: fsWriteFile,
    logger: line => process.stderr.write(`${line}\n`),
  }).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
