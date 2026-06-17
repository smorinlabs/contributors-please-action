import { describe, expect, it, vi } from "vitest";

import { findChildRun, waitForSuite } from "../scripts/wait-downstream-suite.mjs";

const runs = (sourceRunId: string) => [
  { databaseId: 1, displayTitle: `downstream suite source-run ${sourceRunId}`, status: "completed", conclusion: "success", url: "u1" },
  { databaseId: 2, displayTitle: "downstream suite source-run 99999", status: "completed", conclusion: "failure", url: "u2" },
];
const silent = () => {};

describe("findChildRun", () => {
  it("matches the run carrying the exact source-run marker", () => {
    const run = findChildRun(runs("12345"), "12345");
    expect(run?.databaseId).toBe(1);
  });

  it("does not match a run carrying a different source marker (RC4 contract)", () => {
    const onlyWrong = [
      { databaseId: 2, displayTitle: "downstream suite source-run 99999", status: "completed", conclusion: "success", url: "u2" },
    ];
    expect(findChildRun(onlyWrong, "12345")).toBeUndefined();
  });

  it("does not match on a partial/substring source id", () => {
    const partial = [
      { databaseId: 3, displayTitle: "downstream suite source-run 123456", status: "completed", conclusion: "success", url: "u3" },
    ];
    expect(findChildRun(partial, "12345")).toBeUndefined();
  });
});

describe("waitForSuite", () => {
  it("returns 0 when the matching child run succeeds", async () => {
    const listRuns = vi.fn(async () => runs("12345"));
    const code = await waitForSuite(
      { SOURCE_RUN_ID: "12345", TARGET_REPO: "r", TARGET_WORKFLOW: "w.yml" },
      { listRuns, watchRun: async () => 0, sleep: silent, logger: silent },
    );
    expect(code).toBe(0);
  });

  it("returns non-zero when the matching child run fails", async () => {
    const failing = [
      { databaseId: 1, displayTitle: "downstream suite source-run 12345", status: "completed", conclusion: "failure", url: "u1" },
    ];
    const listRuns = vi.fn(async () => failing);
    const code = await waitForSuite(
      { SOURCE_RUN_ID: "12345", TARGET_REPO: "r", TARGET_WORKFLOW: "w.yml" },
      { listRuns, watchRun: async () => 1, sleep: silent, logger: silent },
    );
    expect(code).not.toBe(0);
  });

  it("returns non-zero when no matching child run is found after polling", async () => {
    const listRuns = vi.fn(async () => runs("99999"));
    const code = await waitForSuite(
      { SOURCE_RUN_ID: "12345", TARGET_REPO: "r", TARGET_WORKFLOW: "w.yml", MAX_DISCOVERY_ATTEMPTS: "2" },
      { listRuns, watchRun: async () => 0, sleep: silent, logger: silent },
    );
    expect(code).not.toBe(0);
    expect(listRuns).toHaveBeenCalledTimes(2);
  });
});
