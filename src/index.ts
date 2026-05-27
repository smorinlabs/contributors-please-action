import * as core from "@actions/core";
import { execFile } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  Contributors,
  GitHubClient,
  type RunResult,
  type CommitResult,
  type CheckResult,
  type OpenPullRequestResult,
} from "@smorinlabs/contributors-please";
import {
  createAppToken,
  githubNoReplyEmail,
  type AppTokenResult,
} from "./app-token.js";
import { createProxyFetch } from "./proxy.js";

const execFileAsync = promisify(execFile);

type CoreLike = Pick<
  typeof core,
  | "getInput"
  | "getBooleanInput"
  | "setSecret"
  | "setOutput"
  | "setFailed"
  | "info"
  | "warning"
>;

export interface RunActionOptions {
  core?: CoreLike;
  env?: NodeJS.ProcessEnv;
  createGitHubClient?: typeof GitHubClient.create;
  createContributors?: typeof Contributors.fromConfigFile;
  createAppToken?: typeof createAppToken;
  configureGitRemote?: (config: GitRemoteConfig) => Promise<void>;
  pushGitRef?: (config: GitPushConfig) => Promise<void>;
  fetch?: typeof fetch;
}

type ActionResult = RunResult &
  Partial<CommitResult> &
  Partial<CheckResult> &
  Partial<OpenPullRequestResult>;

interface Credentials {
  token: string;
  source: "app" | "pat";
  login: string;
  email: string;
}

interface GitRemoteConfig {
  owner: string;
  repo: string;
  serverUrl: string;
  token: string;
}

interface GitPushConfig {
  branch: string;
}

export async function runAction(options: RunActionOptions = {}): Promise<void> {
  const actionCore = options.core ?? core;
  const env = options.env ?? process.env;
  const createGitHubClient = options.createGitHubClient ?? GitHubClient.create;
  const createContributors =
    options.createContributors ?? Contributors.fromConfigFile;
  const mintAppToken = options.createAppToken ?? createAppToken;
  const configureRemote = options.configureGitRemote ?? configureGitRemote;
  const pushRef = options.pushGitRef ?? pushGitRef;
  const fetchImpl = createProxyFetch(env, options.fetch ?? fetch);

  try {
    const [owner, repo] = (env.GITHUB_REPOSITORY ?? "").split("/");
    const serverUrl =
      actionCore.getInput("github-server-url") ||
      env.GITHUB_SERVER_URL ||
      "https://github.com";
    const apiUrl =
      actionCore.getInput("github-api-url") || deriveApiUrl(serverUrl);
    const credentials = await resolveCredentials(actionCore, {
      owner,
      repo,
      apiUrl,
      serverUrl,
      createAppToken: mintAppToken,
      fetch: fetchImpl,
    });
    if (!credentials) {
      actionCore.setFailed("Provide either app-id + private-key, or pat.");
      return;
    }
    actionCore.setSecret(credentials.token);
    const dryRun = actionCore.getBooleanInput("dry-run");

    const github = await createGitHubClient({
      owner,
      repo,
      token: credentials.token,
      serverUrl,
      apiUrl,
      graphqlUrl: actionCore.getInput("github-graphql-url") || undefined,
      fetch: fetchImpl,
    });
    const contributors = await createContributors(github, {
      repoPath: process.cwd(),
      configFile: actionCore.getInput("config-file") || ".contributors.yml",
      configOverrides: actionConfigOverrides(actionCore),
      bootstrap: actionCore.getBooleanInput("bootstrap"),
      dryRun,
      committerLogin: credentials.login,
      committerEmail: credentials.email,
    });
    const result = await dispatchMode(
      actionCore,
      env,
      github,
      contributors,
      dryRun,
      {
        owner,
        repo,
        serverUrl,
        token: credentials.token,
      },
      configureRemote,
      pushRef
    );

    for (const warning of result.warnings) {
      actionCore.warning(warning);
    }

    await writeStepSummary(env, result, credentials.source, credentials.login);
    emitOutputs(
      actionCore,
      result,
      actionCore.getInput("mode") || "commit",
      credentials.source,
      credentials.login
    );
  } catch (error) {
    actionCore.setFailed(error instanceof Error ? error.message : String(error));
  }
}

function actionConfigOverrides(coreApi: CoreLike): Record<string, unknown> {
  return omitUndefined({
    output_file: optionalInput(coreApi, "output-file"),
    template_file: optionalInput(coreApi, "template-file"),
    template_placeholder: optionalInput(coreApi, "template-placeholder"),
    header: optionalInput(coreApi, "header"),
    footer: optionalInput(coreApi, "footer"),
    in_place: optionalBooleanInput(coreApi, "in-place"),
    in_place_marker_start: optionalInput(coreApi, "in-place-marker-start"),
    in_place_marker_end: optionalInput(coreApi, "in-place-marker-end"),
    entry_template: optionalInput(coreApi, "entry-template"),
    empty_text: optionalInput(coreApi, "empty-text"),
    columns_per_row: optionalNumberInput(coreApi, "columns-per-row"),
    state_file: optionalInput(coreApi, "state-file"),
    sort: optionalInput(coreApi, "sort"),
    min_contributions: optionalNumberInput(coreApi, "min-contributions"),
    ignore: optionalListInput(coreApi, "ignore"),
    unignore: optionalListInput(coreApi, "unignore"),
    pin_warn_on_stale: optionalBooleanInput(coreApi, "pin-warn-on-stale"),
  });
}

function optionalInput(coreApi: CoreLike, name: string): string | undefined {
  const value = coreApi.getInput(name);
  return value === "" ? undefined : value;
}

function optionalBooleanInput(coreApi: CoreLike, name: string): boolean | undefined {
  const raw = coreApi.getInput(name);
  return raw === "" ? undefined : coreApi.getBooleanInput(name);
}

function optionalNumberInput(coreApi: CoreLike, name: string): number | undefined {
  const value = optionalInput(coreApi, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Input "${name}" must be a number.`);
  }
  return parsed;
}

function optionalListInput(coreApi: CoreLike, name: string): string[] | undefined {
  const value = optionalInput(coreApi, name);
  if (value === undefined) {
    return undefined;
  }
  return value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function omitUndefined(
  values: Record<string, unknown | undefined>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  );
}

async function resolveCredentials(
  coreApi: CoreLike,
  options: {
    owner: string;
    repo: string;
    apiUrl: string;
    serverUrl: string;
    createAppToken: (request: {
      appId: string;
      privateKey: string;
      owner: string;
      repo: string;
      apiUrl: string;
      serverUrl: string;
      fetch?: typeof fetch;
    }) => Promise<AppTokenResult>;
    fetch: typeof fetch;
  }
): Promise<Credentials | undefined> {
  const appId = coreApi.getInput("app-id");
  const privateKey = coreApi.getInput("private-key");
  const pat = coreApi.getInput("pat");
  if (appId && privateKey) {
    const appToken = await options.createAppToken({
      appId,
      privateKey,
      owner: options.owner,
      repo: options.repo,
      apiUrl: options.apiUrl,
      serverUrl: options.serverUrl,
      fetch: options.fetch,
    });
    return {
      token: appToken.token,
      source: "app",
      login: appToken.login,
      email: appToken.email,
    };
  }
  if (pat) {
    const identity = await lookupPatIdentity(
      pat,
      options.apiUrl,
      options.serverUrl,
      options.fetch
    );
    return { token: pat, source: "pat", ...identity };
  }
  return undefined;
}

async function lookupPatIdentity(
  token: string,
  apiUrl: string,
  serverUrl: string,
  fetchImpl: typeof fetch
): Promise<{ login: string; email: string }> {
  const response = await fetchImpl(`${apiUrl.replace(/\/$/, "")}/user`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub token identity lookup failed: ${response.status}`);
  }
  const user = (await response.json()) as { login?: string; id?: number };
  if (!user.login || typeof user.id !== "number") {
    throw new Error("GitHub token identity lookup did not return a login and id.");
  }
  return {
    login: user.login,
    email: githubNoReplyEmail(user.id, user.login, serverUrl),
  };
}

async function writeStepSummary(
  env: NodeJS.ProcessEnv,
  result: ActionResult,
  tokenSource: "app" | "pat",
  committerLogin: string
): Promise<void> {
  if (!env.GITHUB_STEP_SUMMARY) {
    return;
  }

  const lines = [
    "## contributors-please",
    "",
    "| output | value |",
    "|---|---|",
    `| changed | ${result.changed} |`,
    `| contributors-count | ${result.contributorsCount} |`,
    `| token-source | ${tokenSource} |`,
    `| committer-login | ${committerLogin || ""} |`,
    `| pr-opened | ${result.prOpened ?? false} |`,
    `| pr-number | ${result.prNumber ?? ""} |`,
    `| commit-sha | ${result.commitSha ?? ""} |`,
    "",
  ];
  if (result.warnings.length) {
    lines.push("### Warnings", "");
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }
  if (committerLogin) {
    lines.push("### Notices", "");
    lines.push(
      `- Self-excluded committer \`${committerLogin}\` from contributor classification.`
    );
    lines.push("");
  }

  await appendFile(env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, "utf8");
}

function emitOutputs(
  coreApi: CoreLike,
  result: ActionResult,
  mode: string,
  tokenSource: "app" | "pat",
  committerLogin: string
): void {
  coreApi.setOutput("changed", String(result.changed));
  coreApi.setOutput("added-logins", JSON.stringify(result.addedLogins));
  coreApi.setOutput("promoted-logins", JSON.stringify(result.promotedLogins));
  coreApi.setOutput("contributors-count", String(result.contributorsCount));
  coreApi.setOutput("token-source", tokenSource);
  coreApi.setOutput("committer-login", committerLogin);
  coreApi.setOutput("contributors-json", JSON.stringify(result.contributorsJson));
  coreApi.setOutput("pr-opened", String(result.prOpened ?? false));
  coreApi.setOutput("pr-number", result.prNumber ?? "");
  coreApi.setOutput("pr-url", result.prUrl ?? "");
  coreApi.setOutput("commit-sha", mode === "commit" ? (result.commitSha ?? "") : "");
}

async function dispatchMode(
  coreApi: CoreLike,
  env: NodeJS.ProcessEnv,
  github: Awaited<ReturnType<typeof GitHubClient.create>>,
  contributors: Awaited<ReturnType<typeof Contributors.fromConfigFile>>,
  dryRun: boolean,
  remoteConfig: GitRemoteConfig,
  configureRemote: (config: GitRemoteConfig) => Promise<void>,
  pushRef: (config: GitPushConfig) => Promise<void>
): Promise<ActionResult> {
  const mode = coreApi.getInput("mode") || "commit";
  const commitMessage =
    coreApi.getInput("commit-message") || "docs: update contributors\n\n[skip ci]";
  if (mode === "pull-request") {
    if (!dryRun && env.GITHUB_ACTIONS === "true") {
      await configureRemote(remoteConfig);
    }
    const result = await contributors.openPullRequest({
      branch: "contributors-please/update",
      base: env.GITHUB_REF_NAME || "main",
      body: "Generated by contributors-please.",
      commitMessage,
      label: "contributors-please: pending",
      skipLabeling: coreApi.getBooleanInput("skip-labeling"),
      title: commitMessage.split(/\r?\n/, 1)[0],
    });
    if (dryRun && result.changed) {
      coreApi.info(
        "[dry-run] skipped commit, push, label, and pull request side effects"
      );
    }
    return result;
  }
  if (mode === "commit") {
    const result = await contributors.commit({ message: commitMessage });
    if (dryRun && result.changed) {
      coreApi.info("[dry-run] skipped commit side effect");
    }
    if (!dryRun && result.changed && env.GITHUB_ACTIONS === "true") {
      await configureRemote(remoteConfig);
      await pushRef({ branch: env.GITHUB_REF_NAME || "main" });
    }
    return result;
  }
  if (mode === "check") {
    const result = await contributors.check();
    if (result.changed) {
      if (dryRun) {
        coreApi.info(
          "[dry-run] check mode found a diff; skipped failure and PR comment"
        );
        return result;
      }
      if (result.diff) {
        coreApi.info(result.diff);
        await maybeCommentOnPullRequest(env, github, result.diff);
      }
      coreApi.setFailed(
        "contributors-please check failed: generated files are out of date"
      );
    }
    return result;
  }
  throw new Error(`Unsupported mode "${mode}"; valid values: commit, pull-request, check`);
}

async function configureGitRemote(config: GitRemoteConfig): Promise<void> {
  try {
    await execFileAsync("git", [
      "remote",
      "set-url",
      "origin",
      authenticatedRemoteUrl(config),
    ]);
  } catch {
    throw new Error("Failed to configure authenticated origin remote.");
  }
}

async function pushGitRef(config: GitPushConfig): Promise<void> {
  try {
    await execFileAsync("git", ["push", "origin", `HEAD:${config.branch}`]);
  } catch {
    throw new Error("Failed to push contributors-please commit.");
  }
}

function authenticatedRemoteUrl(config: GitRemoteConfig): string {
  const url = new URL(config.serverUrl);
  const basePath = url.pathname.replace(/\/$/, "");
  url.username = "x-access-token";
  url.password = config.token;
  url.pathname = `${basePath}/${config.owner}/${config.repo}.git`;
  return url.toString();
}

async function maybeCommentOnPullRequest(
  env: NodeJS.ProcessEnv,
  github: Awaited<ReturnType<typeof GitHubClient.create>>,
  diff: string
): Promise<void> {
  if (env.GITHUB_EVENT_NAME !== "pull_request" || !env.GITHUB_EVENT_PATH) {
    return;
  }
  if (!("upsertIssueComment" in github)) {
    return;
  }
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8")) as {
    pull_request?: { number?: number };
  };
  const number = event.pull_request?.number;
  if (!number) {
    return;
  }
  await github.upsertIssueComment(
    number,
    [
      "<!-- contributors-please:check-comment -->",
      "contributors-please found stale generated contributor files.",
      "",
      "```diff",
      diff.trimEnd(),
      "```",
    ].join("\n")
  );
}

function deriveApiUrl(serverUrl: string): string {
  const normalized = serverUrl.replace(/\/$/, "");
  return normalized === "https://github.com"
    ? "https://api.github.com"
    : `${normalized}/api/v3`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAction();
}
