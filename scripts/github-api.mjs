// REST-first GitHub API helpers with a bounded GraphQL fallback for rate limits.
//
// First migration target: the "Verify pull request and label" REST/GraphQL block in
// .github/workflows/e2e.yml (see scripts/e2e-pr-snapshot.mjs).
//
// SEC3: helpers here must never print process.env, argv, or a raw token. Callers pass
// a logger; the default writes to stderr and emits only the API-path label, never
// credentials.

const RATE_LIMIT_TEXT = /rate limit|secondary rate|abuse detection/i;
const AUTHZ_FAILURE_TEXT = /not accessible|not authorized|forbidden|bad credentials/i;

// (message, status): a rate limit may arrive as a bare 403/429 with no rate-limit
// text. A genuine 403 authorization failure must NOT fall back, so a 403 is treated
// as rate-limit-shaped only when the message lacks an authorization signal. Callers
// should additionally gate on Retry-After / x-ratelimit-remaining when available.
export function isRateLimitError(message, status) {
  const text = String(message ?? "");
  if (RATE_LIMIT_TEXT.test(text)) {
    return true;
  }
  if (status === 429) {
    return true;
  }
  if (status === 403) {
    return !AUTHZ_FAILURE_TEXT.test(text);
  }
  return false;
}

export async function withRateLimitFallback(rest, graphql, label, logger = defaultLogger) {
  try {
    const result = await rest();
    logger(`${label} API path: REST`);
    return result;
  } catch (error) {
    if (!isRateLimitError(error?.message ?? error, error?.status)) {
      throw error;
    }
    logger(`${label} REST hit a rate limit; using GraphQL fallback.`);
    const result = await graphql();
    logger(`${label} API path: GraphQL fallback`);
    return result;
  }
}

function defaultLogger(line) {
  process.stderr.write(`${line}\n`);
}
