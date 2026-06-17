import { describe, expect, it, vi } from "vitest";

import { isRateLimitError, withRateLimitFallback } from "../scripts/github-api.mjs";

describe("isRateLimitError", () => {
  it("detects rate limits by message text", () => {
    expect(isRateLimitError("API rate limit exceeded")).toBe(true);
    expect(isRateLimitError("secondary rate limit")).toBe(true);
    expect(isRateLimitError("abuse detection mechanism")).toBe(true);
    expect(isRateLimitError("not found")).toBe(false);
  });

  it("detects status-only rate limits with no rate-limit text", () => {
    expect(isRateLimitError("", 429)).toBe(true);
    expect(isRateLimitError("", 403)).toBe(true);
  });

  it("does not treat a genuine 403 authorization failure as a rate limit", () => {
    expect(isRateLimitError("Resource not accessible by integration", 403)).toBe(false);
    expect(isRateLimitError("Bad credentials", 403)).toBe(false);
  });
});

describe("withRateLimitFallback", () => {
  it("uses REST success without GraphQL", async () => {
    const rest = vi.fn(async () => "rest-ok");
    const graphql = vi.fn(async () => "graphql-ok");
    await expect(withRateLimitFallback(rest, graphql, "PR lookup", () => {})).resolves.toBe("rest-ok");
    expect(graphql).not.toHaveBeenCalled();
  });

  it("falls back on rate-limit-shaped REST errors (message)", async () => {
    const rest = vi.fn(async () => {
      throw new Error("API rate limit exceeded");
    });
    const graphql = vi.fn(async () => "graphql-ok");
    await expect(withRateLimitFallback(rest, graphql, "PR lookup", () => {})).resolves.toBe("graphql-ok");
    expect(graphql).toHaveBeenCalledOnce();
  });

  it("falls back on a bare 429/403 status with no rate-limit text", async () => {
    const error = Object.assign(new Error(""), { status: 429 });
    const rest = vi.fn(async () => {
      throw error;
    });
    const graphql = vi.fn(async () => "graphql-ok");
    await expect(withRateLimitFallback(rest, graphql, "PR lookup", () => {})).resolves.toBe("graphql-ok");
  });

  it("does not fall back on fatal REST errors", async () => {
    const rest = vi.fn(async () => {
      throw new Error("validation failed");
    });
    const graphql = vi.fn(async () => "graphql-ok");
    await expect(withRateLimitFallback(rest, graphql, "PR lookup", () => {})).rejects.toThrow(
      "validation failed",
    );
    expect(graphql).not.toHaveBeenCalled();
  });

  it("does not fall back on a genuine 403 authorization failure", async () => {
    const error = Object.assign(new Error("Resource not accessible by integration"), {
      status: 403,
    });
    const rest = vi.fn(async () => {
      throw error;
    });
    const graphql = vi.fn(async () => "graphql-ok");
    await expect(withRateLimitFallback(rest, graphql, "PR lookup", () => {})).rejects.toThrow(
      "not accessible",
    );
    expect(graphql).not.toHaveBeenCalled();
  });

  it("logs the selected API path", async () => {
    const logs: string[] = [];
    const logger = (line: string) => logs.push(line);
    await withRateLimitFallback(async () => "ok", async () => "gql", "PR lookup", logger);
    expect(logs.some(line => line.includes("PR lookup") && line.includes("REST"))).toBe(true);
  });
});
