/**
 * Tests for useDemoMaterialCopy (#989) — the auto-copy that completes the
 * journey from an expired public demo page to the visitor's own materials.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import { useDemoMaterialCopy } from "../useDemoMaterialCopy";

const copyMaterial = vi.fn();
const workspace: {
  mode: string;
  selectedOrganization: { id: string } | null;
} = {
  mode: "individual",
  selectedOrganization: null,
};

vi.mock("@/hooks/useResourceMaterialsAPI", () => ({
  useResourceMaterialsAPI: () => ({ copyMaterial }),
}));

vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspaceSafe: () => workspace,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function Harness({
  onCopied,
}: {
  onCopied?: (id: number, org: boolean) => void;
}) {
  useDemoMaterialCopy(true, onCopied);
  return <div>materials</div>;
}

function renderAt(url: string, onCopied?: (id: number, org: boolean) => void) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/teacher/programs"
          element={<Harness onCopied={onCopied} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("useDemoMaterialCopy", () => {
  beforeEach(() => {
    copyMaterial.mockReset();
    copyMaterial.mockResolvedValue({
      copied_program_id: 99,
      copied_program_name: "翰林佳音 第二冊",
    });
    workspace.mode = "individual";
    workspace.selectedOrganization = null;
  });

  it("copies to the teacher's own materials in individual mode", async () => {
    const onCopied = vi.fn();
    renderAt("/teacher/programs?demoCopyProgram=63", onCopied);

    await waitFor(() => expect(copyMaterial).toHaveBeenCalled());
    expect(copyMaterial).toHaveBeenCalledWith(63, "individual", undefined);
    await waitFor(() => expect(onCopied).toHaveBeenCalledWith(99, false));
  });

  it("copies into the organization when in organization mode", async () => {
    workspace.mode = "organization";
    workspace.selectedOrganization = { id: "org-uuid" };
    const onCopied = vi.fn();

    renderAt("/teacher/programs?demoCopyProgram=63", onCopied);

    await waitFor(() => expect(copyMaterial).toHaveBeenCalled());
    expect(copyMaterial).toHaveBeenCalledWith(63, "organization", "org-uuid");
    await waitFor(() => expect(onCopied).toHaveBeenCalledWith(99, true));
  });

  it("copies only once even though StrictMode mounts effects twice", async () => {
    renderAt("/teacher/programs?demoCopyProgram=63");

    await waitFor(() => expect(copyMaterial).toHaveBeenCalled());
    expect(copyMaterial).toHaveBeenCalledTimes(1);
  });

  it("does nothing without the query param", async () => {
    renderAt("/teacher/programs");

    await waitFor(() => expect(copyMaterial).not.toHaveBeenCalled());
  });

  it("ignores a non-numeric program id", async () => {
    renderAt("/teacher/programs?demoCopyProgram=63;DROP");

    await waitFor(() => expect(copyMaterial).not.toHaveBeenCalled());
  });

  it("does not call onCopied when the copy fails", async () => {
    copyMaterial.mockRejectedValue(new Error("daily limit reached"));
    const onCopied = vi.fn();

    renderAt("/teacher/programs?demoCopyProgram=63", onCopied);

    await waitFor(() => expect(copyMaterial).toHaveBeenCalled());
    expect(onCopied).not.toHaveBeenCalled();
  });
});
