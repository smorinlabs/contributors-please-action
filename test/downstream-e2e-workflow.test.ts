import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("Downstream E2E workflow", () => {
  it("dispatches the action's declared engine ref to contributors-please-test", async () => {
    const workflow = parse(
      await readFile(".github/workflows/downstream-e2e.yml", "utf8")
    ) as {
      jobs: {
        dispatch: {
          steps: Array<{
            name?: string;
            run?: string;
            uses?: string;
            with?: Record<string, string>;
          }>;
        };
      };
    };

    const steps = workflow.jobs.dispatch.steps;
    const checkout = steps.find(step => step.uses === "actions/checkout@v6");
    const readEngineRef = steps.find(
      step => step.name === "Read action engine ref"
    );
    const dispatch = steps.find(step => step.name === "Dispatch downstream suite");

    expect(checkout?.with?.ref).toBe("${{ env.ACTION_REF }}");
    expect(readEngineRef?.run).toContain(".contributors-please-engine-ref");
    expect(readEngineRef?.run).toContain("LIBRARY_REF=");
    expect(dispatch?.run).toContain("client_payload[library_ref]=${LIBRARY_REF}");
    expect(dispatch?.run).toContain("- library ref: ${LIBRARY_REF}");
  });
});
