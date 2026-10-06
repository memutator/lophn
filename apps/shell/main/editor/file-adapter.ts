// 편집기의 파일 adapter(shell/editor#R1, R2, R12). renderer는 문서 id와 session handle만 보내고,
// main이 documents의 파일 통로(documents#T12 `/v1/files/*`)를 부른다. 목표(FileTarget)·경로·
// core port는 여기에만 있다. 원자 교체·hash 비교·version 준비는 documents가 하고 이 adapter는
// 결과를 단계별로 옮길 뿐이다. 결과를 모르는 쓰기는 다시 쓰지 않고 documents 상태부터 본다.
import { createHash, randomBytes } from "node:crypto";

import {
  type CurrentFile,
  EDITOR_MAX_BYTES,
  type EditorDiagnostic,
  type EditorFailure,
  type EditorOpened,
  type EditorReply,
  type EditorWrite,
  type FileState,
  type FileTargetKind,
  type LookupReport,
  type SaveReport,
  type VersionOutcome,
  type WatchReport,
} from "../../ipc/editor.ts";

// shell tsc는 contracts를 보지 않는다. contract output에서 이 adapter가 읽는 field만 옮긴다.
// 실제 검사는 port 구현(main의 contract client)이 route schema로 이미 했다.

export type PortError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};
export type PortResult<T> = { ok: true; value: T } | {
  ok: false;
  error: PortError;
};

export type FileTarget =
  | { kind: "project_file"; project: string; path: string }
  | { kind: "working_copy"; document: string }
  | {
    kind: "instruction_file";
    instruction_target: string;
    project: string | null;
    path: string;
  };

/** documents.get에서 adapter가 읽는 것. */
export interface DocumentRead {
  document: {
    id: string;
    latest_version: string;
    file_source:
      | { kind: "project_file"; project: string; path: string }
      | {
        kind: "instruction_file";
        instruction_target: string;
        project: string | null;
        path: string;
      }
      | null;
  };
  version: {
    id: string;
    files:
      | { path: string; primary: boolean; media_type: string }[]
      | { hash: string };
    format: { name: string; module_hash: string; explicit: boolean };
  };
}

export interface PreparedBlob {
  preparation: string;
  principal: string;
  purpose: string;
  hash: string;
  size_bytes: number;
}

export interface FileStatus {
  state: FileState;
  observed_at: string;
  observed_hash: string | null;
  compared_version: string | null;
}

export interface FileOperationResult {
  outcome: "written" | "renamed" | "deleted" | "unverified";
  written_hash: string | null;
  observed_hash: string | null;
  observed_at: string | null;
  changed_again: boolean | null;
  recording: "recorded" | "unverified";
  version_result: VersionOutcome;
  save_result?: { version: string };
  latest_version?: string;
}

export interface WriteRequest {
  request_key: string;
  target: FileTarget;
  base_hash: string | null;
  content: { kind: "prepared"; blob: PreparedBlob };
  version_request?: {
    document: string;
    base_version: string | null;
    idempotency_key: string;
  };
}

export interface ValidateInput {
  name: string;
  module_hash: string;
  files: {
    path: string;
    media_type: string;
    bytes: number;
    blob_hash: string;
    primary: boolean;
    content: { kind: "prepared"; blob: PreparedBlob };
  }[];
  input_hash: string;
  explicit: boolean;
  cursor?: string;
}

export interface ValidatePage {
  status: "passed" | "failed";
  diagnostics: EditorDiagnostic[];
  complete: boolean;
  next_cursor: string | null;
}

/** documents 파일 통로. main이 core session으로 만든다. */
export interface FilesPort {
  document(id: string): Promise<PortResult<DocumentRead>>;
  /** `/v1/files/read` stream. limit을 넘으면 too_large로 끊는다. */
  read(target: FileTarget, limit: number): Promise<PortResult<Uint8Array>>;
  /** `/v1/documents/file`: 판에 고정된 파일 바이트. */
  versionFile(
    version: string,
    path: string,
    limit: number,
  ): Promise<PortResult<Uint8Array>>;
  watch(
    target: FileTarget,
    cursor: string | undefined,
  ): Promise<PortResult<{ status: FileStatus; next_cursor: string }>>;
  upload(bytes: Uint8Array, hash: string): Promise<PortResult<PreparedBlob>>;
  write(request: WriteRequest): Promise<PortResult<FileOperationResult>>;
  validate(input: ValidateInput): Promise<PortResult<ValidatePage>>;
}

export interface FileAdapterOptions {
  /** 연결된 core가 없으면 null이다. 그때 쓰기는 offline이다. */
  port: () => FilesPort | null;
  hash?: (bytes: Uint8Array) => string;
  newHandle?: () => string;
  log?: (message: string) => void;
}

export interface FileAdapter {
  open(owner: number, document: string): Promise<EditorReply<EditorOpened>>;
  write(owner: number, input: EditorWrite): Promise<EditorReply<SaveReport>>;
  lookup(
    owner: number,
    input: { session: string; request_key: string },
  ): Promise<EditorReply<LookupReport>>;
  current(
    owner: number,
    input: { session: string },
  ): Promise<EditorReply<CurrentFile>>;
  watch(
    owner: number,
    input: { session: string; cursor?: string },
  ): Promise<EditorReply<WatchReport>>;
  release(owner: number, session: string): void;
  /** 창이 사라지면 그 창의 session을 모두 놓는다. */
  dropOwner(owner: number): void;
  /** 지금 core로 가는 중인 쓰기 수. */
  inFlight(): number;
}

interface Session {
  readonly owner: number;
  readonly document: string;
  readonly target: FileTarget;
  readonly primaryPath: string | null;
  readonly mediaType: string | null;
  readonly format: { name: string; module_hash: string; explicit: boolean };
  /** 다음 판 확정의 기준 판. 확정되면 그 판으로 옮긴다. */
  baseVersion: string | null;
  /** 결과를 모르는 쓰기. request_key → 그때 보낸 hash와 기준. */
  readonly attempts: Map<string, { hash: string; base: string | null }>;
}

// documents/formats의 글 형식 이름. 편집기는 글만 열므로 이 밖이면 형식 검사를 부르지 않는다.
const BUILTIN_FORMATS = new Set(["document", "data"]);
const ATTEMPT_MEMORY = 16;

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function handle(): string {
  return `es_${randomBytes(18).toString("base64url")}`;
}

/** documents/versions canonical files JSON(고정 필드, 경로 순, 키 codepoint 순). */
export function canonicalFilesHash(
  files: readonly {
    blob_hash: string;
    bytes: number;
    media_type: string;
    path: string;
    primary: boolean;
  }[],
  hash: (bytes: Uint8Array) => string = sha256,
): string {
  const ordered = [...files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
  const json = `[${
    ordered.map((file) =>
      `{${
        (["blob_hash", "bytes", "media_type", "path", "primary"] as const).map(
          (field) => `${JSON.stringify(field)}:${JSON.stringify(file[field])}`,
        ).join(",")
      }}`
    ).join(",")
  }]`;
  return hash(new TextEncoder().encode(json));
}

function targetOf(read: DocumentRead): FileTarget {
  const source = read.document.file_source;
  if (source === null) {
    return { kind: "working_copy", document: read.document.id };
  }
  if (source.kind === "project_file") {
    return {
      kind: "project_file",
      project: source.project,
      path: source.path,
    };
  }
  return {
    kind: "instruction_file",
    instruction_target: source.instruction_target,
    project: source.project,
    path: source.path,
  };
}

function primaryOf(read: DocumentRead) {
  const files = Array.isArray(read.version.files) ? read.version.files : [];
  return files.length === 1 && files[0]!.primary ? files[0]! : null;
}

function failure(code: string): EditorFailure {
  switch (code) {
    case "invalid_input":
    case "forbidden":
    case "not_found":
    case "unavailable":
    case "offline":
    case "unsupported":
    case "too_large":
      return code;
    case "unauthorized":
      return "forbidden";
    default:
      return "unavailable";
  }
}

/** 응답이 오지 않은 실패. 쓰기가 일어났는지 모른다. */
function transportLost(error: PortError): boolean {
  return error.code === "unavailable" &&
    error.details?.["reason"] === "transport_failed";
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function decode(bytes: Uint8Array): string | null {
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

function emptyReport(disk: SaveReport["disk"], failure: string): SaveReport {
  return {
    disk,
    written_hash: null,
    observed_hash: null,
    observed_at: null,
    changed_again: null,
    recording: null,
    version: null,
    saved_version: null,
    latest_version: null,
    problems: null,
    failure,
  };
}

export function createFileAdapter(options: FileAdapterOptions): FileAdapter {
  const hash = options.hash ?? sha256;
  const newHandle = options.newHandle ?? handle;
  const log = options.log ?? ((message) => console.log(`[lophn] ${message}`));
  const sessions = new Map<string, Session>();
  let writing = 0;

  function own(owner: number, id: string): Session | undefined {
    const found = sessions.get(id);
    return found && found.owner === owner ? found : undefined;
  }

  async function readText(
    port: FilesPort,
    session: Omit<Session, "attempts" | "owner"> & { latest: string },
  ): Promise<EditorReply<{ text: string; hash: string | null }>> {
    const read = await port.read(session.target, EDITOR_MAX_BYTES);
    let bytes: Uint8Array;
    let base: string | null;
    if (read.ok) {
      bytes = read.value;
      base = hash(bytes);
    } else if (
      read.error.code === "not_found" &&
      session.target.kind === "working_copy" && session.primaryPath !== null
    ) {
      // working copy는 첫 쓰기에서 생긴다. 그 전에는 연 판의 주 파일이 시작 글이다.
      const fixed = await port.versionFile(
        session.latest,
        session.primaryPath,
        EDITOR_MAX_BYTES,
      );
      if (!fixed.ok) return { ok: false, code: failure(fixed.error.code) };
      bytes = fixed.value;
      base = null;
    } else {
      return { ok: false, code: failure(read.error.code) };
    }
    const text = decode(bytes);
    if (text === null) return { ok: false, code: "unsupported" };
    return { ok: true, value: { text, hash: base } };
  }

  // 종료 쓰기 뒤의 형식 검사. 판 확정과 따로 기억한다. 돌리지 못하면 null이다.
  async function check(
    port: FilesPort,
    session: Session,
    blob: PreparedBlob,
    bytes: number,
  ): Promise<EditorDiagnostic[] | null> {
    if (
      session.primaryPath === null || session.mediaType === null ||
      !BUILTIN_FORMATS.has(session.format.name)
    ) return null;
    const file = {
      path: session.primaryPath,
      media_type: session.mediaType,
      bytes,
      blob_hash: blob.hash,
      primary: true,
    };
    const input: ValidateInput = {
      name: session.format.name,
      module_hash: session.format.module_hash,
      files: [{ ...file, content: { kind: "prepared", blob } }],
      input_hash: canonicalFilesHash([file], hash),
      explicit: session.format.explicit,
    };
    const found: EditorDiagnostic[] = [];
    for (let page = 0; page < 20; page += 1) {
      const answered = await port.validate(input);
      if (!answered.ok) {
        log(`형식 검사를 돌리지 못했다: ${answered.error.code}`);
        return null;
      }
      for (const item of answered.value.diagnostics) {
        found.push({
          severity: item.severity,
          message: item.message,
          file: item.file,
          start_line: item.start_line,
        });
      }
      if (answered.value.complete || answered.value.next_cursor === null) {
        return found;
      }
      input.cursor = answered.value.next_cursor;
    }
    return found;
  }

  return {
    async open(owner, document) {
      const port = options.port();
      if (port === null) return { ok: false, code: "offline" };
      const read = await port.document(document);
      if (!read.ok) return { ok: false, code: failure(read.error.code) };
      const primary = primaryOf(read.value);
      const base = {
        document,
        target: targetOf(read.value),
        primaryPath: primary?.path ?? null,
        mediaType: primary?.media_type ?? null,
        format: read.value.version.format,
        baseVersion: read.value.document.latest_version,
        latest: read.value.document.latest_version,
      };
      const text = await readText(port, base);
      if (!text.ok) return text;
      const id = newHandle();
      sessions.set(id, {
        owner,
        document,
        target: base.target,
        primaryPath: base.primaryPath,
        mediaType: base.mediaType,
        format: base.format,
        baseVersion: base.baseVersion,
        attempts: new Map(),
      });
      return {
        ok: true,
        value: {
          session: id,
          text: text.value.text,
          base_hash: text.value.hash,
          target: base.target.kind as FileTargetKind,
          primary_path: base.primaryPath,
        },
      };
    },

    async write(owner, input) {
      const session = own(owner, input.session);
      if (!session) return { ok: false, code: "unknown_session" };
      const port = options.port();
      if (port === null) {
        return { ok: true, value: emptyReport("failed", "offline") };
      }
      const written = hash(input.bytes);
      session.attempts.set(input.request_key, {
        hash: written,
        base: input.base_hash,
      });
      while (session.attempts.size > ATTEMPT_MEMORY) {
        session.attempts.delete(session.attempts.keys().next().value!);
      }
      writing += 1;
      try {
        // 바이트는 먼저 core blob 준비로 올리고, 쓰기는 그 준비 참조를 가리킨다.
        const blob = await port.upload(input.bytes, written);
        if (!blob.ok) {
          // 업로드가 실패하면 파일 쓰기 요청은 나가지 않았다.
          return {
            ok: true,
            value: emptyReport("failed", failure(blob.error.code)),
          };
        }
        if (input.end && input.base_version !== undefined) {
          session.baseVersion = input.base_version;
        }
        const request: WriteRequest = {
          request_key: input.request_key,
          target: session.target,
          base_hash: input.base_hash,
          content: { kind: "prepared", blob: blob.value },
          ...(input.end
            ? {
              version_request: {
                document: session.document,
                base_version: session.baseVersion,
                idempotency_key: `${input.request_key}-v`,
              },
            }
            : {}),
        };
        const result = await port.write(request);
        if (!result.ok) {
          const lost = transportLost(result.error);
          return {
            ok: true,
            value: emptyReport(
              lost
                ? "unknown"
                : result.error.code === "conflict"
                ? "conflict"
                : "failed",
              lost ? "unknown" : result.error.code,
            ),
          };
        }
        const value = result.value;
        if (value.outcome === "unverified") {
          return { ok: true, value: emptyReport("unknown", "unknown") };
        }
        session.attempts.delete(input.request_key);
        if (value.save_result !== undefined) {
          session.baseVersion = value.save_result.version;
        }
        const problems = input.end
          ? await check(port, session, blob.value, input.bytes.byteLength)
          : null;
        return {
          ok: true,
          value: {
            disk: "written",
            written_hash: value.written_hash,
            observed_hash: value.observed_hash,
            observed_at: value.observed_at,
            changed_again: value.changed_again,
            recording: value.recording,
            version: input.end ? value.version_result : null,
            saved_version: value.save_result?.version ?? null,
            latest_version: value.latest_version ?? null,
            problems,
            failure: null,
          },
        };
      } finally {
        writing -= 1;
      }
    },

    async lookup(owner, input) {
      const session = own(owner, input.session);
      if (!session) return { ok: false, code: "unknown_session" };
      const attempt = session.attempts.get(input.request_key);
      const port = options.port();
      if (!attempt || port === null) {
        return {
          ok: true,
          value: { state: "unknown", observed_hash: null, observed_at: null },
        };
      }
      // 지금 디스크 바이트를 documents 파일 통로로 읽어 그 hash를 본다. 추적을 끈 폴더는
      // 관측 상태(files.status)에 hash가 없어서 상태만으로는 가릴 수 없다.
      const read = await port.read(session.target, EDITOR_MAX_BYTES);
      let observed: string | null;
      if (read.ok) observed = hash(read.value);
      else if (read.error.code === "not_found") observed = null;
      else {
        return {
          ok: true,
          value: { state: "unknown", observed_hash: null, observed_at: null },
        };
      }
      const state: LookupReport["state"] = observed === attempt.hash
        ? "written"
        : observed === attempt.base
        ? "not_written"
        : "changed";
      if (state !== "written") session.attempts.delete(input.request_key);
      return {
        ok: true,
        value: {
          state,
          observed_hash: observed,
          observed_at: new Date().toISOString(),
        },
      };
    },

    async current(owner, input) {
      const session = own(owner, input.session);
      if (!session) return { ok: false, code: "unknown_session" };
      const port = options.port();
      if (port === null) return { ok: false, code: "offline" };
      const read = await readText(port, {
        ...session,
        latest: session.baseVersion ?? "",
      });
      return read.ok
        ? { ok: true, value: { text: read.value.text, hash: read.value.hash } }
        : read;
    },

    async watch(owner, input) {
      const session = own(owner, input.session);
      if (!session) return { ok: false, code: "unknown_session" };
      const port = options.port();
      if (port === null) return { ok: false, code: "offline" };
      const watched = await port.watch(session.target, input.cursor);
      if (!watched.ok) return { ok: false, code: failure(watched.error.code) };
      const status = watched.value.status;
      return {
        ok: true,
        value: {
          state: status.state,
          observed_hash: status.observed_hash,
          observed_at: status.observed_at,
          compared_version: status.compared_version,
          cursor: watched.value.next_cursor,
        },
      };
    },

    release(owner, id) {
      if (own(owner, id)) sessions.delete(id);
    },

    dropOwner(owner) {
      for (const [id, session] of sessions) {
        if (session.owner === owner) sessions.delete(id);
      }
    },

    inFlight: () => writing,
  };
}
