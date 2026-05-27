import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createAppAuth: vi.fn(),
  request: vi.fn(),
  requestDefaults: vi.fn(),
}));

vi.mock("@octokit/auth-app", () => ({
  createAppAuth: mocks.createAppAuth,
}));

vi.mock("@octokit/request", () => ({
  request: {
    defaults: mocks.requestDefaults,
  },
}));

import { createAppToken } from "../src/app-token";

describe("createAppToken", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createAppAuth.mockReturnValue(mocks.auth);
    mocks.requestDefaults.mockReturnValue(mocks.request);
    mocks.auth
      .mockResolvedValueOnce({ token: "app-token" })
      .mockResolvedValueOnce({ token: "installation-token" });
    mocks.request
      .mockResolvedValueOnce({
        data: {
          id: 1234,
          app_slug: "contributors-please-bot",
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: 98765,
        },
      });
  });

  it("looks up the App bot user id and returns a GitHub no-reply committer email", async () => {
    const result = await createAppToken({
      appId: "12345",
      privateKey: "private-key",
      owner: "smorinlabs",
      repo: "example",
      apiUrl: "https://api.github.com",
      serverUrl: "https://github.com",
    });

    expect(result).toEqual({
      token: "installation-token",
      login: "contributors-please-bot[bot]",
      email: "98765+contributors-please-bot[bot]@users.noreply.github.com",
    });
    expect(mocks.request).toHaveBeenNthCalledWith(
      2,
      "GET /users/{username}",
      {
        username: "contributors-please-bot[bot]",
        headers: {
          authorization: "Bearer installation-token",
        },
      }
    );
  });

  it("derives no-reply email domains from GitHub Enterprise server URLs", async () => {
    const result = await createAppToken({
      appId: "12345",
      privateKey: "private-key",
      owner: "acme",
      repo: "example",
      apiUrl: "https://github.acme.corp/api/v3",
      serverUrl: "https://github.acme.corp",
    });

    expect(result.email).toBe(
      "98765+contributors-please-bot[bot]@users.noreply.github.acme.corp"
    );
  });

  it("passes a custom fetch implementation to Octokit requests", async () => {
    const customFetch = vi.fn();

    await createAppToken({
      appId: "12345",
      privateKey: "private-key",
      owner: "smorinlabs",
      repo: "example",
      apiUrl: "https://api.github.com",
      serverUrl: "https://github.com",
      fetch: customFetch,
    });

    expect(mocks.requestDefaults).toHaveBeenCalledWith({
      baseUrl: "https://api.github.com",
      request: { fetch: customFetch },
    });
  });
});
