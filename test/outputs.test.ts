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

  it("leaves config-composable rendering inputs with an empty default", async () => {
    // These inputs are forwarded to the core via the optional* helpers
    // (src/index.ts), which fall back to the config file only when the input is
    // unset (getInput returns ""). A non-empty action.yml default makes getInput
    // always return a value, silently overriding the config file's rendering
    // settings — the cause of contributors PRs replacing the whole file instead
    // of editing between the in-place markers.
    const action = parse(await readFile("action.yml", "utf8")) as {
      inputs: Record<string, { default?: string }>;
    };
    const composable = [
      "in-place",
      "in-place-marker-start",
      "in-place-marker-end",
      "columns-per-row",
      "entry-template",
    ];

    for (const name of composable) {
      expect(action.inputs[name]?.default ?? "", `${name} default`).toBe("");
    }
  });
});
