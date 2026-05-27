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
    const dependencyCheckout = steps.indexOf(dependencyCheckoutStep ?? {});
    const dependencyLink = steps.findIndex(
      step =>
        step.run?.includes(".deps/contributors-please") &&
        step.run.includes("../contributors-please")
    );
    const setupNode = steps.find(step => step.with?.["node-version"]);
    const versionCheck = steps.findIndex(
      step =>
        step.run?.includes("PACKAGE_VERSION") &&
        step.run.includes("GITHUB_REF_NAME")
    );
    const npmCi = steps.findIndex(step => step.run === "npm ci");
    const npmTest = steps.findIndex(step => step.run === "npm test");
    const build = steps.findIndex(step => step.run === "npm run build");
    const distDiff = steps.findIndex(step => step.run === "git diff --exit-code -- dist");
    const majorTag = steps.findIndex(step =>
      step.run?.includes("MAJOR_TAG") &&
      step.run.includes("git rev-list -n 1") &&
      step.run.includes("git tag -f") &&
      step.run.includes("git push origin")
    );

    expect(setupNode?.with).toMatchObject({ "node-version": 24 });
    expect(dependencyCheckout).toBeGreaterThanOrEqual(0);
    expect(dependencyCheckoutStep?.with).toMatchObject({
      ref: "${{ github.ref_name }}",
      path: ".deps/contributors-please",
      token: "${{ secrets.CONTRIBUTORS_PLEASE_LIBRARY_TOKEN || github.token }}",
    });
    expect(dependencyLink).toBeGreaterThan(dependencyCheckout);
    expect(versionCheck).toBeGreaterThan(dependencyCheckout);
    expect(npmCi).toBeGreaterThan(dependencyLink);
    expect(npmCi).toBeGreaterThan(versionCheck);
    expect(npmTest).toBeGreaterThan(npmCi);
    expect(build).toBeGreaterThan(npmTest);
    expect(distDiff).toBeGreaterThan(build);
    expect(majorTag).toBeGreaterThan(distDiff);
  });
});
