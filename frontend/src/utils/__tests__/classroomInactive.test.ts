import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api";
import {
  CLASSROOM_INACTIVE_MESSAGE_KEY,
  ClassroomInactiveError,
  isClassroomInactiveError,
  isClassroomInactiveResponse,
  studentAssignmentErrorKey,
  throwIfClassroomInactive,
} from "../classroomInactive";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("isClassroomInactiveResponse", () => {
  it("detects 403 classroom_inactive", async () => {
    expect(
      await isClassroomInactiveResponse(
        jsonResponse(403, { detail: "classroom_inactive" }),
      ),
    ).toBe(true);
  });

  it("ignores other 403 details and other statuses", async () => {
    expect(
      await isClassroomInactiveResponse(
        jsonResponse(403, { detail: "Not your assignment" }),
      ),
    ).toBe(false);
    expect(
      await isClassroomInactiveResponse(
        jsonResponse(404, { detail: "classroom_inactive" }),
      ),
    ).toBe(false);
  });

  it("returns false when the body is not JSON", async () => {
    expect(
      await isClassroomInactiveResponse(new Response("oops", { status: 403 })),
    ).toBe(false);
  });

  it("leaves the original body readable", async () => {
    const res = jsonResponse(403, { detail: "classroom_inactive" });
    await isClassroomInactiveResponse(res);
    await expect(res.json()).resolves.toEqual({
      detail: "classroom_inactive",
    });
  });
});

describe("throwIfClassroomInactive", () => {
  it("throws ClassroomInactiveError for 403 classroom_inactive", async () => {
    await expect(
      throwIfClassroomInactive(
        jsonResponse(403, { detail: "classroom_inactive" }),
      ),
    ).rejects.toBeInstanceOf(ClassroomInactiveError);
  });

  it("does nothing for other responses", async () => {
    await expect(
      throwIfClassroomInactive(jsonResponse(500, { detail: "boom" })),
    ).resolves.toBeUndefined();
  });
});

describe("isClassroomInactiveError / studentAssignmentErrorKey", () => {
  it("recognises ClassroomInactiveError and matching ApiError", () => {
    expect(isClassroomInactiveError(new ClassroomInactiveError())).toBe(true);
    expect(
      isClassroomInactiveError(new ApiError(403, "classroom_inactive")),
    ).toBe(true);
  });

  it("rejects other errors", () => {
    expect(isClassroomInactiveError(new ApiError(403, "forbidden"))).toBe(
      false,
    );
    expect(
      isClassroomInactiveError(new ApiError(400, "classroom_inactive")),
    ).toBe(false);
    expect(isClassroomInactiveError(new Error("x"))).toBe(false);
  });

  it("maps to the dedicated message key or the fallback", () => {
    expect(
      studentAssignmentErrorKey(new ClassroomInactiveError(), "fallback"),
    ).toBe(CLASSROOM_INACTIVE_MESSAGE_KEY);
    expect(studentAssignmentErrorKey(new Error("x"), "fallback")).toBe(
      "fallback",
    );
  });
});
