import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("E2E workflow", () => {
  it("runs on schedule, manual dispatch, and release tags", async () => {
    const workflow = parse(
      await readFile(".github/workflows/e2e.yml", "utf8")
    ) as {
      on: {
        workflow_dispatch: unknown;
        schedule: Array<{ cron: string }>;
        push: { tags: string[] };
      };
    };

    expect(workflow.on.workflow_dispatch).toBeDefined();
    expect(workflow.on.schedule).toContainEqual({ cron: "17 8 * * *" });
    expect(workflow.on.push.tags).toContain("v*.*.*");
  });

  it("exercises commit mode with a real push before pull-request mode", async () => {
    const workflow = parse(
      await readFile(".github/workflows/e2e.yml", "utf8")
    ) as {
      jobs: {
        "scratch-repo": {
          steps: Array<{ name?: string; with?: Record<string, string> }>;
        };
      };
    };
    const steps = workflow.jobs["scratch-repo"].steps;
    const stepNames = steps.map(step => step.name);
    const commitMode = steps.find(
      step => step.name === "Exercise commit mode (App or PAT)"
    );

    // App-preferred with automatic PAT fallback (configured with either).
    // The action's `app-id` input accepts a GitHub App Client ID
    // (e.g. Iv23li...) as well as a numeric App ID; this workflow feeds
    // CONTRIBUTORS_PLEASE_CLIENT_ID through it.
    expect(commitMode?.with).toMatchObject({
      mode: "commit",
      "app-id": "${{ secrets.CONTRIBUTORS_PLEASE_CLIENT_ID }}",
      pat: "${{ env.HAS_APP != 'true' && secrets.CONTRIBUTORS_PLEASE_PAT || '' }}",
    });
    expect(commitMode?.with).not.toHaveProperty("dry-run");

    const verifyCommit = stepNames.indexOf("Verify commit mode output");
    const preparePullRequest = stepNames.indexOf(
      "Prepare pull-request synthetic contributor commit"
    );
    const pullRequest = stepNames.indexOf("Exercise pull-request mode with App token");

    expect(verifyCommit).toBeGreaterThan(-1);
    expect(preparePullRequest).toBeGreaterThan(verifyCommit);
    expect(pullRequest).toBeGreaterThan(preparePullRequest);
  });

  it("covers label re-application on an existing contributors PR", async () => {
    const workflow = parse(
      await readFile(".github/workflows/e2e.yml", "utf8")
    ) as {
      jobs: {
        "scratch-repo": {
          steps: Array<{ name?: string }>;
        };
      };
    };
    const stepNames = workflow.jobs["scratch-repo"].steps.map(step => step.name);

    const removeLabel = stepNames.indexOf("Remove pending label before re-apply");
    const secondCommit = stepNames.indexOf(
      "Prepare second synthetic contributor commit"
    );
    const reapplyLabel = stepNames.indexOf(
      "Re-apply pull request label with App token"
    );
    const verifyLabel = stepNames.indexOf("Verify label was re-applied");

    expect(removeLabel).toBeGreaterThan(-1);
    expect(secondCommit).toBeGreaterThan(removeLabel);
    expect(reapplyLabel).toBeGreaterThan(secondCommit);
    expect(verifyLabel).toBeGreaterThan(reapplyLabel);
  });

  it("uses REST-first pull request verification with bounded GraphQL fallback", async () => {
    const workflow = parse(
      await readFile(".github/workflows/e2e.yml", "utf8")
    ) as {
      jobs: {
        "scratch-repo": {
          steps: Array<{ name?: string; run?: string }>;
        };
      };
    };
    const steps = workflow.jobs["scratch-repo"].steps;
    const verifyPullRequest = steps.find(
      step => step.name === "Verify pull request and label"
    );
    const removeLabel = steps.find(
      step => step.name === "Remove pending label before re-apply"
    );
    const verifyReapplied = steps.find(
      step => step.name === "Verify label was re-applied"
    );

    expect(verifyPullRequest?.run).toContain(
      'gh api --method GET "repos/${TARGET_OWNER}/${TARGET_REPO}/pulls/${PR_NUMBER}"'
    );
    expect(verifyPullRequest?.run).toContain(
      'gh api --method GET "repos/${TARGET_OWNER}/${TARGET_REPO}/issues/${PR_NUMBER}"'
    );
    expect(verifyPullRequest?.run).toContain(
      'gh api --method GET "repos/${TARGET_OWNER}/${TARGET_REPO}/pulls/${PR_NUMBER}/files"'
    );
    expect(verifyPullRequest?.run).toContain("Pull request verification API path: REST");
    expect(verifyPullRequest?.run).toContain("GraphQL fallback");
    expect(verifyPullRequest?.run).toContain("rate limit");
    expect(verifyPullRequest?.run).toContain('gh pr view "$PR_NUMBER"');

    expect(removeLabel?.run).toContain(
      'gh api --method DELETE "repos/${TARGET_OWNER}/${TARGET_REPO}/issues/${PR_NUMBER}/labels/contributors-please:%20pending"'
    );
    expect(removeLabel?.run).toContain("Label removal API path: REST");
    expect(removeLabel?.run).toContain("GraphQL fallback");
    expect(removeLabel?.run).toContain('gh pr edit "$PR_NUMBER"');

    expect(verifyReapplied?.run).toContain(
      'gh api --method GET "repos/${TARGET_OWNER}/${TARGET_REPO}/issues/${PR_NUMBER}"'
    );
    expect(verifyReapplied?.run).toContain("Label verification API path: REST");
    expect(verifyReapplied?.run).toContain("GraphQL fallback");
    expect(verifyReapplied?.run).toContain('gh pr view "$PR_NUMBER"');
  });

  it("defines a gated GitHub Enterprise smoke job", async () => {
    const workflow = parse(
      await readFile(".github/workflows/e2e.yml", "utf8")
    ) as {
      jobs: {
        "github-enterprise-smoke": {
          if?: string;
          "runs-on": string[];
          env: Record<string, string>;
          steps: Array<{ name?: string; uses?: string; with?: Record<string, string> }>;
        };
      };
    };

    const job = workflow.jobs["github-enterprise-smoke"];
    expect(job.if).toContain("vars.GHE_SERVER_URL");
    expect(job["runs-on"]).toEqual(
      expect.arrayContaining(["self-hosted", "contributors-please-ghe"])
    );
    expect(job.env).toMatchObject({
      GHE_SERVER_URL: "${{ vars.GHE_SERVER_URL }}",
      GHE_TARGET_OWNER: "${{ vars.GHE_TARGET_OWNER }}",
      GHE_TARGET_REPO: "${{ vars.GHE_TARGET_REPO }}",
    });

    const actionStep = job.steps.find(
      step => step.name === "Exercise GitHub Enterprise smoke"
    );
    expect(actionStep?.uses).toBe("./.github/actions/contributors-please-action");
    expect(actionStep?.with).toMatchObject({
      pat: "${{ secrets.GHE_CONTRIBUTORS_PLEASE_PAT }}",
      "github-server-url": "${{ vars.GHE_SERVER_URL }}",
      mode: "check",
      "dry-run": "true",
    });
  });

  it("documents secrets on the action repository that runs the E2E workflow", async () => {
    const runbook = await readFile("docs/RUNBOOK.md", "utf8");

    expect(runbook).toMatch(
      /These secrets are configured in the `smorinlabs\/contributors-please-action`\s+repository/
    );
    expect(runbook).toContain("CONTRIBUTORS_PLEASE_LIBRARY_TOKEN");
    expect(runbook).toContain(".contributors-please-engine-ref");
    expect(runbook).toContain("sync-engine-release.yml");
    expect(runbook).not.toContain("vars.CONTRIBUTORS_PLEASE_LIBRARY_REF");
    expect(runbook).not.toMatch(/otherwise\s+`main`/);
    expect(runbook).not.toContain("These secrets are configured in the test repository");
  });
});
