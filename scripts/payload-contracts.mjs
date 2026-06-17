// Versioned cross-repo payload contracts. Dependency-free hand-written validators:
// fail early with precise messages when required fields are missing.
//
// Engine release dispatch payload: canonical `version`, with temporary aliases
// `engine_ref`, `tag_name`, `release.tag_name` (deprecated; remove once the engine
// publish workflow always sends `version`).
// Action downstream dispatch payload: `action_ref`, `library_ref`, `source_run_id`.

function requiredString(value, message) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

export function resolveEngineReleaseVersion(payload = {}) {
  return requiredString(
    payload.version ?? payload.engine_ref ?? payload.tag_name ?? payload.release?.tag_name,
    "engine release payload requires version",
  );
}

export function validateDownstreamPayload(payload = {}) {
  return {
    action_ref: requiredString(payload.action_ref, "downstream payload requires action_ref"),
    library_ref: requiredString(payload.library_ref, "downstream payload requires library_ref"),
    source_run_id: requiredString(payload.source_run_id, "downstream payload requires source_run_id"),
  };
}
