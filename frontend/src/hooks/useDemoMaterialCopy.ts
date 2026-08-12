/**
 * useDemoMaterialCopy (#989)
 *
 * Completes the journey that starts on an expired public demo page: the visitor
 * is invited to register, `DemoAccessGate` stores
 * `/teacher/programs?demoCopyProgram=<id>` as the post-login redirect, and once
 * they land on their materials page this hook performs the copy they were
 * promised — into their own library, or into the organization's when they are
 * in organization workspace mode.
 *
 * The visitor may finish registration in a different tab, so the redirect
 * target lives in localStorage (see utils/redirectAfterLogin.ts); by the time
 * this hook runs, all that is left is the query param.
 *
 * On failure (daily copy limit, missing org permission, program gone) it
 * surfaces a toast and leaves the visitor on the page to copy manually — the
 * material list is right there — rather than bouncing them somewhere else.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useResourceMaterialsAPI } from "@/hooks/useResourceMaterialsAPI";
import { useWorkspaceSafe } from "@/contexts/WorkspaceContext";

/** Query param carrying the resource pack to copy after login. */
export const DEMO_COPY_PROGRAM_PARAM = "demoCopyProgram";

/** Query param carrying the freshly copied program to guide the teacher to,
 * used when the copy lands on a different page than the one that ran it. */
export const DEMO_GUIDE_PROGRAM_PARAM = "demoGuideProgram";

interface CopyResponse {
  copied_program_id?: number;
  copied_program_name?: string;
}

export interface DemoMaterialCopyResult {
  /** Program id created by the copy — the anchor for the arrival guide (#989). */
  copiedProgramId: number | null;
  /** True while the copy request is in flight. */
  copying: boolean;
  /** Whether the copy went to the organization's materials rather than the
   * teacher's own — the two live on different pages. */
  copiedToOrganization: boolean;
}

/**
 * @param enabled Wait until the page's own data has loaded, so the guide that
 *   follows the copy has something to point at.
 * @param onCopied Called once after a successful copy with the new program id
 *   and whether it landed in the organization's materials.
 */
export function useDemoMaterialCopy(
  enabled: boolean,
  onCopied?: (programId: number, toOrganization: boolean) => void,
): DemoMaterialCopyResult {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { copyMaterial } = useResourceMaterialsAPI();
  // Safe variant: the hook is mounted from pages that may render outside a
  // WorkspaceProvider, in which case there is no organization to copy into.
  const workspace = useWorkspaceSafe();

  // Same workspace split the resource-materials page uses: the backend copy API
  // only knows individual vs organization.
  const orgScope =
    workspace?.mode === "organization" && !!workspace?.selectedOrganization;
  const orgId = workspace?.selectedOrganization?.id;

  const [copiedProgramId, setCopiedProgramId] = useState<number | null>(null);
  const [copying, setCopying] = useState(false);
  // React 18 StrictMode mounts effects twice in dev; without this guard the
  // visitor would silently end up with two copies of the material.
  const startedRef = useRef(false);

  const rawParam = searchParams.get(DEMO_COPY_PROGRAM_PARAM);
  const programId =
    rawParam && /^\d+$/.test(rawParam) ? Number(rawParam) : null;

  const clearParam = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(DEMO_COPY_PROGRAM_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  useEffect(() => {
    if (!enabled || programId === null || startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    const run = async () => {
      setCopying(true);
      try {
        const result = (await copyMaterial(
          programId,
          orgScope ? "organization" : "individual",
          orgScope ? orgId : undefined,
        )) as CopyResponse;

        if (cancelled) return;

        toast.success(
          t(
            orgScope
              ? "resourceMaterials.toast.autoCopySuccessOrg"
              : "resourceMaterials.toast.autoCopySuccess",
            { name: result?.copied_program_name ?? "" },
          ),
        );

        const newId = result?.copied_program_id ?? null;
        setCopiedProgramId(newId);
        if (newId !== null) onCopied?.(newId, orgScope);
      } catch (err) {
        if (cancelled) return;
        console.error("Demo material auto-copy failed:", err);
        toast.error(t("resourceMaterials.toast.autoCopyFailed"));
      } finally {
        if (!cancelled) {
          setCopying(false);
          clearParam();
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
    // `copyMaterial` / `onCopied` are recreated each render; the ref guard makes
    // this effect single-shot regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, programId, orgScope, orgId]);

  return { copiedProgramId, copying, copiedToOrganization: orgScope };
}
