import { describe, expect, it } from "vitest";

import { classifyState, nextAction } from "../scripts/check-release-propagation.mjs";

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
