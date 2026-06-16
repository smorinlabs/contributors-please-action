import { describe, expect, it } from "vitest";

import { gitCloneArgs } from "../scripts/setup-engine-dep.mjs";

describe("engine dependency setup", () => {
  it("can clone the engine from an explicit local repository URL", () => {
    expect(gitCloneArgs("/tmp/contributors-please.git", "v1.3.1", ".deps/engine")).toEqual([
      "clone",
      "--branch",
      "v1.3.1",
      "/tmp/contributors-please.git",
      ".deps/engine",
    ]);
  });

  it("keeps the public GitHub repository as the default clone source", () => {
    expect(gitCloneArgs(undefined, "v1.3.1", ".deps/engine")).toEqual([
      "clone",
      "--depth",
      "1",
      "--branch",
      "v1.3.1",
      "https://github.com/smorinlabs/contributors-please.git",
      ".deps/engine",
    ]);
  });
});
