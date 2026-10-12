// 프로젝트 등록의 OS 폴더 선택. renderer는 경로를 지어내지 않고 main이 연 OS 선택기의 결과만
// 받는다(documents/projects#R1). 이 파일은 main·preload·renderer가 함께 부르므로 import가 없다.

/** renderer가 main에 폴더 선택기를 여는 요청. 입력은 빈 객체다. */
export const FOLDER_PICK_CHANNEL = "shell:folder-pick";

/** 고른 절대 경로. 사람이 그만두면 null이다. */
export type FolderPickReply =
  | { ok: true; path: string | null }
  | { ok: false; code: "forbidden" | "invalid_input" | "unavailable" };

export interface FolderPickerApi {
  pick(): Promise<FolderPickReply>;
}
