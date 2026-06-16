import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("release workflow", () => {
  it("verifies the bundled action before v tag releases", async () => {
    const workflow = parse(
      await readFile(".github/workflows/release.yml", "utf8")
    ) as {
      on: { push: { tags: string[] } };
      jobs: {
        verify: {
          permissions?: Record<string, string>;
          steps: Array<{
            name?: string;
            uses?: string;
            run?: string;
            with?: Record<string, string | number>;
          }>;
        };
      };
    };

    expect(workflow.on.push.tags).toContain("v*.*.*");
    expect(workflow.on.push.tags).not.toContain("v*");
    expect(workflow.jobs.verify.permissions).toMatchObject({
      contents: "write",
    });

    const steps = workflow.jobs.verify.steps;
    const dependencyCheckoutStep = steps.find(
      step =>
        step.uses === "actions/checkout@v6" &&
        step.with?.repository === "smorinlabs/contributors-please"
    );
    const dependencySetup = steps.findIndex(
      step => step.run === "node scripts/setup-engine-dep.mjs"
    );
    const setupNode = steps.find(step => step.with?.["node-version"]);
    const versionCheck = steps.findIndex(
      step =>
        step.run?.includes("PACKAGE_VERSION") &&
        step.run.includes("GITHUB_REF_NAME")
    );
    const npmCi = steps.findIndex(step => step.run === "npm ci");
    const npmTest = steps.findIndex(step => step.run === "npm test");
    const releaseSync = steps.findIndex(step => step.run === "npm run check:sync:release");
    const build = steps.findIndex(step => step.run === "npm run build");
    const distDiff = steps.findIndex(step => step.run === "git diff --exit-code -- dist");
    const majorTag = steps.findIndex(step =>
      step.run?.includes("MAJOR_TAG") &&
      step.run.includes("git rev-list -n 1") &&
      step.run.includes("git tag -f") &&
      step.run.includes("git push origin")
    );

    expect(setupNode?.with).toMatchObject({ "node-version": 24 });
    expect(dependencyCheckoutStep).toBeUndefined();
    expect(dependencySetup).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(workflow)).not.toContain(
      "CONTRIBUTORS_PLEASE_LIBRARY_REF || 'v1.0.0'"
    );
    expect(versionCheck).toBeGreaterThan(dependencySetup);
    expect(npmCi).toBeGreaterThan(dependencySetup);
    expect(npmCi).toBeGreaterThan(versionCheck);
    expect(releaseSync).toBeGreaterThan(npmCi);
    expect(npmTest).toBeGreaterThan(releaseSync);
    expect(build).toBeGreaterThan(npmTest);
    expect(distDiff).toBeGreaterThan(build);
    expect(majorTag).toBeGreaterThan(distDiff);
  });
});
