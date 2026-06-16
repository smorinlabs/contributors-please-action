#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_REPO = "smorinlabs/contributors-please";
const REF_FILE = ".contributors-please-engine-ref";

function readEngineRef(root) {
  const explicitRef = process.env.CONTRIBUTORS_PLEASE_ENGINE_REF;
  if (explicitRef) return explicitRef.trim();

  const refPath = resolve(root, REF_FILE);
  const ref = readFileSync(refPath, "utf8").trim();
  if (!ref) throw new Error(`${REF_FILE} is empty`);
  return ref;
}

export function gitCloneArgs(repoOrUrl, ref, depPath) {
  const source = repoOrUrl
    ? repoOrUrl
    : `https://github.com/${DEFAULT_REPO}.git`;
  const isGitHubSlug = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source);
  const cloneSource = isGitHubSlug ? `https://github.com/${source}.git` : source;
  const depthArgs = cloneSource.startsWith("https://github.com/") ? ["--depth", "1"] : [];

  return [
    "clone",
    ...depthArgs,
    "--branch",
    ref,
    cloneSource,
    depPath,
  ];
}

function runGitClone(repo, ref, depPath) {
  const token =
    process.env.CONTRIBUTORS_PLEASE_LIBRARY_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN;
  const args = gitCloneArgs(repo, ref, depPath);

  if (token) {
    const auth = Buffer.from(`x-access-token:${token}`).toString("base64");
    execFileSync(
      "git",
      ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`, ...args],
      { stdio: "inherit" }
    );
    return;
  }

  execFileSync("git", args, { stdio: "inherit" });
}

export function setupEngineDependency(root = process.cwd()) {
  const ref = readEngineRef(root);
  const repo =
    process.env.CONTRIBUTORS_PLEASE_LIBRARY_URL ||
    process.env.CONTRIBUTORS_PLEASE_LIBRARY_REPO ||
    DEFAULT_REPO;
  const depPath = resolve(root, ".deps/contributors-please");
  const linkPath = resolve(root, "../contributors-please");

  mkdirSync(dirname(depPath), { recursive: true });
  rmSync(depPath, { recursive: true, force: true });
  runGitClone(repo, ref, depPath);

  rmSync(linkPath, { recursive: true, force: true });
  symlinkSync(depPath, linkPath, "dir");

  execFileSync("npm", ["ci", "--prefix", depPath], { stdio: "inherit" });
  console.log(`contributors-please engine ref: ${ref}`);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  setupEngineDependency();
}
