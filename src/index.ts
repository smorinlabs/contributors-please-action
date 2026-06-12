import * as core from "@actions/core";
import { execFile } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import type {
  RunResult,
  CommitResult,
  CheckResult,
  OpenPullRequestResult,
} from "contributors-please";
import {
  createAppToken,
  githubNoReplyEmail,
  type AppTokenResult,
} from "./app-token.js";
import { createProxyFetch } from "./proxy.js";

const execFileAsync = promisify(execFile);
type ContributorsModule = typeof import("contributors-please");
type CreateGitHubClient = ContributorsModule["GitHubClient"]["create"];
type CreateContributors = ContributorsModule["Contributors"]["fromConfigFile"];
type GitHubClientInstance = Awaited<ReturnType<CreateGitHubClient>>;
type ContributorsInstance = Awaited<ReturnType<CreateContributors>>;
let contributorsModulePromise: Promise<ContributorsModule> | undefined;

function loadContributorsModule(): Promise<ContributorsModule> {
  const dynamicImport = new Function(
    "specifier",
    "return import(specifier)"
  ) as (specifier: string) => Promise<ContributorsModule>;
  const libraryFile = ["contributors-please-lib", "js"].join(".");
  contributorsModulePromise ??= dynamicImport(
    new URL(`./${libraryFile}`, import.meta.url).href
  );
  return contributorsModulePromise;
}

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
  createGitHubClient?: CreateGitHubClient;
  createContributors?: CreateContributors;
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
  const mintAppToken = options.createAppToken ?? createAppToken;
  const configureRemote = options.configureGitRemote ?? configureGitRemote;
  const pushRef = options.pushGitRef ?? pushGitRef;
  const fetchImpl = createProxyFetch(env, options.fetch ?? fetch);

  try {
    const [owner, repo] = (
      actionCore.getInput("repository") ||
      env.GITHUB_REPOSITORY ||
      ""
    ).split("/");
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
    const dryRun = optionalBooleanInput(actionCore, "dry-run") ?? false;
    const contributorsModule =
      options.createGitHubClient && options.createContributors
        ? undefined
        : await loadContributorsModule();
    const createGitHubClient =
      options.createGitHubClient ?? contributorsModule!.GitHubClient.create;
    const createContributors =
      options.createContributors ?? contributorsModule!.Contributors.fromConfigFile;

    const github = await createGitHubClient({
      owner,
      repo,
      token: credentials.token,
      serverUrl,
      apiUrl,
      graphqlUrl: actionCore.getInput("github-graphql-url") || undefined,
      fetch: fetchImpl,
    });
    const configFile =
      actionCore.getInput("config-file") || ".contributors.yml";
    const configOverrides = actionConfigOverrides(actionCore);
    const yamlRecord = await readYamlConfigRecord(
      resolvePath(process.cwd(), configFile)
    );
    assertNoConflicts(configOverrides, yamlRecord, configFile);

    const contributors = await createContributors(github, {
      repoPath: process.cwd(),
      configFile,
      configOverrides,
      bootstrap: optionalBooleanInput(actionCore, "bootstrap") ?? false,
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

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const CONFIG_FILE_ONLY_KEYS = new Set([
  "in_place",
  "in_place_marker_start",
  "in_place_marker_end",
  "columns_per_row",
  "entry_template",
  "header",
  "footer",
  "template_file",
  "template_placeholder",
  "empty_text",
  "sort",
  "min_contributions",
  "pin_warn_on_stale",
  "ignore",
  "unignore",
  "classification",
  "identity_map",
]);

export function assertNoConflicts(
  overrides: Record<string, unknown>,
  yamlRecord: Record<string, unknown>,
  configFilePath: string
): void {
  const conflicts: Array<{ key: string; workflow: unknown; yaml: unknown }> = [];
  for (const key of Object.keys(overrides)) {
    if (CONFIG_FILE_ONLY_KEYS.has(key) && key in yamlRecord) {
      conflicts.push({ key, workflow: overrides[key], yaml: yamlRecord[key] });
    }
  }
  if (conflicts.length === 0) return;

  const lines = [
    `contributors-please-action: conflicting configuration for ${conflicts.length === 1 ? "key" : "keys"} ` +
      `${conflicts.map(c => `"${c.key}"`).join(", ")}.`,
    "",
    `The following ${conflicts.length === 1 ? "key is" : "keys are"} set in both the workflow inputs and ${configFilePath}:`,
  ];
  for (const { key, workflow, yaml } of conflicts) {
    lines.push(
      `  - ${key}:`,
      `      workflow input: ${formatValue(workflow)}`,
      `      ${configFilePath}: ${formatValue(yaml)}`
    );
  }
  lines.push(
    "",
    `These keys must be set in exactly one place. ${configFilePath} is the source of truth for project ` +
      "configuration (formatting, classification, identity_map, ignore, etc.); workflow inputs are reserved " +
      "for operational concerns (paths, mode, dry-run, credentials).",
    "",
    "Remove the value from one source. See the README's \"Configuration source policy\" section for details."
  );
  throw new ConfigError(lines.join("\n"));
}

function formatValue(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function readYamlConfigRecord(
  configFile: string
): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(configFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new ConfigError(
      `Failed to parse ${configFile}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (parsed === null || parsed === undefined) {
    return {};
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError(
      `Expected ${configFile} to contain a YAML mapping at the top level.`
    );
  }
  return parsed as Record<string, unknown>;
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

// Mirrors DEFAULT_COMMIT_MESSAGE exported by contributors-please; a static
// value import would make ncc bundle the library into dist/index.js instead
// of loading the copied dist/contributors-please-lib.js at runtime.
const DEFAULT_COMMIT_MESSAGE = "docs: update contributors";

function optionalSkipCiInput(coreApi: CoreLike): boolean | undefined {
  const raw = coreApi.getInput("skip-ci");
  if (raw === "") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error(
    `Input "skip-ci" must be "true", "false", or unset; got "${raw}".`
  );
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
  github: GitHubClientInstance,
  contributors: ContributorsInstance,
  dryRun: boolean,
  remoteConfig: GitRemoteConfig,
  configureRemote: (config: GitRemoteConfig) => Promise<void>,
  pushRef: (config: GitPushConfig) => Promise<void>
): Promise<ActionResult> {
  const mode = coreApi.getInput("mode") || "commit";
  const rawCommitMessage = coreApi.getInput("commit-message");
  const commitMessage =
    rawCommitMessage === "" || rawCommitMessage === DEFAULT_COMMIT_MESSAGE
      ? undefined
      : rawCommitMessage;
  const skipCi = optionalSkipCiInput(coreApi);
  const branchRef = coreApi.getInput("branch") || env.GITHUB_REF_NAME || "main";
  if (mode === "pull-request") {
    if (!dryRun && env.GITHUB_ACTIONS === "true") {
      await configureRemote(remoteConfig);
    }
    const result = await contributors.openPullRequest({
      branch: "contributors-please/update",
      base: branchRef,
      body: "Generated by contributors-please.",
      ...(commitMessage !== undefined && { commitMessage }),
      ...(skipCi !== undefined && { skipCi }),
      label: "contributors-please: pending",
      skipLabeling: optionalBooleanInput(coreApi, "skip-labeling") ?? false,
      title: (commitMessage ?? DEFAULT_COMMIT_MESSAGE).split(/\r?\n/, 1)[0],
    });
    if (dryRun && result.changed) {
      coreApi.info(
        "[dry-run] skipped commit, push, label, and pull request side effects"
      );
    }
    return result;
  }
  if (mode === "commit") {
    const result = await contributors.commit({
      ...(commitMessage !== undefined && { message: commitMessage }),
      ...(skipCi !== undefined && { skipCi }),
    });
    if (dryRun && result.changed) {
      coreApi.info("[dry-run] skipped commit side effect");
    }
    if (!dryRun && result.changed && env.GITHUB_ACTIONS === "true") {
      await configureRemote(remoteConfig);
      await pushRef({ branch: branchRef });
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
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    const detail = stderr || (error instanceof Error ? error.message : String(error));
    throw new Error(`Failed to push contributors-please commit: ${detail}`);
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
  github: GitHubClientInstance,
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
