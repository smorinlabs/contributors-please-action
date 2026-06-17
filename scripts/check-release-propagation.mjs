// Read-only release-propagation state checker. Explains where a release currently
// stands across npm, the engine tag/release, the action sync PR/main, and downstream
// runs, so expected intermediate "reds" can be distinguished from real failures.
//
// Usage: node scripts/check-release-propagation.mjs --version v1.3.1 [--json]
// SEC3: read-only; never prints tokens.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const STATES = [
  "no-tag",
  "tagged-not-published",
  "published-no-github-release",
  "github-release-no-action-dispatch",
  "action-sync-pr-open",
  "action-main-stale",
  "downstream-running",
  "complete",
];

// Pure classification. `actionMainAtLeastRequested` encodes DOC3: completeness uses
// "action main >= requested engine ref", not strict equality, so an older
// fully-propagated release is not reported incomplete after main advances.
export function classifyState(evidence) {
  if (!evidence.tagExists) return "no-tag";
  if (!evidence.npmPublished) return "tagged-not-published";
  if (!evidence.githubReleaseExists) return "published-no-github-release";
  if (!evidence.actionDispatched) return "github-release-no-action-dispatch";
  if (!evidence.actionMainAtLeastRequested) {
    return evidence.actionSyncPrOpen ? "action-sync-pr-open" : "action-main-stale";
  }
  if (evidence.downstreamRunning || !evidence.downstreamComplete) return "downstream-running";
  return "complete";
}

export function nextAction(state) {
  switch (state) {
    case "no-tag":
      return "Tag the engine release and let release-please publish.";
    case "tagged-not-published":
      return "Wait for / re-run the engine publish workflow (npm publish).";
    case "published-no-github-release":
      return "Create the GitHub Release for the tag.";
    case "github-release-no-action-dispatch":
      return "Re-run the engine->action dispatch (see replay command).";
    case "action-sync-pr-open":
      return "Review and merge the open action sync PR.";
    case "action-main-stale":
      return "Open/re-run the action sync workflow for this version.";
    case "downstream-running":
      return "Wait for the downstream wrapper and child suites to conclude.";
    case "complete":
      return "Propagation complete; no action needed.";
    default:
      return "Unknown state.";
  }
}

export async function gatherEvidence(version, deps) {
  // deps lets tests inject; defaults shell out read-only.
  const d = deps ?? defaultProbes(version);
  const [tagExists, npmPublished, githubReleaseExists, action, downstream] = await Promise.all([
    d.tagExists(),
    d.npmPublished(),
    d.githubReleaseExists(),
    d.actionState(),
    d.downstreamState(),
  ]);
  return {
    tagExists,
    npmPublished,
    githubReleaseExists,
    actionDispatched: action.dispatched,
    actionSyncPrOpen: action.syncPrOpen,
    actionMainAtLeastRequested: action.mainAtLeastRequested,
    downstreamRunning: downstream.running,
    downstreamComplete: downstream.complete,
  };
}

export async function checkReleasePropagation(version, deps) {
  const evidence = await gatherEvidence(version, deps);
  const state = classifyState(evidence);
  return { version, state, evidence, nextAction: nextAction(state) };
}

function defaultProbes(version) {
  const bare = version.replace(/^v/, "");
  return {
    tagExists: async () => Boolean(await tryGh(["api", `repos/smorinlabs/contributors-please/git/refs/tags/${version}`])),
    npmPublished: async () => {
      const out = await tryExec("npm", ["view", `contributors-please@${bare}`, "version"]);
      return Boolean(out && out.trim() === bare);
    },
    githubReleaseExists: async () =>
      Boolean(await tryGh(["api", `repos/smorinlabs/contributors-please/releases/tags/${version}`])),
    // TODO(stub): npm/tag/release are really probed above; the action-sync and
    // downstream probes are not yet wired, so a live run cannot currently report
    // `action-main-stale`, `action-sync-pr-open`, or `downstream-running`. Wire these
    // to `gh` (action main .contributors-please-engine-ref vs requested; open sync PR;
    // downstream wrapper/child run status) before relying on those states live.
    // classifyState (the decision logic) is fully unit-tested with injected evidence.
    actionState: async () => ({ dispatched: true, syncPrOpen: false, mainAtLeastRequested: true }),
    downstreamState: async () => ({ running: false, complete: true }),
  };
}

async function tryGh(args) {
  return tryExec("gh", args);
}

async function tryExec(cmd, args) {
  try {
    const { stdout } = await execFileAsync(cmd, args, { maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch {
    return "";
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("check-release-propagation.mjs");
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const version = valueAfter(argv, "--version");
  const asJson = argv.includes("--json");
  if (!version) {
    process.stderr.write("Usage: check-release-propagation.mjs --version <vX.Y.Z> [--json]\n");
    process.exit(2);
  }
  checkReleasePropagation(version)
    .then(result => {
      if (asJson) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`version:    ${result.version}\nstate:      ${result.state}\nnextAction: ${result.nextAction}\n`);
      }
    })
    .catch(error => {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    });
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}
