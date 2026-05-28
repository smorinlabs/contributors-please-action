import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("committed action bundle", () => {
  it("starts and reaches action input validation", async () => {
    let stdout = "";
    let stderr = "";
    let exitCode: number | undefined;

    try {
      await execFileAsync(process.execPath, ["dist/index.js"], {
        env: {
          ...process.env,
          GITHUB_REPOSITORY: "smorinlabs/example",
        },
      });
    } catch (error) {
      const result = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      exitCode = result.code;
      stdout = result.stdout ?? "";
      stderr = result.stderr ?? "";
    }

    const output = `${stdout}${stderr}`;
    expect(exitCode).toBe(1);
    expect(output).toContain("Provide either app-id + private-key, or pat.");
    expect(output).not.toContain("Cannot read properties of undefined");
  });

  it("does not rewrite the runtime library import as an ncc asset query", async () => {
    const bundle = await readFile("dist/index.js", "utf8");
    expect(bundle).not.toContain("?./contributors-please-lib.js");
    expect(bundle).toContain('["contributors-please-lib", "js"].join(".")');
  });
});
