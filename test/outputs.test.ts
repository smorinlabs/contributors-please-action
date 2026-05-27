import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("action outputs", () => {
  it("declares every core.setOutput call in action.yml", async () => {
    const action = parse(await readFile("action.yml", "utf8")) as {
      outputs: Record<string, unknown>;
    };
    const source = await readFile("src/index.ts", "utf8");
    const emitted = [...source.matchAll(/setOutput\("([^"]+)"/g)].map(
      match => match[1]
    );

    expect(Object.keys(action.outputs).sort()).toEqual([...new Set(emitted)].sort());
  });

  it("does not rely on unevaluated GitHub context expressions in input defaults", async () => {
    const action = parse(await readFile("action.yml", "utf8")) as {
      inputs: Record<string, { default?: string }>;
    };

    for (const [name, input] of Object.entries(action.inputs)) {
      expect(input.default, `${name} default`).not.toMatch(/\$\{\{/);
    }
  });
});
