// shell layout 저장·복원에서 renderer가 main에 요청하는 모양. 현재 보기
// relay(packages/contracts/shell)와 달리 파일에 남는 UI 참조만 담는다.
// 이 파일은 renderer도 부른다. schema 검증은 main/workspace/schema.ts가 한다.

/** renderer가 main에 보내는 layout 저장 요청. WorkspaceLayout 값 그대로다. */
export const LAYOUT_SAVE_CHANNEL = "shell:layout-save";
/** renderer가 main에 요청하는 마지막 공간 layout 복원. */
export const LAYOUT_READ_CHANNEL = "shell:layout-read";

export type LayoutSaveResult =
  | { ok: true }
  | {
    ok: false;
    code: "invalid_input" | "unwritable" | "forbidden";
    message: string;
  };

export type LayoutReadResult =
  | {
    ok: true;
    available: true;
    layout: unknown;
  }
  | {
    ok: true;
    available: false;
    reason: "unsupported_schema" | "corrupt" | "absent";
  }
  | {
    ok: false;
    code: "unwritable" | "unreadable" | "forbidden";
    message: string;
  };
