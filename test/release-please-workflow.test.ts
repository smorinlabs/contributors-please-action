import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("release-please workflow", () => {
  it("sync-dist uses the tracked engine setup helper and local sync gate", async () => {
    const workflow = parse(
      await readFile(".github/workflows/release-please.yml", "utf8")
    ) as {
      jobs: {
        "sync-dist": {
          steps: Array<{
            name?: string;
            uses?: string;
            run?: string;
            with?: Record<string, string | number>;
          }>;
        };
      };
    };

    const steps = workflow.jobs["sync-dist"].steps;
    const dependencyCheckoutStep = steps.find(
      step =>
        step.uses === "actions/checkout@v6" &&
        step.with?.repository === "smorinlabs/contributors-please"
    );
    const dependencySetup = steps.findIndex(
      step => step.run === "node scripts/setup-engine-dep.mjs"
    );
    const npmCi = steps.findIndex(step => step.run === "npm ci");
    const build = steps.findIndex(step => step.run === "npm run build");
    const localSync = steps.findIndex(step => step.run === "npm run check:sync:local");
    const commit = steps.findIndex(step => step.name === "Commit if changed");

    expect(dependencyCheckoutStep).toBeUndefined();
    expect(JSON.stringify(workflow)).not.toContain(
      "CONTRIBUTORS_PLEASE_LIBRARY_REF || 'main'"
    );
    expect(dependencySetup).toBeGreaterThanOrEqual(0);
    expect(npmCi).toBeGreaterThan(dependencySetup);
    expect(build).toBeGreaterThan(npmCi);
    expect(localSync).toBeGreaterThan(build);
    expect(commit).toBeGreaterThan(localSync);
  });
});
