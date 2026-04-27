import { describe, it, expect, beforeEach } from "vitest";
import {
  isSafeRedirectPath,
  saveRedirectTarget,
  consumeRedirectTarget,
} from "../redirectAfterLogin";

const STORAGE_KEY = "auth_redirect_after_login";

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
