/**
 * Shared holder for the current public-demo advanced-settings overrides (#923).
 *
 * The demo assignment is a single row shared by all anonymous visitors. When a
 * visitor uses the demo page's "進階設定" panel to switch practice mode / toggle
 * settings, `DemoAssignmentPage` stores the chosen overrides here and remounts
 * the activity. Each demo activity appends these overrides to its
 * `/api/demo/.../preview/*-start` URL via `withDemoOverrides`, so the stateless
 * backend overlay serves data that matches the chosen mode/settings — without
 * persisting anything to the shared row.
 *
 * Empty by default, so on a plain demo load the URLs are unchanged (backward
 * compatible with the existing demo pages).
 */
export type DemoOverrides = Record<string, string | number | boolean>;

let current: DemoOverrides = {};

/** Replace the active demo overrides (called by DemoAssignmentPage on apply). */
export function setDemoOverrides(overrides: DemoOverrides): void {
  current = overrides ?? {};
}

/** Reset to no overrides (called when the demo page unmounts). */
export function clearDemoOverrides(): void {
  current = {};
}

/** The active overrides (used by DemoAssignmentPage to refetch the preview). */
export function getDemoOverrides(): DemoOverrides {
  return current;
}

/**
 * Append the active overrides to a demo endpoint that may already carry a query
 * string (e.g. `?exclude_ids=...`). Returns the endpoint unchanged when there
 * are no overrides.
 */
export function withDemoOverrides(endpoint: string): string {
  const qs = toQueryString(current);
  if (!qs) return endpoint;
  return endpoint + (endpoint.includes("?") ? "&" : "?") + qs;
}

/** Serialize an overrides object to a query string (skips empty). */
export function toQueryString(overrides: DemoOverrides): string {
  return Object.entries(overrides)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
}
