// 편집기·파일 tree의 파일 읽고 쓰기 경계. 경로 하나가 파일 하나이고, 읽기·쓰기·watch는
// shell main이 디스크에서 직접 한다(core 통로를 거치지 않는다). renderer는 절대 경로 문자열만
// 보낸다. 충돌은 내용 hash로 안다. 이 파일은 main·preload·renderer가 함께 부르므로 zod 말고는
// import하지 않는다.
import { z } from "zod";

export const FILE_LIST_CHANNEL = "shell:file-list";
export const FILE_READ_CHANNEL = "shell:file-read";
export const FILE_READ_BYTES_CHANNEL = "shell:file-read-bytes";
export const FILE_WRITE_CHANNEL = "shell:file-write";
export const FILE_RENAME_CHANNEL = "shell:file-rename";
export const FILE_DELETE_CHANNEL = "shell:file-delete";
export const FILE_CREATE_CHANNEL = "shell:file-create";
export const FILE_REVEAL_CHANNEL = "shell:file-reveal";
/** 이 창이 보는 파일 전체 목록을 통째로 바꾼다. 빈 목록이면 watch를 끈다. */
export const FILE_WATCH_CHANNEL = "shell:file-watch";
/** main → renderer: 밖(다른 편집기, git)에서 바뀐 파일. */
export const FILE_CHANGED_CHANNEL = "shell:file-changed";
/** renderer → main: 이 창의 저장 중·끝나지 않은 편집 수. 창 닫기 guard가 읽는다. */
export const FILE_COUNTS_CHANNEL = "shell:file-counts";
/** main → renderer: 창을 닫으려 한다. 마지막 고침을 보내고 답한다. */
export const FILE_CLOSE_REQUEST_CHANNEL = "shell:file-close-request";
/** renderer → main: 창 닫기 답. */
export const FILE_CLOSE_ANSWER_CHANNEL = "shell:file-close-answer";

/** 글로 읽는 파일의 상한. 넘으면 `too_large`. */
export const FILE_TEXT_MAX_BYTES = 8 * 1024 * 1024;
/** 이미지·pdf 보기로 읽는 파일의 상한. */
export const FILE_VIEW_MAX_BYTES = 64 * 1024 * 1024;

// 절대 경로 문자열. 정규화, 폴더 밖 판정, 데이터 root의 secret 파일 거절(`forbidden`)은 main의
// 몫이고 schema는 모양만 본다.
const path = z.string().max(4096).regex(/^(\/|[A-Za-z]:[\\/])/);
// 내용의 sha256 hex. 읽을 때 준 hash가 쓸 때의 base_hash다.
const hash = z.string().regex(/^[0-9a-f]{64}$/);

export const fileListSchema = z.object({ path }).strict();
export const fileReadSchema = z.object({ path }).strict();
export const fileReadBytesSchema = z.object({ path }).strict();
export const fileWriteSchema = z.object({
  path,
  /** null이면 새 파일이다. 이미 있으면 `conflict`. */
  base_hash: hash.nullable(),
  text: z.string().refine((text) =>
    new TextEncoder().encode(text).byteLength <= FILE_TEXT_MAX_BYTES
  ),
}).strict();
export const fileRenameSchema = z.object({ from: path, to: path }).strict();
export const fileDeleteSchema = z.object({ path }).strict();
export const fileCreateSchema = z.object({
  path,
  kind: z.enum(["file", "folder"]),
}).strict();
export const fileRevealSchema = z.object({ path }).strict();
export const fileWatchSchema = z.object({
  paths: z.array(path).max(256),
}).strict();
export const fileCountsSchema = z.object({
  /** 디스크 저장이 끝나지 않은 파일 수(쓰는 중, 실패, 불명, 충돌). */
  unsettled: z.number().int().min(0).max(10_000),
  /** 열려 있는 파일 수. */
  open: z.number().int().min(0).max(10_000),
}).strict();
export const fileCloseAnswerSchema = z.object({
  request: z.number().int().positive(),
  answer: z.enum(["allow", "stay", "asking"]),
}).strict();

export type FileEntry = { name: string; kind: "file" | "folder" };
export type FileList = { entries: FileEntry[] };
// modified_at은 파일의 마지막 수정 시각(epoch ms)이다.
export type FileText = { text: string; hash: string; modified_at: number };
export type FileBytes = {
  bytes: Uint8Array;
  content_type: string;
  modified_at: number;
};
export type FileWrite = {
  path: string;
  base_hash: string | null;
  text: string;
};
export type FileWritten = { hash: string };
export type FileChanged = { path: string; hash: string | null };
export type FileCounts = { unsettled: number; open: number };
export type CloseAnswer = "allow" | "stay" | "asking";

/** renderer가 구별하는 실패. 경로·OS 오류 원문은 싣지 않는다. */
export type FileFailure =
  | "invalid_input"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unavailable"
  | "unsupported"
  | "too_large";

export type FileReply<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: FileFailure };

/** preload가 desktop renderer에 여는 파일 통로. */
export interface FilesApi {
  /** 폴더의 한 단계, 이름순. */
  list(input: { path: string }): Promise<FileReply<FileList>>;
  /** UTF-8 글. 8MiB를 넘으면 `too_large`, 글이 아니면 `unsupported`. */
  read(input: { path: string }): Promise<FileReply<FileText>>;
  /** 이미지·pdf 보기용. content type은 main이 확장자로 정한다. */
  readBytes(input: { path: string }): Promise<FileReply<FileBytes>>;
  /** base_hash가 지금 디스크와 다르면 `conflict`이고 디스크는 그대로다. */
  write(input: FileWrite): Promise<FileReply<FileWritten>>;
  /** 비어 있는 새 파일이나 폴더를 만든다. 없는 위쪽 폴더도 만든다. 이미 있으면 `conflict`이고 아무것도 덮어쓰지 않는다. */
  create(
    input: { path: string; kind: "file" | "folder" },
  ): Promise<FileReply<Record<PropertyKey, never>>>;
  /** `to`가 이미 있으면 `conflict`, 폴더를 자기 안으로 옮기면 `invalid_input`. */
  rename(
    input: { from: string; to: string },
  ): Promise<FileReply<Record<PropertyKey, never>>>;
  /** OS 휴지통으로 보낸다. 비어 있지 않은 폴더도 된다. 휴지통을 못 쓰면 `unavailable`이고 아무것도 지우지 않는다. */
  delete(
    input: { path: string },
  ): Promise<FileReply<Record<PropertyKey, never>>>;
  /** OS 파일 관리자에서 그 파일을 보인다. */
  reveal(
    input: { path: string },
  ): Promise<FileReply<Record<PropertyKey, never>>>;
  watch(
    input: { paths: string[] },
  ): Promise<FileReply<Record<PropertyKey, never>>>;
  /** 밖에서 바뀐 파일. 해제는 반환 함수다. */
  onChanged(listener: (change: FileChanged) => void): () => void;
  counts(input: FileCounts): void;
  /** main이 창 닫기를 묻는다. 해제는 반환 함수다. */
  onCloseRequest(listener: (request: number) => void): () => void;
  answerClose(request: number, answer: CloseAnswer): void;
}
