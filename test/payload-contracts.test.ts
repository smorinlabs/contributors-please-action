import { describe, expect, it } from "vitest";

import {
  resolveEngineReleaseVersion,
  validateDownstreamPayload,
} from "../scripts/payload-contracts.mjs";

describe("resolveEngineReleaseVersion", () => {
  it("accepts canonical version", () => {
    expect(resolveEngineReleaseVersion({ version: "v1.3.1" })).toBe("v1.3.1");
  });
  it("accepts the engine_ref alias", () => {
    expect(resolveEngineReleaseVersion({ engine_ref: "v1.3.1" })).toBe("v1.3.1");
  });
  it("accepts the tag_name alias", () => {
    expect(resolveEngineReleaseVersion({ tag_name: "v1.3.1" })).toBe("v1.3.1");
  });
  it("accepts the release.tag_name alias", () => {
    expect(resolveEngineReleaseVersion({ release: { tag_name: "v1.3.1" } })).toBe("v1.3.1");
  });
  it("prefers canonical version over aliases", () => {
    expect(resolveEngineReleaseVersion({ version: "v2", tag_name: "v1" })).toBe("v2");
  });
  it("fails with a precise message when version is missing", () => {
    expect(() => resolveEngineReleaseVersion({})).toThrow("engine release payload requires version");
  });
});

describe("validateDownstreamPayload", () => {
  it("accepts a complete downstream payload", () => {
    expect(
      validateDownstreamPayload({ action_ref: "main", library_ref: "v1.3.1", source_run_id: "1" }),
    ).toEqual({ action_ref: "main", library_ref: "v1.3.1", source_run_id: "1" });
  });
  it("fails when action_ref is missing", () => {
    expect(() => validateDownstreamPayload({ library_ref: "v1.3.1", source_run_id: "1" })).toThrow(
      "downstream payload requires action_ref",
    );
  });
  it("fails when library_ref is missing", () => {
    expect(() => validateDownstreamPayload({ action_ref: "main", source_run_id: "1" })).toThrow(
      "downstream payload requires library_ref",
    );
  });
  it("fails when source_run_id is missing", () => {
    expect(() => validateDownstreamPayload({ action_ref: "main", library_ref: "v1.3.1" })).toThrow(
      "downstream payload requires source_run_id",
    );
  });
});
