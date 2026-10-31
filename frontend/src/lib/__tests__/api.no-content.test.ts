/**
 * 成功回應沒有內容（#1112 第四輪）：204 或空 body 不解析 JSON，回 `undefined`。
 *
 * 背景：刪除 API 回 204，`request()` 原本一律 `response.json()` → SyntaxError → 被包成
 * ApiError(0)，畫面跳「刪除失敗」但其實已經刪掉。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/config/api", () => ({
  API_URL: "",
}));

import { apiClient } from "../api";

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

describe("apiClient：204／空 body", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    localStorage.clear();
  });

  it("delete() 收到 204 能正常完成，回 undefined", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiClient.delete("/api/things/1")).resolves.toBeUndefined();
  });

  it("200 但 Content-Length: 0 也回 undefined", async () => {
    fetchMock.mockResolvedValue(
      new Response("", { status: 200, headers: { "Content-Length": "0" } }),
    );
    await expect(
      apiClient.post("/api/things/1/touch"),
    ).resolves.toBeUndefined();
  });

  it("有 JSON 內容時照常解析", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(apiClient.get("/api/things/1")).resolves.toEqual({
      ok: true,
    });
  });

  it("postForm 收到 204 也回 undefined", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      apiClient.postForm("/api/upload", new FormData()),
    ).resolves.toBeUndefined();
  });
});
