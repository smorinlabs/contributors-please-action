// REST-first snapshot of a pull request for the e2e "Verify pull request and label"
// step, with a bounded GraphQL fallback on rate-limit-shaped REST failures.
//
// Env: TARGET_OWNER, TARGET_REPO, PR_NUMBER, OUT_PATH.
// SEC3: never prints env, argv, or tokens; only the API-path label and snapshot path.

import { writeFile as fsWriteFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { withRateLimitFallback } from "./github-api.mjs";

const execFileAsync = promisify(execFile);

export function normalizeSnapshot(pr, files) {
  return {
    files: files.map(file => ({ path: file.filename ?? file.path })),
    headRefName: pr.head?.ref ?? pr.headRefName,
    labels: (pr.labels ?? []).map(label => ({ name: label.name })),
    state: String(pr.state ?? "").toLowerCase(),
    title: pr.title,
    url: pr.html_url ?? pr.url,
  };
}

export async function buildPrSnapshot({ restFetch, graphqlFetch, logger }) {
  return withRateLimitFallback(restFetch, graphqlFetch, "PR snapshot", logger);
}

export async function runSnapshot(env, deps) {
  const owner = required(env, "TARGET_OWNER");
  const repo = required(env, "TARGET_REPO");
  const prNumber = required(env, "PR_NUMBER");
  const outPath = required(env, "OUT_PATH");
  const { restFetch, graphqlFetch, writeFile, logger } = deps;

  const snapshot = await buildPrSnapshot({
    restFetch: restFetch ?? restFetcher({ owner, repo, prNumber }),
    graphqlFetch: graphqlFetch ?? graphqlFetcher({ owner, repo, prNumber }),
    logger,
  });
  await writeFile(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  logger(`PR snapshot written to ${outPath}`);
  return snapshot;
}

function required(env, name) {
  const value = env[name];
  if (!value) {
    throw new Error(`e2e-pr-snapshot requires ${name}`);
  }
  return value;
}

function restFetcher({ owner, repo, prNumber }) {
  return async () => {
    const pr = await ghJson(["api", `repos/${owner}/${repo}/pulls/${prNumber}`]);
    const files = await ghJson([
      "api",
      "--paginate",
      `repos/${owner}/${repo}/pulls/${prNumber}/files`,
    ]);
    return normalizeSnapshot(pr, files);
  };
}

function graphqlFetcher({ owner, repo, prNumber }) {
  return async () => {
    const query = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){title state url headRefName labels(first:50){nodes{name}} files(first:100){nodes{path}}}}}`;
    const data = await ghJson([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `repo=${repo}`,
      "-F",
      `number=${prNumber}`,
    ]);
    const node = data.data.repository.pullRequest;
    return {
      files: node.files.nodes.map(file => ({ path: file.path })),
      headRefName: node.headRefName,
      labels: node.labels.nodes.map(label => ({ name: label.name })),
      state: String(node.state).toLowerCase(),
      title: node.title,
      url: node.url,
    };
  };
}

async function ghJson(args) {
  try {
    const { stdout } = await execFileAsync("gh", args, { maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (error) {
    const status = statusFromGh(error);
    const message = error?.stderr ? String(error.stderr) : error?.message;
    throw Object.assign(new Error(message), { status });
  }
}

function statusFromGh(error) {
  const text = error?.stderr ? String(error.stderr) : "";
  const match = text.match(/HTTP (\d{3})/);
  return match ? Number(match[1]) : undefined;
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("e2e-pr-snapshot.mjs");
if (invokedDirectly) {
  runSnapshot(process.env, {
    writeFile: fsWriteFile,
    logger: line => process.stderr.write(`${line}\n`),
  }).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
