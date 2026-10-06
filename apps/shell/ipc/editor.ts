// 문서 편집기(renderer)와 main의 파일 adapter 사이 경계(shell/editor#R1, R2, R12).
// renderer는 문서 id와 main이 준 session handle만 안다. 실제 경로·FileTarget·core port·token은
// main에만 있다. 바이트는 renderer가 UTF-8로 만들어 보내고 hash·업로드·쓰기는 main이 한다.
import { z } from "zod";

export const EDITOR_OPEN_CHANNEL = "shell:editor-open";
export const EDITOR_WRITE_CHANNEL = "shell:editor-write";
export const EDITOR_LOOKUP_CHANNEL = "shell:editor-lookup";
export const EDITOR_CURRENT_CHANNEL = "shell:editor-current";
export const EDITOR_WATCH_CHANNEL = "shell:editor-watch";
export const EDITOR_RELEASE_CHANNEL = "shell:editor-release";
/** renderer → main: 고른 판을 새 최신 판으로 되살린다(flow restore-document). */
export const EDITOR_RESTORE_CHANNEL = "shell:editor-restore";
/** renderer → main: 아직 판이 없는 새 문서(series 새 멤버)의 첫 판을 만든다(flow write-series). */
export const EDITOR_CREATE_CHANNEL = "shell:editor-create";
/** renderer → main: 문서의 최신 판을 추적 중인 프로젝트의 새 파일로 둔다(flow organize-documents). */
export const EDITOR_PLACE_CHANNEL = "shell:editor-place";
/** renderer → main: 이 창의 저장 중·끝나지 않은 편집 수. 끄기·창 닫기 확인이 읽는다. */
export const EDITOR_COUNTS_CHANNEL = "shell:editor-counts";
/** main → renderer: 창을 닫으려 한다. 마지막 고침을 보내고 답한다. */
export const EDITOR_CLOSE_REQUEST_CHANNEL = "shell:editor-close-request";
/** renderer → main: 창 닫기 답. */
export const EDITOR_CLOSE_ANSWER_CHANNEL = "shell:editor-close-answer";

/** 편집으로 여는 글의 상한. 더 큰 파일은 읽기만 한다. */
export const EDITOR_MAX_BYTES = 8 * 1024 * 1024;

const session = z.string().regex(/^es_[A-Za-z0-9_-]{8,64}$/);
const requestKey = z.string().regex(/^[A-Za-z0-9_-]{16,120}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const documentId = z.string().regex(/^doc_[0-9a-z]{26}$/);
const versionId = z.string().regex(/^ver_[0-9a-z]{26}$/);

export const editorOpenSchema = z.object({ document: documentId }).strict();

export const editorWriteSchema = z.object({
  session,
  request_key: requestKey,
  base_hash: hash.nullable(),
  bytes: z.instanceof(Uint8Array).refine((bytes) =>
    bytes.byteLength <= EDITOR_MAX_BYTES
  ),
  /** 편집 종료·명시 저장. 이 쓰기에 version 준비 요청을 싣는다. */
  end: z.boolean(),
  /** 새 판이 생겨 판 확정이 막혔을 때 사람이 고른 새 기준 판. */
  base_version: versionId.optional(),
}).strict();

export const editorLookupSchema = z.object({
  session,
  request_key: requestKey,
}).strict();

export const editorSessionSchema = z.object({ session }).strict();

export const editorRestoreSchema = z.object({
  document: documentId,
  version: versionId,
  request_key: requestKey,
}).strict();

/** 새 문서의 첫 판. 자리·이름은 series 가족의 것이고 documents가 저장 때 다시 검사한다. */
export const editorCreateSchema = z.object({
  document: documentId,
  request_key: requestKey,
  title: z.string().trim().min(1).max(500),
  place: z.object({
    kind: z.enum(["project", "app"]),
    id: z.string().regex(/^(prj|app)_[0-9a-z]{26}$/),
  }).strict(),
  name: z.string().max(200).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
  bytes: z.instanceof(Uint8Array).refine((bytes) =>
    bytes.byteLength <= EDITOR_MAX_BYTES
  ),
}).strict();

export const editorPlaceSchema = z.object({
  document: documentId,
  version: versionId,
  project: z.string().regex(/^prj_[0-9a-z]{26}$/),
  /** 새 파일의 절대 경로. 등록 폴더 안인지는 core가 본다. */
  path: z.string().min(1).max(4096),
  request_key: requestKey,
}).strict();

export const editorWatchSchema = z.object({
  session,
  cursor: z.string().min(1).max(512).optional(),
}).strict();

export const editorCountsSchema = z.object({
  /** 디스크 저장·결과 확인이 끝나지 않은 문서 수(쓰는 중, 실패, 불명, 충돌). */
  unsettled: z.number().int().min(0).max(10_000),
  /** 디스크에는 있지만 편집 종료(version 준비)를 아직 보내지 않은 문서 수. */
  open: z.number().int().min(0).max(10_000),
}).strict();

export const editorCloseAnswerSchema = z.object({
  request: z.number().int().positive(),
  answer: z.enum(["allow", "stay", "asking"]),
}).strict();

export type EditorWrite = {
  session: string;
  request_key: string;
  base_hash: string | null;
  bytes: Uint8Array;
  end: boolean;
  base_version?: string;
};
export type EditorCreate = {
  document: string;
  request_key: string;
  title: string;
  place: { kind: "project" | "app"; id: string };
  name: string;
  bytes: Uint8Array;
};
export type EditorCounts = { unsettled: number; open: number };
export type CloseAnswer = "allow" | "stay" | "asking";

/** renderer가 구별하는 실패. 경로·OS 오류 원문은 싣지 않는다. */
export type EditorFailure =
  | "invalid_input"
  | "forbidden"
  | "not_found"
  | "unavailable"
  | "offline"
  | "unsupported"
  | "too_large"
  | "unknown_session";

export type EditorReply<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: EditorFailure };

export type FileTargetKind =
  | "project_file"
  | "working_copy"
  | "instruction_file";

export interface EditorOpened {
  readonly session: string;
  readonly text: string;
  /** 지금 디스크 바이트의 hash. working copy를 아직 만들지 않았으면 null이다. */
  readonly base_hash: string | null;
  readonly target: FileTargetKind;
  /** 지금 판의 주 파일 경로(문서 안 상대 경로). 형식 문제의 줄을 고를 때 쓴다. */
  readonly primary_path: string | null;
}

export type DiskOutcome = "written" | "conflict" | "failed" | "unknown";
export type VersionOutcome =
  | "not_requested"
  | "preparing"
  | "validation_failed"
  | "conflict"
  | "confirmed";

/** documents/formats FormatDiagnostic에서 화면이 읽는 field. */
export interface EditorDiagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly file: string | null;
  readonly start_line: number | null;
}

/** 쓰기 하나의 단계별 결과. 뒤 단계 실패가 앞 단계 성공을 지우지 않는다. */
export interface SaveReport {
  readonly disk: DiskOutcome;
  readonly written_hash: string | null;
  readonly observed_hash: string | null;
  readonly observed_at: string | null;
  readonly changed_again: boolean | null;
  readonly recording: "recorded" | "unverified" | null;
  /** 판 확정. 종료 쓰기가 아니면 null이다. */
  readonly version: VersionOutcome | null;
  /** 판 확정으로 생긴 판. */
  readonly saved_version: string | null;
  /** version 충돌일 때 그 문서의 지금 최신 판. */
  readonly latest_version: string | null;
  /** 종료 쓰기에서 돌린 형식 검사. 돌리지 못했으면 null이다. */
  readonly problems: readonly EditorDiagnostic[] | null;
  /** 실패 이유(conflict·unavailable·offline 등). 성공이면 null이다. */
  readonly failure: string | null;
}

/** 결과를 모르는 쓰기를 documents 상태로 다시 본 결과. 다시 쓰지는 않는다. */
export interface LookupReport {
  /** written: 그 바이트가 디스크에 있다. not_written: 쓰기 전 그대로다. changed: 다른 내용이다. */
  readonly state: "written" | "not_written" | "changed" | "unknown";
  readonly observed_hash: string | null;
  readonly observed_at: string | null;
}

export interface CurrentFile {
  readonly text: string;
  readonly hash: string | null;
}

export type FileState =
  | "not_tracked"
  | "tracked"
  | "version_pending"
  | "validation_failed"
  | "source_missing"
  | "unverified";

export interface WatchReport {
  readonly state: FileState;
  readonly observed_hash: string | null;
  readonly observed_at: string;
  readonly compared_version: string | null;
  readonly cursor: string;
}

/** 복원에서 원본 파일 쓰기의 결과. 원본 연결이 없으면 null이다. */
export type RestoreFile =
  | "written"
  | "same"
  | "conflict"
  | "failed"
  | "unknown";

/**
 * 복원 결과. saved: 새 최신 판, unchanged: 최신 판이 이미 같은 내용이라 판을 만들지 않음,
 * conflict: 그 사이 최신 판·파일이 바뀌어 멈춤, pending: 파일은 썼지만 판 확정은 documents의
 * 관측을 기다림, failed: 끝내지 못함(failure에 이유).
 */
export interface RestoreReport {
  readonly outcome: "saved" | "unchanged" | "conflict" | "pending" | "failed";
  /** 새 판, 또는 같은 내용의 최신 판. */
  readonly version: string | null;
  readonly file: RestoreFile | null;
  readonly failure: string | null;
}

/**
 * 새 문서 첫 판의 결과. saved: 첫 판이 생겼다(가족 draft와 일치하면 같은 저장에서 멤버가 된다),
 * conflict: 그 사이 key·문서·가족이 바뀌어 저장하지 않음, failed: 저장하지 않음(failure에 이유),
 * unknown: 응답을 잃었고 문서 조회로도 결과를 모른다, pending: 파일은 썼고 판 확정은 documents의
 * 관측을 기다림(지침 파일의 첫 저장).
 */
export interface CreateReport {
  readonly outcome: "saved" | "conflict" | "failed" | "unknown" | "pending";
  readonly version: string | null;
  readonly failure: string | null;
}

/** 두기 뒤 연결 단계 하나. documents FileStep과 같은 뜻이다. */
export type PlaceStep =
  | { readonly state: "done" }
  | { readonly state: "skipped"; readonly reason: string }
  | { readonly state: "failed"; readonly code: string }
  | { readonly state: "not_attempted" };

/**
 * 파일로 두기 결과. file은 파일 쓰기 결과이고 steps는 원본 연결·추적 규칙·자리 단계다.
 * 파일 쓰기가 끝나지 못했으면 steps는 null이다. 뒤 단계 실패가 파일 성공을 지우지 않는다.
 */
export interface PlaceReport {
  readonly file: "written" | "conflict" | "failed" | "unknown";
  readonly path: string | null;
  readonly steps: {
    readonly source: PlaceStep;
    readonly tracking: PlaceStep;
    readonly move: PlaceStep;
  } | null;
  readonly failure: string | null;
}

/** preload가 desktop renderer에 여는 편집 통로. */
export interface EditorFilesApi {
  open(input: { document: string }): Promise<EditorReply<EditorOpened>>;
  write(input: EditorWrite): Promise<EditorReply<SaveReport>>;
  lookup(
    input: { session: string; request_key: string },
  ): Promise<EditorReply<LookupReport>>;
  current(input: { session: string }): Promise<EditorReply<CurrentFile>>;
  watch(
    input: { session: string; cursor?: string },
  ): Promise<EditorReply<WatchReport>>;
  release(input: { session: string }): Promise<void>;
  restore(
    input: { document: string; version: string; request_key: string },
  ): Promise<EditorReply<RestoreReport>>;
  create(input: EditorCreate): Promise<EditorReply<CreateReport>>;
  place(
    input: {
      document: string;
      version: string;
      project: string;
      path: string;
      request_key: string;
    },
  ): Promise<EditorReply<PlaceReport>>;
  counts(input: EditorCounts): void;
  /** main이 창 닫기를 묻는다. 해제는 반환 함수다. */
  onCloseRequest(listener: (request: number) => void): () => void;
  answerClose(request: number, answer: CloseAnswer): void;
}
