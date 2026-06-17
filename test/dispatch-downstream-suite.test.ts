import { describe, expect, it, vi } from "vitest";

import {
  buildReplay,
  dispatchWithRetry,
  normalizeSuiteScope,
  runDispatch,
  validateDispatchEnv,
} from "../scripts/dispatch-downstream-suite.mjs";

const fullEnv = {
  GH_TOKEN: "t",
  TARGET_REPO: "smorinlabs/contributors-please-test",
  TARGET_WORKFLOW: "action-downstream-suite.yml",
  ACTION_REF: "main",
  LIBRARY_REF: "v1.3.1",
  SOURCE_RUN_ID: "12345",
};
const silent = () => {};

describe("validateDispatchEnv", () => {
  it("fails before dispatch when GH_TOKEN is missing", () => {
    expect(() => validateDispatchEnv({ ...fullEnv, GH_TOKEN: "" })).toThrow(/GH_TOKEN/);
  });
  it("fails before dispatch when ACTION_REF is missing", () => {
    expect(() => validateDispatchEnv({ ...fullEnv, ACTION_REF: "" })).toThrow(/ACTION_REF/);
  });
  it("fails before dispatch when LIBRARY_REF is missing", () => {
    expect(() => validateDispatchEnv({ ...fullEnv, LIBRARY_REF: "" })).toThrow(/LIBRARY_REF/);
  });
  it("accepts a complete env", () => {
    expect(validateDispatchEnv(fullEnv).actionRef).toBe("main");
  });
});

describe("normalizeSuiteScope", () => {
  it("defaults to full when unset", () => {
    expect(normalizeSuiteScope(undefined)).toBe("full");
    expect(normalizeSuiteScope("")).toBe("full");
  });
  it("accepts fast and full (case-insensitive)", () => {
    expect(normalizeSuiteScope("fast")).toBe("fast");
    expect(normalizeSuiteScope("FULL")).toBe("full");
  });
  it("rejects an unknown scope", () => {
    expect(() => normalizeSuiteScope("medium")).toThrow(/fast.*full/);
  });
});

describe("buildReplay", () => {
  it("includes action_ref, library_ref, and source_run_id", () => {
    const replay = buildReplay(validateDispatchEnv(fullEnv));
    expect(replay.payload.action_ref).toBe("main");
    expect(replay.payload.library_ref).toBe("v1.3.1");
    expect(replay.payload.source_run_id).toBe("12345");
    expect(replay.command).toContain("client_payload");
  });
});

describe("dispatchWithRetry", () => {
  it("succeeds on attempt 2 after one failure", async () => {
    let calls = 0;
    const dispatch = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error("transient");
    });
    await dispatchWithRetry({ dispatch, attempts: 3, sleep: silent, logger: silent });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const dispatch = vi.fn(async () => {
      throw new Error("always fails");
    });
    await expect(
      dispatchWithRetry({ dispatch, attempts: 3, sleep: silent, logger: silent }),
    ).rejects.toThrow("always fails");
    expect(dispatch).toHaveBeenCalledTimes(3);
  });
});

describe("runDispatch", () => {
  it("writes a replay artifact and dispatches", async () => {
    const writes: Record<string, string> = {};
    const dispatch = vi.fn(async () => {});
    const writeFile = vi.fn(async (path: string, content: string) => {
      writes[path] = content;
    });
    await runDispatch(
      { ...fullEnv, REPLAY_PATH: "replay.json" },
      { dispatch, writeFile, sleep: silent, logger: silent },
    );
    expect(dispatch).toHaveBeenCalledOnce();
    expect(JSON.parse(writes["replay.json"]).payload.library_ref).toBe("v1.3.1");
  });

  it("does not dispatch when env is invalid", async () => {
    const dispatch = vi.fn(async () => {});
    await expect(
      runDispatch(
        { ...fullEnv, LIBRARY_REF: "" },
        { dispatch, writeFile: silent, sleep: silent, logger: silent },
      ),
    ).rejects.toThrow(/LIBRARY_REF/);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
