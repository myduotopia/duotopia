/**
 * buildStudentLoginUrl 單元測試（Issue #793）
 *
 * 鎖住 QR / 可複製連結共用的 URL 組裝：teacher_email 必帶，視圖 scope 依型別
 * 正確帶入 scope / org_id / school_id；無 scope 時不帶（向後相容舊 QR）。
 */
import { describe, it, expect } from "vitest";
import {
  buildStudentLoginUrl,
  type StudentLoginScope,
} from "../teacherService";

const parse = (s: string) => new URL(s).searchParams;

describe("buildStudentLoginUrl", () => {
  it("無 scope：只帶 teacher_email、不帶 scope 參數", () => {
    const p = parse(buildStudentLoginUrl("teacher@test.com"));
    expect(p.get("teacher_email")).toBe("teacher@test.com");
    expect(p.get("scope")).toBeNull();
    expect(p.get("org_id")).toBeNull();
    expect(p.get("school_id")).toBeNull();
  });

  it("null scope 等同無 scope", () => {
    const p = parse(buildStudentLoginUrl("t@x.com", null));
    expect(p.get("scope")).toBeNull();
    expect(p.get("teacher_email")).toBe("t@x.com");
  });

  it("personal：scope=personal、無 id", () => {
    const p = parse(buildStudentLoginUrl("t@x.com", { type: "personal" }));
    expect(p.get("scope")).toBe("personal");
    expect(p.get("org_id")).toBeNull();
    expect(p.get("school_id")).toBeNull();
  });

  it("org：scope=org + org_id", () => {
    const scope: StudentLoginScope = { type: "org", orgId: "org-uuid-1" };
    const p = parse(buildStudentLoginUrl("t@x.com", scope));
    expect(p.get("scope")).toBe("org");
    expect(p.get("org_id")).toBe("org-uuid-1");
    expect(p.get("school_id")).toBeNull();
  });

  it("school：scope=school + school_id", () => {
    const scope: StudentLoginScope = { type: "school", schoolId: "sch-uuid-9" };
    const p = parse(buildStudentLoginUrl("t@x.com", scope));
    expect(p.get("scope")).toBe("school");
    expect(p.get("school_id")).toBe("sch-uuid-9");
    expect(p.get("org_id")).toBeNull();
  });

  it("email 含特殊字元時正確編碼（可被 URL 還原）", () => {
    const p = parse(buildStudentLoginUrl("a+b@x.com", { type: "personal" }));
    expect(p.get("teacher_email")).toBe("a+b@x.com");
  });

  it("指向 /student/login 路徑", () => {
    const url = new URL(buildStudentLoginUrl("t@x.com"));
    expect(url.pathname).toBe("/student/login");
  });
});
