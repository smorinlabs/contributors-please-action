import { describe, expect, it, vi } from "vitest";

import { findChildRun, githubGet, waitForSuite } from "../scripts/wait-downstream-suite.mjs";

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
      { listRuns, get: async () => ({ id: 1, status: "completed", conclusion: "success" }), sleep: silent, logger: silent },
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
      { listRuns, get: async () => ({ id: 1, status: "completed", conclusion: "failure" }), sleep: silent, logger: silent },
    );
    expect(code).not.toBe(0);
  });

  it("returns non-zero when no matching child run is found after polling", async () => {
    const listRuns = vi.fn(async () => runs("99999"));
    const code = await waitForSuite(
      { SOURCE_RUN_ID: "12345", TARGET_REPO: "r", TARGET_WORKFLOW: "w.yml", MAX_DISCOVERY_ATTEMPTS: "2" },
      { listRuns, get: async () => ({ id: 1, status: "completed", conclusion: "success" }), sleep: silent, logger: silent },
    );
    expect(code).not.toBe(0);
    expect(listRuns).toHaveBeenCalledTimes(2);
  });
});

const env = { SOURCE_RUN_ID: "12345", TARGET_REPO: "o/r", TARGET_WORKFLOW: "suite.yml" };
const listRuns = async () => runs("12345");
function clock() {
  let time = 0;
  return { now: () => time, sleep: vi.fn(async (ms: number) => { time += ms; }) };
}

describe("REST completion polling", () => {
  it("discovers the exact marker and polls only that run through completion", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ workflow_runs: [
        { id: 99, display_title: "source-run 123456", html_url: "wrong" },
        { id: 1, display_title: "source-run 12345 action-ref abc", html_url: "right" },
      ] })
      .mockResolvedValueOnce({ id: 1, status: "queued", conclusion: null })
      .mockResolvedValueOnce({ id: 1, status: "in_progress", conclusion: null })
      .mockResolvedValueOnce({ id: 1, status: "completed", conclusion: "success" });
    const timer = clock();
    expect(await waitForSuite(env, { get, ...timer })).toBe(0);
    expect(get.mock.calls.map(call => call[0])).toEqual([
      "repos/o/r/actions/workflows/suite.yml/runs?event=repository_dispatch&per_page=50",
      ...Array(3).fill("repos/o/r/actions/runs/1"),
    ]);
    expect(timer.sleep.mock.calls).toEqual([[15000], [15000]]);
  });

  it.each(["failure", "cancelled", "timed_out", "skipped", "neutral", "action_required", null])(
    "fails completed runs with conclusion %s", async conclusion => {
      expect(await waitForSuite(env, {
        listRuns, get: async () => ({ id: 1, status: "completed", conclusion }),
      })).toBe(1);
    },
  );

  it("bounds discovery and completion with the same deadline", async () => {
    const timer = clock();
    const discover = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(runs("12345"));
    const get = vi.fn(async () => ({ id: 1, status: "in_progress" }));
    await expect(waitForSuite({ ...env, WAIT_TIMEOUT_MS: "20000" }, {
      listRuns: discover, get, ...timer,
    })).rejects.toThrow("Timed out");
    expect(get).toHaveBeenCalledWith("repos/o/r/actions/runs/1", 5000);
    expect(timer.now()).toBe(20000);
  });

  it("passes an integer subprocess timeout when the clock has fractional milliseconds", async () => {
    let time = 0;
    const get = vi.fn(async () => ({ id: 1, status: "completed", conclusion: "success" }));
    expect(await waitForSuite({ ...env, WAIT_TIMEOUT_MS: "1000" }, {
      listRuns, get, now: () => { time += 0.1; return time; },
    })).toBe(0);
    const timeout = get.mock.calls[0][1];
    expect(Number.isInteger(timeout)).toBe(true);
    expect(timeout).toBeLessThan(1000);
  });

  it("does not accept success arriving after the deadline", async () => {
    const timer = clock();
    await expect(waitForSuite({ ...env, WAIT_TIMEOUT_MS: "10" }, {
      listRuns, ...timer, get: async () => {
        await timer.sleep(11);
        return { id: 1, status: "completed", conclusion: "success" };
      },
    })).rejects.toThrow("Timed out");
  });

  it("retries a transient request at most three times, then fails", async () => {
    const get = vi.fn(async () => { throw Object.assign(new Error("HTTP 503"), { retryable: true }); });
    const timer = clock();
    await expect(waitForSuite(env, { listRuns, get, ...timer })).rejects.toThrow("HTTP 503");
    expect(get).toHaveBeenCalledTimes(3);
    expect(timer.sleep).toHaveBeenCalledTimes(2);
  });

  it("recovers from a transient error without reporting premature success", async () => {
    const get = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("HTTP 503"), { retryable: true }))
      .mockResolvedValueOnce({ id: 1, status: "completed", conclusion: "success" });
    expect(await waitForSuite(env, { listRuns, get, ...clock() })).toBe(0);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404])("fails HTTP %s without retrying", async status => {
    const get = vi.fn(async () => { throw new Error(`HTTP ${status}`); });
    await expect(waitForSuite(env, { listRuns, get, ...clock() })).rejects.toThrow(`HTTP ${status}`);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each(["0", "-1", "NaN", "1.5", "Infinity"])("rejects invalid bounds %s", async value => {
    for (const name of ["MAX_DISCOVERY_ATTEMPTS", "WAIT_TIMEOUT_MS"]) {
      await expect(waitForSuite({ ...env, [name]: value })).rejects.toThrow(`${name} must be a positive integer`);
    }
  });

  it("rejects a mismatched run response", async () => {
    await expect(waitForSuite(env, {
      listRuns, get: async () => ({ id: 2, status: "completed", conclusion: "success" }),
    })).rejects.toThrow("Invalid downstream");
  });

  it("rejects marker prefixes and suffixes that are not exact tokens", () => {
    for (const displayTitle of ["other-source-run 12345", "source-run 12345abc"]) {
      expect(findChildRun([{ displayTitle }], "12345")).toBeUndefined();
    }
  });
});

describe("GitHub REST transport", () => {
  it("uses a bounded GET without invoking Checks or gh run watch", async () => {
    const exec = vi.fn(async () => ({ stdout: '{"id":1}' }));
    expect(await githubGet("repos/o/r/actions/runs/1", 1234, exec)).toEqual({ id: 1 });
    expect(exec).toHaveBeenCalledWith("gh", ["api", "--method", "GET", "repos/o/r/actions/runs/1"], { timeout: 1234, maxBuffer: 8 * 1024 * 1024 });
  });

  it.each([[401, false], [403, false], [404, false], [429, true], [503, true]])(
    "classifies HTTP %s safely", async (status, retryable) => {
      const exec = async () => { throw { stderr: `private diagnostic (HTTP ${status})` }; };
      await expect(githubGet("p", 1000, exec)).rejects.toMatchObject({
        message: `GitHub API returned HTTP ${status}`, retryable,
      });
    },
  );

  it("allows bounded retry of a subprocess timeout", async () => {
    await expect(githubGet("p", 1000, async () => { throw { killed: true }; }))
      .rejects.toMatchObject({ retryable: true });
  });

  it("rejects malformed JSON", async () => {
    await expect(githubGet("p", 1000, async () => ({ stdout: "invalid" }))).rejects.toThrow();
  });
});
