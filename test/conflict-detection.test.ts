import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAction } from "../src/index";

function fakeCore(inputs: Record<string, string>) {
  const outputs: Record<string, unknown> = {};
  const failures: string[] = [];
  const secrets: string[] = [];
  return {
    outputs,
    failures,
    secrets,
    core: {
      getInput: (name: string) => inputs[name] ?? "",
      getBooleanInput: (name: string) =>
        (inputs[name] ?? "false") === "true",
      setSecret: (value: string) => {
        secrets.push(value);
      },
      setOutput: (name: string, value: unknown) => {
        outputs[name] = value;
      },
      setFailed: (message: string) => {
        failures.push(message);
      },
      info: vi.fn(),
      warning: vi.fn(),
    },
  };
}

async function withTempDir(
  body: (dir: string) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "contributors-action-conflict-"));
  const previousCwd = process.cwd();
  process.chdir(dir);
  try {
    await body(dir);
  } finally {
    process.chdir(previousCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

function makeCommitStub() {
  return vi.fn().mockResolvedValue({
    changed: false,
    addedLogins: [],
    promotedLogins: [],
    contributorsCount: 0,
    contributorsJson: [],
    proposedStateFile: "",
    proposedOutputFile: "",
    warnings: [],
    commitSha: "",
  });
}

describe("conflict detection guard", () => {
  it("does not error when the yaml config file is absent", async () => {
    await withTempDir(async () => {
      const { core, failures } = fakeCore({
        pat: "pat-token",
        mode: "commit",
        "output-file": "TEAM.md",
        "in-place": "true",
      });
      const commit = makeCommitStub();
      const createContributors = vi
        .fn()
        .mockResolvedValue({ commit });

      await runAction({
        core,
        env: { GITHUB_REPOSITORY: "smorinlabs/example" },
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({ login: "pat-user", id: 98765 }),
            { status: 200 }
          )
        ),
        createGitHubClient: vi
          .fn()
          .mockResolvedValue({ serverUrl: "https://github.com" }),
        createContributors,
      });

      expect(failures).toEqual([]);
      expect(commit).toHaveBeenCalled();
    });
  });

  it("does not error when yaml keys do not overlap with workflow inputs", async () => {
    await withTempDir(async dir => {
      await writeFile(
        join(dir, ".contributors.yml"),
        ["classifier: path", "header: 'Project header'"].join("\n")
      );
      const { core, failures } = fakeCore({
        pat: "pat-token",
        mode: "commit",
        "output-file": "TEAM.md",
        "state-file": ".team-contributors.jsonl",
      });
      const commit = makeCommitStub();
      const createContributors = vi
        .fn()
        .mockResolvedValue({ commit });

      await runAction({
        core,
        env: { GITHUB_REPOSITORY: "smorinlabs/example" },
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({ login: "pat-user", id: 98765 }),
            { status: 200 }
          )
        ),
        createGitHubClient: vi
          .fn()
          .mockResolvedValue({ serverUrl: "https://github.com" }),
        createContributors,
      });

      expect(failures).toEqual([]);
      expect(commit).toHaveBeenCalled();
    });
  });

  it("errors when yaml and workflow both set a config-file-only key with different values", async () => {
    await withTempDir(async dir => {
      await writeFile(
        join(dir, ".contributors.yml"),
        "in_place: true\n"
      );
      const { core, failures } = fakeCore({
        pat: "pat-token",
        mode: "commit",
        "in-place": "false",
      });
      const createContributors = vi.fn();

      await runAction({
        core,
        env: { GITHUB_REPOSITORY: "smorinlabs/example" },
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({ login: "pat-user", id: 98765 }),
            { status: 200 }
          )
        ),
        createGitHubClient: vi
          .fn()
          .mockResolvedValue({ serverUrl: "https://github.com" }),
        createContributors,
      });

      expect(createContributors).not.toHaveBeenCalled();
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain("in_place");
      expect(failures[0]).toContain("workflow input");
      expect(failures[0]).toContain(".contributors.yml");
    });
  });

  it("errors when yaml and workflow both set the same config-file-only key with matching values", async () => {
    await withTempDir(async dir => {
      await writeFile(
        join(dir, ".contributors.yml"),
        "in_place: true\n"
      );
      const { core, failures } = fakeCore({
        pat: "pat-token",
        mode: "commit",
        "in-place": "true",
      });
      const createContributors = vi.fn();

      await runAction({
        core,
        env: { GITHUB_REPOSITORY: "smorinlabs/example" },
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({ login: "pat-user", id: 98765 }),
            { status: 200 }
          )
        ),
        createGitHubClient: vi
          .fn()
          .mockResolvedValue({ serverUrl: "https://github.com" }),
        createContributors,
      });

      expect(createContributors).not.toHaveBeenCalled();
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain("in_place");
      expect(failures[0]).toContain(".contributors.yml");
    });
  });
});
