// 전역 float(workspace를 넘는 앱 panel 화면)의 저장·복원에서 renderer가 main에 요청하는 모양. 파일 schema 검증은
// main/workspace/global-floats.ts가 한다. 이 파일은 renderer도 부른다.

/** 전역 float 목록 복원. 입력이 없다. */
export const GLOBAL_FLOATS_READ_CHANNEL = "shell:global-floats-read";
/** 전역 float 목록 저장. 입력은 `{ floats }`이다. */
export const GLOBAL_FLOATS_SAVE_CHANNEL = "shell:global-floats-save";

export interface GlobalFloatRecord {
  app: string;
  screen: string;
  /** title bar 아래 창 몸통 왼쪽 위 기준 정수 CSS px(workspace layout의 float rect와 같다). */
  rect: { x: number; y: number; width: number; height: number };
  minimized: boolean;
  pinned?: true;
}

type GlobalFloatsFailure = {
  ok: false;
  code: "invalid_input" | "unavailable" | "forbidden";
  message: string;
};

/** 아래에서 위 순서다. 파일이 없거나 틀리면 빈 목록이다. */
export type GlobalFloatsReadResult =
  | { ok: true; floats: GlobalFloatRecord[] }
  | GlobalFloatsFailure;

export type GlobalFloatsSaveResult = { ok: true } | GlobalFloatsFailure;
