// workspace layout 저장·복원에서 renderer가 main에 요청하는 모양. 파일에 남는 UI 참조만 담는다.
// 이 파일은 renderer도 부른다. schema 검증은 main/workspace/workspace-layout.ts가 한다.

/** workspace(Home, project, app) layout 복원. 입력은 `{ workspace }`이고 workspace는 `home`이거나 project·app id다. */
export const WORKSPACE_LAYOUT_READ_CHANNEL = "shell:workspace-layout-read";
/** workspace layout 저장. 입력은 `{ workspace, layout }`이고 layout은 schema 판 없이 `{ active_desk, desks }`다. */
export const WORKSPACE_LAYOUT_SAVE_CHANNEL = "shell:workspace-layout-save";

type WorkspaceLayoutFailure = {
  ok: false;
  code: "invalid_input" | "unavailable" | "forbidden";
  message: string;
};

export type WorkspaceLayoutReadResult =
  | { ok: true; available: true; layout: unknown }
  | {
      ok: true;
      available: false;
      reason: "unsupported_schema" | "corrupt" | "absent";
    }
  | WorkspaceLayoutFailure;

export type WorkspaceLayoutSaveResult = { ok: true } | WorkspaceLayoutFailure;
