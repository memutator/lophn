// OS 폴더·파일 선택. renderer는 경로를 지어내지 않고 main이 연 OS 선택기의 결과만
// 받는다. 이 파일은 main·preload·renderer가 함께 부르므로 import가 없다.

/** renderer가 main에 폴더 선택기를 여는 요청. 입력은 `FolderPickInput`이다. */
export const FOLDER_PICK_CHANNEL = "shell:folder-pick";
/** renderer가 main에 파일 선택기를 여는 요청. 입력은 빈 객체다. */
export const FILE_PICK_CHANNEL = "shell:file-pick";

/** main이 dialog 제목을 purpose로 정한다. 없으면 `register`다. */
export type FolderPickInput = { purpose?: "register" | "relocate" };

/** 고른 절대 경로. 사람이 그만두면 null이다. */
export type FolderPickReply =
  | { ok: true; path: string | null }
  | { ok: false; code: "forbidden" | "invalid_input" | "unavailable" };

export interface FolderPickerApi {
  pick(input?: FolderPickInput): Promise<FolderPickReply>;
  /** project 밖 파일 하나의 절대 경로. */
  pickFile(): Promise<FolderPickReply>;
}
