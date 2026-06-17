import { describe, expect, it } from "vitest";

import {
  classifyDownstreamRun,
  classifyState,
  compareVersions,
  nextAction,
} from "../scripts/check-release-propagation.mjs";

// Evidence shape consumed by classifyState. Defaults represent a fully complete
// release; each test flips the minimal fields for its state.
const complete = {
  tagExists: true,
  npmPublished: true,
  githubReleaseExists: true,
  actionDispatched: true,
  actionSyncPrOpen: false,
  actionMainAtLeastRequested: true,
  downstreamRunning: false,
  downstreamComplete: true,
};

describe("classifyState", () => {
  it("no-tag when the engine tag is absent", () => {
    expect(classifyState({ ...complete, tagExists: false })).toBe("no-tag");
  });
  it("tagged-not-published when the tag exists but npm does not", () => {
    expect(classifyState({ ...complete, npmPublished: false })).toBe("tagged-not-published");
  });
  it("published-no-github-release when npm exists but the release does not", () => {
    expect(classifyState({ ...complete, githubReleaseExists: false })).toBe(
      "published-no-github-release",
    );
  });
  it("github-release-no-action-dispatch when no sync branch/PR/run exists", () => {
    expect(classifyState({ ...complete, actionDispatched: false })).toBe(
      "github-release-no-action-dispatch",
    );
  });
  it("action-sync-pr-open when a sync PR is open and main is still behind", () => {
    expect(
      classifyState({ ...complete, actionSyncPrOpen: true, actionMainAtLeastRequested: false }),
    ).toBe("action-sync-pr-open");
  });
  it("action-main-stale when main is behind and no sync PR is open", () => {
    expect(
      classifyState({ ...complete, actionSyncPrOpen: false, actionMainAtLeastRequested: false }),
    ).toBe("action-main-stale");
  });
  it("downstream-running when main is current and downstream is in progress", () => {
    expect(classifyState({ ...complete, downstreamRunning: true, downstreamComplete: false })).toBe(
      "downstream-running",
    );
  });
  it("complete when everything matches", () => {
    expect(classifyState(complete)).toBe("complete");
  });

  it("DOC3: complete uses action main >= requested, not strict equality", () => {
    // action main is at a newer engine ref than the requested (old) version: still complete.
    expect(classifyState({ ...complete, actionMainAtLeastRequested: true })).toBe("complete");
  });
});

describe("nextAction", () => {
  it("gives an actionable next step per state", () => {
    expect(nextAction("no-tag")).toMatch(/tag/i);
    expect(nextAction("complete")).toMatch(/complete|none/i);
  });
});

describe("compareVersions", () => {
  it("orders release tags numerically and ignores the v prefix", () => {
    expect(compareVersions("v1.4.0", "v1.3.1")).toBe(1);
    expect(compareVersions("1.3.1", "v1.4.0")).toBe(-1);
    expect(compareVersions("v1.4.0", "1.4.0")).toBe(0);
  });
  it("does not order by string (1.10.0 > 1.9.0)", () => {
    expect(compareVersions("v1.10.0", "v1.9.0")).toBe(1);
  });
  it("treats action main >= requested as satisfied (DOC3)", () => {
    // main at v1.4.0, requesting the older v1.3.1 -> still propagated.
    expect(compareVersions("v1.4.0", "v1.3.1") >= 0).toBe(true);
  });
});

describe("classifyDownstreamRun", () => {
  it("reports running when the latest run is not completed", () => {
    expect(classifyDownstreamRun("in_progress ")).toEqual({ running: true, complete: false });
    expect(classifyDownstreamRun("queued ")).toEqual({ running: true, complete: false });
  });
  it("reports complete only on a completed+success run", () => {
    expect(classifyDownstreamRun("completed success")).toEqual({ running: false, complete: true });
    expect(classifyDownstreamRun("completed failure")).toEqual({ running: false, complete: false });
  });
  it("reports neither when there is no run", () => {
    expect(classifyDownstreamRun("")).toEqual({ running: false, complete: false });
  });
});
