import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("Downstream E2E workflow", () => {
  it("dispatches and waits via the helper scripts with the declared engine ref", async () => {
    const workflow = parse(
      await readFile(".github/workflows/downstream-e2e.yml", "utf8")
    ) as {
      jobs: {
        dispatch: {
          env: Record<string, string>;
          steps: Array<{
            name?: string;
            if?: string;
            run?: string;
            uses?: string;
            with?: Record<string, string>;
            env?: Record<string, string>;
          }>;
        };
      };
    };

    const job = workflow.jobs.dispatch;
    const steps = job.steps;
    const checkout = steps.find(step => step.uses === "actions/checkout@v6");
    const readEngineRef = steps.find(step => step.name === "Read action engine ref");
    const dispatch = steps.find(step => step.name === "Dispatch downstream suite");
    const wait = steps.find(step => step.name === "Wait for downstream suite");

    // Checkout the ref under test and read the action-declared engine ref.
    expect(checkout?.with?.ref).toBe("${{ env.ACTION_REF }}");
    expect(readEngineRef?.run).toContain(".contributors-please-engine-ref");
    expect(readEngineRef?.run).toContain("LIBRARY_REF=");

    // Dispatch + wait behavior now lives in unit-tested scripts, not inline shell.
    expect(dispatch?.run).toContain("node scripts/dispatch-downstream-suite.mjs");

    // Task 3: the wrapper must not pass unless the child suite is found and succeeds.
    expect(wait).toBeDefined();
    expect(wait?.run).toContain("node scripts/wait-downstream-suite.mjs");
    expect(wait?.if).toContain("WAIT_FOR_RESULT");

    // The scripts require these correlation/source fields from the job env.
    expect(job.env.SOURCE_RUN_ID).toBeDefined();
    expect(job.env.SOURCE_REPO).toBeDefined();
    expect(job.env.SOURCE_WORKFLOW).toBeDefined();
    expect(job.env.TARGET_REPO).toBeDefined();
    expect(job.env.TARGET_WORKFLOW).toBeDefined();
  });
});
