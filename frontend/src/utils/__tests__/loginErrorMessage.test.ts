import { describe, it, expect } from "vitest";
import { ApiError } from "../../lib/api";
import { resolveLoginErrorKey } from "../loginErrorMessage";

const FALLBACK = "teacherLogin.errors.loginFailed";

describe("resolveLoginErrorKey", () => {
  it("reports a connection problem for network/CORS failures (status 0)", () => {
    // ApiClient.request wraps fetch TypeErrors — including CORS rejections —
    // as ApiError with status 0. These must NOT read as "wrong password".
    const err = new ApiError(0, "Failed to fetch");
    expect(resolveLoginErrorKey(err, FALLBACK)).toBe(
      "common.errors.networkError",
    );
  });

  it("reports a connection problem for a bare fetch TypeError", () => {
    const err = new TypeError("Failed to fetch");
    expect(resolveLoginErrorKey(err, FALLBACK)).toBe(
      "common.errors.networkError",
    );
  });

  it("uses the caller's fallback for genuine 401 credential rejections", () => {
    const err = new ApiError(401, "Invalid credentials");
    expect(resolveLoginErrorKey(err, FALLBACK)).toBe(FALLBACK);
  });

  it("reports rate limiting for 429", () => {
    const err = new ApiError(429, "Rate limit exceeded");
    expect(resolveLoginErrorKey(err, FALLBACK)).toBe(
      "common.errors.rateLimited",
    );
  });

  it("reports a server problem for 5xx", () => {
    expect(resolveLoginErrorKey(new ApiError(500, "boom"), FALLBACK)).toBe(
      "common.errors.serverError",
    );
    expect(resolveLoginErrorKey(new ApiError(503, "boom"), FALLBACK)).toBe(
      "common.errors.serverError",
    );
  });

  it("uses the caller's fallback for 403 and other 4xx", () => {
    expect(resolveLoginErrorKey(new ApiError(403, "nope"), FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveLoginErrorKey(new ApiError(400, "bad"), FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it("uses the caller's fallback for unknown non-Error values", () => {
    expect(resolveLoginErrorKey(undefined, FALLBACK)).toBe(FALLBACK);
    expect(resolveLoginErrorKey("something", FALLBACK)).toBe(FALLBACK);
  });

  it("honours a different fallback key (student login, quick login)", () => {
    expect(
      resolveLoginErrorKey(
        new ApiError(401, "x"),
        "studentLogin.errors.loginFailed",
      ),
    ).toBe("studentLogin.errors.loginFailed");
  });
});
