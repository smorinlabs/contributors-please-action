import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { diagnose } from "../scripts/check-engine-sync.mjs";

describe("engine sync diagnosis", () => {
  const inSync = {
    embedded: "1.2.0",
    lockfile: "1.2.0",
    localEngine: "1.2.0",
    trackedRef: "v1.2.0",
    pin: "v1.2.0",
    latestRelease: "v1.2.0",
  };

  it("passes when every version reference agrees", () => {
    const result = diagnose(inSync);

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails with a rebuild remedy when the embedded lib lags the lockfile", () => {
    const result = diagnose({ ...inSync, embedded: "1.1.1" });

    expect(result.ok).toBe(false);
    const failure = result.failures.find(f => f.id === "embedded-vs-lockfile");
    expect(failure).toBeDefined();
    expect(failure!.remedy).toContain("npm install");
    expect(failure!.remedy).toContain("npm run build");
  });

  it("fails in local mode when the embedded lib lags the sibling engine checkout", () => {
    const result = diagnose({
      embedded: "1.1.1",
      lockfile: "1.1.1",
      localEngine: "1.2.0",
      trackedRef: "v1.1.1",
    }, { mode: "local" });

    expect(result.ok).toBe(false);
    const failure = result.failures.find(f => f.id === "embedded-vs-local-engine");
    expect(failure).toBeDefined();
    expect(failure!.remedy).toContain("npm run build");
  });

  it("fails with an override remedy when the compatibility pin lags the latest release", () => {
    const result = diagnose({ ...inSync, pin: "v1.0.2" });

    expect(result.ok).toBe(false);
    const failure = result.failures.find(f => f.id === "pin-vs-latest-release");
    expect(failure).toBeDefined();
    expect(failure!.remedy).toContain("CONTRIBUTORS_PLEASE_LIBRARY_REF");
    expect(failure!.remedy).toContain("v1.2.0");
    expect(failure!.remedy).not.toContain("gh api");
  });

  it("fails with rebuild-and-commit instructions when the engine releases past the embedded lib", () => {
    const result = diagnose({
      ...inSync,
      embedded: "1.1.1",
      lockfile: "1.1.1",
      localEngine: undefined,
      pin: "v1.1.1",
      latestRelease: "v1.2.0",
    });

    expect(result.ok).toBe(false);
    const failure = result.failures.find(f => f.id === "embedded-vs-latest-release");
    expect(failure).toBeDefined();
    expect(failure!.remedy).toContain("v1.2.0");
    expect(failure!.remedy).toContain("git add dist package-lock.json");
  });

  it("skips network checks when pin and latest release are unavailable", () => {
    const result = diagnose({
      embedded: "1.2.0",
      lockfile: "1.2.0",
      localEngine: "1.2.0",
      trackedRef: "v1.2.0",
    }, { mode: "local" });

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("notes a floating pin instead of failing when the pin is a branch name", () => {
    const result = diagnose({ ...inSync, pin: "main" });

    expect(result.ok).toBe(true);
    expect(result.notes.join("\n")).toContain("main");
  });

  it("passes local mode when embedded, lockfile, tracked ref, and local engine agree", () => {
    const result = diagnose({
      embedded: "1.3.0",
      lockfile: "1.3.0",
      trackedRef: "v1.3.0",
      localEngine: "1.3.0",
    }, { mode: "local" });

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails local mode when the tracked engine ref differs from the lockfile", () => {
    const result = diagnose({
      embedded: "1.3.0",
      lockfile: "1.3.0",
      trackedRef: "v1.2.0",
      localEngine: "1.3.0",
    }, { mode: "local" });

    expect(result.ok).toBe(false);
    expect(result.failures.map(f => f.id)).toContain("tracked-ref-vs-lockfile");
  });

  it("does not fail local mode solely because the latest release is newer", () => {
    const result = diagnose({
      embedded: "1.3.0",
      lockfile: "1.3.0",
      trackedRef: "v1.3.0",
      localEngine: "1.3.0",
      latestRelease: "v1.4.0",
    }, { mode: "local" });

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails trusted mode when the latest release is newer than the tracked ref", () => {
    const result = diagnose({
      embedded: "1.3.0",
      lockfile: "1.3.0",
      trackedRef: "v1.3.0",
      localEngine: "1.3.0",
      latestRelease: "v1.4.0",
    }, { mode: "trusted" });

    expect(result.ok).toBe(false);
    expect(result.failures.map(f => f.id)).toContain(
      "tracked-ref-vs-latest-release"
    );
  });
});

describe("engine sync workflow", () => {
  it("exposes local, trusted, and release sync scripts", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts["check:sync:local"]).toBe(
      "node scripts/check-engine-sync.mjs --local"
    );
    expect(pkg.scripts["check:sync:trusted"]).toBe(
      "node scripts/check-engine-sync.mjs --trusted"
    );
    expect(pkg.scripts["check:sync:release"]).toBe(
      "node scripts/check-engine-sync.mjs --release"
    );
  });

  it("runs the sync script on PRs, on a schedule, and on engine release dispatch", async () => {
    const workflow = parse(
      await readFile(".github/workflows/engine-sync.yml", "utf8")
    ) as {
      on: {
        pull_request?: unknown;
        schedule?: Array<{ cron: string }>;
        repository_dispatch?: { types: string[] };
        workflow_dispatch?: unknown;
      };
      jobs: Record<string, { steps: Array<{ run?: string; env?: Record<string, string> }> }>;
    };

    expect(workflow.on.pull_request).toBeDefined();
    expect(workflow.on.schedule?.[0]?.cron).toBeDefined();
    expect(workflow.on.repository_dispatch?.types).toContain(
      "contributors-please-released"
    );
    expect(workflow.on.workflow_dispatch).toBeDefined();

    const steps = Object.values(workflow.jobs).flatMap(job => job.steps);
    const syncStep = steps.find(step =>
      step.run?.includes("npm run check:sync:trusted")
    );
    expect(syncStep).toBeDefined();
    expect(syncStep!.env).toHaveProperty("GITHUB_TOKEN");
    expect(syncStep!.env).not.toHaveProperty("CONTRIBUTORS_PLEASE_LIBRARY_REF");
  });
});

describe("pre-commit configuration", () => {
  it("runs the offline sync check before commits", async () => {
    const config = parse(await readFile(".pre-commit-config.yaml", "utf8")) as {
      repos: Array<{
        hooks: Array<{ id: string; entry?: string; args?: string[] }>;
      }>;
    };

    const hooks = config.repos.flatMap(repo => repo.hooks);
    const syncHook = hooks.find(hook => hook.id === "engine-sync-local");
    expect(syncHook).toBeDefined();
    expect(`${syncHook!.entry} ${(syncHook!.args ?? []).join(" ")}`).toContain(
      "--local"
    );
  });
});
