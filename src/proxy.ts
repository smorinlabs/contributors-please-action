import { ProxyAgent } from "undici";

export function createProxyFetch(
  env: NodeJS.ProcessEnv,
  baseFetch: typeof fetch
): typeof fetch {
  const proxyUrl = env.HTTPS_PROXY || env.https_proxy;
  if (!proxyUrl) {
    return baseFetch;
  }

  const dispatcher = new ProxyAgent(proxyUrl);
  const noProxy = parseNoProxy(env.NO_PROXY || env.no_proxy);

  return ((input, init) => {
    const url = urlFromFetchInput(input);
    if (url && bypassesProxy(url, noProxy)) {
      return baseFetch(input, init);
    }
    return baseFetch(input, {
      ...(init ?? {}),
      dispatcher,
    } as RequestInit & { dispatcher: ProxyAgent });
  }) as typeof fetch;
}

function parseNoProxy(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
}

function bypassesProxy(url: URL, entries: readonly string[]): boolean {
  const host = url.hostname.toLowerCase();
  const port = url.port || defaultPort(url.protocol);

  return entries.some(entry => {
    if (entry === "*") {
      return true;
    }

    const { hostPattern, portPattern } = splitNoProxyEntry(entry);
    if (portPattern && portPattern !== port) {
      return false;
    }

    const normalized = hostPattern.replace(/^\*\./, "").replace(/^\./, "");
    return host === normalized || host.endsWith(`.${normalized}`);
  });
}

function splitNoProxyEntry(entry: string): {
  hostPattern: string;
  portPattern?: string;
} {
  const portMatch = entry.match(/^(.*):(\d+)$/);
  if (!portMatch) {
    return { hostPattern: entry };
  }
  return {
    hostPattern: portMatch[1],
    portPattern: portMatch[2],
  };
}

function defaultPort(protocol: string): string {
  if (protocol === "https:") {
    return "443";
  }
  if (protocol === "http:") {
    return "80";
  }
  return "";
}

function urlFromFetchInput(input: Parameters<typeof fetch>[0]): URL | undefined {
  const rawUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : "url" in input
          ? input.url
          : undefined;
  if (!rawUrl) {
    return undefined;
  }
  try {
    return new URL(rawUrl);
  } catch {
    return undefined;
  }
}
