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
            run?: string;
          }>;
        };
      };
    };

    const steps = workflow.jobs.check.steps;
    const dependencyCheckout = steps.findIndex(step =>
      step.run?.includes("smorinlabs/contributors-please")
    );
    const npmCi = steps.findIndex(step => step.run === "npm ci");

    expect(dependencyCheckout).toBeGreaterThanOrEqual(0);
    expect(npmCi).toBeGreaterThan(dependencyCheckout);
  });
});
