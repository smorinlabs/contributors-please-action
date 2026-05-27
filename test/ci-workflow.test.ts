import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("CI workflow", () => {
  it("materializes the local contributors-please dependency before npm ci", async () => {
    const workflow = parse(
      await readFile(".github/workflows/ci.yml", "utf8")
    ) as {
      jobs: {
        check: {
          steps: Array<{
            name?: string;
            uses?: string;
            run?: string;
            with?: Record<string, string | number>;
          }>;
        };
      };
    };

    const steps = workflow.jobs.check.steps;
    const dependencyCheckoutStep = steps.find(
      step =>
        step.uses === "actions/checkout@v6" &&
        step.with?.repository === "smorinlabs/contributors-please"
    );
    const dependencyCheckout = steps.indexOf(dependencyCheckoutStep ?? {});
    const npmCi = steps.findIndex(step => step.run === "npm ci");

    expect(dependencyCheckout).toBeGreaterThanOrEqual(0);
    expect(dependencyCheckoutStep?.with).toMatchObject({
      ref: "contributors-please-impl",
      path: "../contributors-please",
      token: "${{ secrets.CONTRIBUTORS_PLEASE_LIBRARY_TOKEN || github.token }}",
    });
    expect(npmCi).toBeGreaterThan(dependencyCheckout);
  });
});
