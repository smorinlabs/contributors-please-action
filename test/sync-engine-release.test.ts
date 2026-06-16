import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  isPrereleaseRef,
  plannedUpdateFiles,
  prTitle,
  resolveEngineRef,
  syncBranchName,
  validateEngineRef,
} from "../scripts/sync-engine-release.mjs";

describe("engine release sync automation", () => {
  it("uses a stable branch name for each engine release", () => {
    expect(syncBranchName("v1.4.0")).toBe("sync/contributors-please-v1.4.0");
  });

  it("rejects prerelease refs unless prereleases are explicitly allowed", () => {
    expect(() => validateEngineRef("v1.4.0-rc.1")).toThrow(/prerelease/i);
    expect(validateEngineRef("v1.4.0-rc.1", { allowPrerelease: true })).toBe(
      "v1.4.0-rc.1"
    );
    expect(isPrereleaseRef("v1.4.0-rc.1")).toBe(true);
    expect(isPrereleaseRef("v1.4.0")).toBe(false);
  });

  it("generates a stable pull request title", () => {
    expect(prTitle("v1.4.0")).toBe("chore: sync contributors-please v1.4.0");
  });

  it("plans the files that must change during an engine sync", () => {
    expect(plannedUpdateFiles()).toEqual([
      ".contributors-please-engine-ref",
      "package-lock.json",
      "dist/contributors-please-lib.js",
    ]);
  });

  it("resolves the engine ref from the publish workflow dispatch version payload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sync-engine-release-"));
    const eventPath = join(dir, "event.json");

    try {
      await writeFile(
        eventPath,
        JSON.stringify({ client_payload: { version: "v1.4.0" } })
      );

      expect(resolveEngineRef({ GITHUB_EVENT_PATH: eventPath })).toBe("v1.4.0");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("defines manual and engine release dispatch triggers", async () => {
    const workflow = parse(
      await readFile(".github/workflows/sync-engine-release.yml", "utf8")
    ) as {
      on: {
        repository_dispatch?: { types: string[] };
        workflow_dispatch?: { inputs: Record<string, unknown> };
      };
      jobs: Record<
        string,
        { steps: Array<{ env?: Record<string, string>; if?: string; run?: string }> }
      >;
    };

    expect(workflow.on.repository_dispatch?.types).toContain(
      "contributors-please-released"
    );
    expect(workflow.on.workflow_dispatch?.inputs).toHaveProperty("engine_ref");
    const steps = Object.values(workflow.jobs).flatMap(job => job.steps);
    const prepareSync = steps.find(
      step => step.run === "node scripts/sync-engine-release.mjs"
    );
    expect(prepareSync).toBeDefined();
    expect(prepareSync?.env?.ENGINE_REF).toContain(
      "github.event.client_payload.version"
    );
    const trustedSync = steps.find(step => step.run === "npm run check:sync:trusted");
    const prereleaseSync = steps.find(step => step.run === "npm run check:sync:local");
    expect(trustedSync?.if).toContain("prerelease != 'true'");
    expect(prereleaseSync?.if).toContain("prerelease == 'true'");
  });
});
