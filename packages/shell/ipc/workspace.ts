// place layout 저장·복원에서 renderer가 main에 요청하는 모양. 파일에 남는 UI 참조만 담는다.
// 이 파일은 renderer도 부른다. schema 검증은 main/workspace/place-layout.ts가 한다.

/** place(Home, project, app) layout 복원. 입력은 `{ place }`이고 place는 `home`이거나 project·app id다. */
export const PLACE_LAYOUT_READ_CHANNEL = "shell:place-layout-read";
/** place layout 저장. 입력은 `{ place, layout }`이고 layout은 schema 판 없이 `{ active_desk, desks }`다. */
export const PLACE_LAYOUT_SAVE_CHANNEL = "shell:place-layout-save";

type PlaceLayoutFailure = {
  ok: false;
  code: "invalid_input" | "unavailable" | "forbidden";
  message: string;
};

export type PlaceLayoutReadResult =
  | { ok: true; available: true; layout: unknown }
  | {
      ok: true;
      available: false;
      reason: "unsupported_schema" | "corrupt" | "absent";
    }
  | PlaceLayoutFailure;

export type PlaceLayoutSaveResult = { ok: true } | PlaceLayoutFailure;
