import { describe, expect, it, vi } from "vitest";

import {
  buildPrSnapshot,
  normalizeSnapshot,
  runSnapshot,
} from "../scripts/e2e-pr-snapshot.mjs";

const restPr = {
  number: 1,
  state: "open",
  title: "docs: update contributors",
  html_url: "https://github.com/smorinlabs/example/pull/1",
  head: { ref: "contributors-please/update" },
  labels: [{ name: "contributors-please: pending" }],
};
const restFiles = [{ filename: ".contributors.jsonl" }, { filename: "CONTRIBUTORS.md" }];

describe("normalizeSnapshot", () => {
  it("produces the combined snapshot shape", () => {
    const snapshot = normalizeSnapshot(restPr, restFiles);
    expect(snapshot).toEqual({
      files: [{ path: ".contributors.jsonl" }, { path: "CONTRIBUTORS.md" }],
      headRefName: "contributors-please/update",
      labels: [{ name: "contributors-please: pending" }],
      state: "open",
      title: "docs: update contributors",
      url: "https://github.com/smorinlabs/example/pull/1",
    });
  });
});

describe("buildPrSnapshot", () => {
  const silent = () => {};

  it("uses REST success without GraphQL", async () => {
    const restFetch = vi.fn(async () => normalizeSnapshot(restPr, restFiles));
    const graphqlFetch = vi.fn(async () => {
      throw new Error("graphql should not run");
    });
    const snapshot = await buildPrSnapshot({ restFetch, graphqlFetch, logger: silent });
    expect(snapshot.headRefName).toBe("contributors-please/update");
    expect(graphqlFetch).not.toHaveBeenCalled();
  });

  it("falls back to GraphQL on a rate-limit REST failure", async () => {
    const restFetch = vi.fn(async () => {
      throw Object.assign(new Error("API rate limit exceeded"), { status: 403 });
    });
    const graphqlFetch = vi.fn(async () => normalizeSnapshot(restPr, restFiles));
    const snapshot = await buildPrSnapshot({ restFetch, graphqlFetch, logger: silent });
    expect(snapshot.state).toBe("open");
    expect(graphqlFetch).toHaveBeenCalledOnce();
  });

  it("does not fall back on a fatal REST failure", async () => {
    const restFetch = vi.fn(async () => {
      throw new Error("not found");
    });
    const graphqlFetch = vi.fn(async () => normalizeSnapshot(restPr, restFiles));
    await expect(buildPrSnapshot({ restFetch, graphqlFetch, logger: silent })).rejects.toThrow(
      "not found",
    );
    expect(graphqlFetch).not.toHaveBeenCalled();
  });

  it("propagates a GraphQL fallback failure", async () => {
    const restFetch = vi.fn(async () => {
      throw Object.assign(new Error("secondary rate limit"), { status: 403 });
    });
    const graphqlFetch = vi.fn(async () => {
      throw new Error("graphql failed too");
    });
    await expect(buildPrSnapshot({ restFetch, graphqlFetch, logger: silent })).rejects.toThrow(
      "graphql failed too",
    );
  });
});

describe("runSnapshot", () => {
  const silent = () => {};

  it("writes the snapshot to OUT_PATH and returns it", async () => {
    const writes: Record<string, string> = {};
    const writeFile = vi.fn(async (path: string, content: string) => {
      writes[path] = content;
    });
    const restFetch = vi.fn(async () => normalizeSnapshot(restPr, restFiles));
    const snapshot = await runSnapshot(
      { TARGET_OWNER: "smorinlabs", TARGET_REPO: "example", PR_NUMBER: "1", OUT_PATH: "out.json" },
      { restFetch, graphqlFetch: silent, writeFile, logger: silent },
    );
    expect(writeFile).toHaveBeenCalledOnce();
    expect(JSON.parse(writes["out.json"]).headRefName).toBe("contributors-please/update");
    expect(snapshot.state).toBe("open");
  });

  it("fails fast when a required env var is missing", async () => {
    await expect(
      runSnapshot(
        { TARGET_OWNER: "smorinlabs", TARGET_REPO: "example", OUT_PATH: "out.json" },
        { restFetch: silent, graphqlFetch: silent, writeFile: silent, logger: silent },
      ),
    ).rejects.toThrow(/PR_NUMBER/);
  });
});
