import { describe, expect, it, vi } from "vitest";

import { createProxyFetch } from "../src/proxy";

describe("createProxyFetch", () => {
  it("adds a dispatcher when HTTPS_PROXY is configured", async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const proxyFetch = createProxyFetch(
      { HTTPS_PROXY: "http://proxy.example:8080" },
      baseFetch
    );

    await proxyFetch("https://api.github.com/rate_limit");

    expect(baseFetch).toHaveBeenCalledWith(
      "https://api.github.com/rate_limit",
      expect.objectContaining({ dispatcher: expect.anything() })
    );
  });

  it("honors NO_PROXY host bypasses", async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const proxyFetch = createProxyFetch(
      {
        HTTPS_PROXY: "http://proxy.example:8080",
        NO_PROXY: "api.github.com,.github.acme.corp",
      },
      baseFetch
    );

    await proxyFetch("https://api.github.com/rate_limit");
    await proxyFetch("https://github.github.acme.corp/api/v3/rate_limit");
    await proxyFetch("https://api.other.example/rate_limit");

    expect(baseFetch).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/rate_limit",
      undefined
    );
    expect(baseFetch).toHaveBeenNthCalledWith(
      2,
      "https://github.github.acme.corp/api/v3/rate_limit",
      undefined
    );
    expect(baseFetch).toHaveBeenNthCalledWith(
      3,
      "https://api.other.example/rate_limit",
      expect.objectContaining({ dispatcher: expect.anything() })
    );
  });
});
