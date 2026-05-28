import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  main: string;
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
}

describe("package metadata", () => {
  it("is configured as the private action wrapper package", async () => {
    const pkg = JSON.parse(
      await readFile("package.json", "utf8")
    ) as PackageJson;

    expect(pkg.name).toBe("contributors-please-action");
    expect(pkg.version).toBe("1.0.1");
    expect(pkg.private).toBe(true);
    expect(pkg.main).toBe("dist/index.js");
    expect(pkg.dependencies).toMatchObject({
      "contributors-please": "file:../contributors-please",
    });
    expect(pkg.dependencies).not.toHaveProperty("@smorinlabs/contributors-please");
  });

  it("keeps the committed action bundle in the local check gate", async () => {
    const pkg = JSON.parse(
      await readFile("package.json", "utf8")
    ) as PackageJson;

    expect(pkg.scripts.check).toContain("npm run build");
    expect(pkg.scripts.check).toContain("git diff --exit-code -- dist");
  });
});
