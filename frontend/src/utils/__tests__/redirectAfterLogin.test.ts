import { describe, it, expect, beforeEach } from "vitest";
import {
  isSafeRedirectPath,
  saveRedirectTarget,
  consumeRedirectTarget,
  REDIRECT_STORAGE_KEY,
} from "../redirectAfterLogin";

const STORAGE_KEY = REDIRECT_STORAGE_KEY;

describe("isSafeRedirectPath", () => {
  it("accepts normal absolute paths", () => {
    expect(isSafeRedirectPath("/student/dashboard")).toBe(true);
    expect(isSafeRedirectPath("/teacher/classroom/42?tab=overview")).toBe(true);
    expect(isSafeRedirectPath("/path#fragment")).toBe(true);
  });

  it("rejects non-string and empty values", () => {
    expect(isSafeRedirectPath(null)).toBe(false);
    expect(isSafeRedirectPath(undefined)).toBe(false);
    expect(isSafeRedirectPath(42)).toBe(false);
    expect(isSafeRedirectPath("")).toBe(false);
  });

  it("rejects paths that don't start with /", () => {
    expect(isSafeRedirectPath("dashboard")).toBe(false);
    expect(isSafeRedirectPath("https://evil.com")).toBe(false);
  });

  it("rejects protocol-relative URLs (//evil.com)", () => {
    expect(isSafeRedirectPath("//evil.com")).toBe(false);
    expect(isSafeRedirectPath("//evil.com/student/dashboard")).toBe(false);
  });

  it("rejects backslash-normalized paths", () => {
    expect(isSafeRedirectPath("/\\evil.com")).toBe(false);
    expect(isSafeRedirectPath("\\\\evil.com")).toBe(false);
    expect(isSafeRedirectPath("/path\\with\\backslash")).toBe(false);
  });

  it("rejects percent-encoded variants that decode to //", () => {
    expect(isSafeRedirectPath("/%2Fevil.com")).toBe(false);
    expect(isSafeRedirectPath("/%2fevil.com")).toBe(false);
  });

  it("rejects malformed percent-encoding", () => {
    expect(isSafeRedirectPath("/%E0%A4%A")).toBe(false);
    expect(isSafeRedirectPath("/%ZZ")).toBe(false);
  });
});

describe("saveRedirectTarget / consumeRedirectTarget", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips a safe path", () => {
    saveRedirectTarget("/student/dashboard");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("/student/dashboard");
    expect(consumeRedirectTarget("/fallback")).toBe("/student/dashboard");
  });

  it("does not save unsafe paths", () => {
    saveRedirectTarget("//evil.com");
    saveRedirectTarget("/%2Fevil.com");
    saveRedirectTarget("/back\\slash");
    saveRedirectTarget("not-absolute");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does not save login-page prefixes", () => {
    saveRedirectTarget("/teacher/login");
    saveRedirectTarget("/student/login?from=foo");
    saveRedirectTarget("/teacher/reset-password/abc123");
    saveRedirectTarget("/auth/1campus/callback?code=xyz");
    saveRedirectTarget("/verify-email?token=abc");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("consumeRedirectTarget returns fallback when storage is empty", () => {
    expect(consumeRedirectTarget("/student/dashboard")).toBe(
      "/student/dashboard",
    );
  });

  it("consumeRedirectTarget atomically clears the stored value", () => {
    saveRedirectTarget("/teacher/programs/5");
    expect(consumeRedirectTarget("/fallback")).toBe("/teacher/programs/5");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    // Second call returns fallback because the value was consumed.
    expect(consumeRedirectTarget("/fallback")).toBe("/fallback");
  });

  it("consumeRedirectTarget returns fallback if stored value is unsafe", () => {
    sessionStorage.setItem(STORAGE_KEY, "//evil.com");
    expect(consumeRedirectTarget("/safe-fallback")).toBe("/safe-fallback");
  });
});

describe("consumeRedirectTarget allowedPrefixes (role isolation)", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns fallback when stored target does not match any allowed prefix", () => {
    saveRedirectTarget("/teacher/dashboard");
    expect(consumeRedirectTarget("/student/dashboard", ["/student/"])).toBe(
      "/student/dashboard",
    );
  });

  it("returns stored target when it matches an allowed prefix", () => {
    saveRedirectTarget("/student/assignment/42/activity");
    expect(consumeRedirectTarget("/student/dashboard", ["/student/"])).toBe(
      "/student/assignment/42/activity",
    );
  });

  it("returns stored target when any allowed prefix matches", () => {
    saveRedirectTarget("/organization/123/members");
    expect(
      consumeRedirectTarget("/teacher/dashboard", [
        "/teacher/",
        "/organization/",
        "/dashboard",
      ]),
    ).toBe("/organization/123/members");
  });

  it("teacher target leaks to student login → falls back", () => {
    saveRedirectTarget("/teacher/programs/5");
    expect(consumeRedirectTarget("/student/dashboard", ["/student/"])).toBe(
      "/student/dashboard",
    );
  });

  it("student target leaks to teacher login → falls back", () => {
    saveRedirectTarget("/student/dashboard");
    expect(
      consumeRedirectTarget("/teacher/dashboard", [
        "/teacher/",
        "/organization/",
        "/dashboard",
      ]),
    ).toBe("/teacher/dashboard");
  });

  it("still consumes (clears storage) when prefix mismatch causes fallback", () => {
    saveRedirectTarget("/teacher/dashboard");
    consumeRedirectTarget("/student/dashboard", ["/student/"]);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("backwards compatible: omitting allowedPrefixes returns stored target", () => {
    saveRedirectTarget("/anything/at/all");
    expect(consumeRedirectTarget("/fallback")).toBe("/anything/at/all");
  });

  it("matches bare /dashboard exactly", () => {
    saveRedirectTarget("/dashboard");
    expect(
      consumeRedirectTarget("/teacher/dashboard", [
        "/teacher/",
        "/organization/",
        "/dashboard",
      ]),
    ).toBe("/dashboard");
  });

  it("matches /dashboard sub-paths via bare prefix", () => {
    saveRedirectTarget("/dashboard/teacher");
    expect(
      consumeRedirectTarget("/teacher/dashboard", [
        "/teacher/",
        "/organization/",
        "/dashboard",
      ]),
    ).toBe("/dashboard/teacher");
  });

  it("bare prefix /dashboard does not over-match /dashboard-admin", () => {
    saveRedirectTarget("/dashboard-admin/foo");
    expect(
      consumeRedirectTarget("/teacher/dashboard", [
        "/teacher/",
        "/organization/",
        "/dashboard",
      ]),
    ).toBe("/teacher/dashboard");
  });

  it("does not match a different role despite shared substring", () => {
    saveRedirectTarget("/teacher/students/100");
    // "/student/" prefix should NOT match "/teacher/students/..."
    expect(consumeRedirectTarget("/student/dashboard", ["/student/"])).toBe(
      "/student/dashboard",
    );
  });
});
