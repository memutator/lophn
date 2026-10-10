// 버전 복원의 main 통로(shell/editor#R14, flow restore-document). renderer는 문서 id와 고른 판
// id만 보낸다. 준비(`documents/prepare`)·파일 쓰기·판 바이트 읽기는 renderer allowlist 밖이라
// 여기서만 부른다. 복원의 뜻은 documents/versions를 따른다: 고른 판의 원문 blob 참조와 정확한
// FormatRef로 준비하고 `document.restore`가 최신 판·revision CAS로 새 판을 만든다. 원본 연결
// 문서는 고른 판의 바이트를 파일에 먼저 쓰고(files/write, 지금 디스크 hash로 CAS) 그 쓰기의
// 관측을 근거로 확정한다. 결과(새 판, 같아서 변경 없음, 충돌)는 꾸미지 않고 그대로 돌려준다.
import type {
  EditorReply,
  RestoreFile,
  RestoreReport,
} from "../../ipc/editor.ts";
import {
  type FilesPort,
  type FileTarget,
  type PortError,
  type PortResult,
  sha256,
} from "./file-adapter.ts";

// shell tsc는 contracts를 보지 않는다. contract output에서 이 통로가 읽는 field만 옮긴다.

export type FileSource =
  | { kind: "project_file"; project: string; path: string }
  | {
    kind: "instruction_file";
    instruction_target: string;
    project: string | null;
    path: string;
  };

export interface StoredFile {
  path: string;
  blob_hash: string;
  bytes: number;
  media_type: string;
  primary: boolean;
}

export interface FormatRef {
  name: string;
  module_hash: string;
  explicit: boolean;
}

/** documents.get(고정 판 포함)에서 복원이 읽는 것. */
export interface FixedRead {
  document: {
    id: string;
    latest_version: string;
    revision: string;
    status: string;
    file_source: FileSource | null;
  };
  version: {
    id: string;
    number: number;
    content_hash: string;
    files: StoredFile[] | { hash: string };
    format: FormatRef;
  };
}

/** 준비 결과. 그대로 `document.restore` 입력에 싣는다. */
export interface PreparedRestore {
  preparation_ref: string;
  idempotency_key: string;
  [field: string]: unknown;
}

export interface RestoreSaved {
  status: "saved" | "unchanged";
  version: string;
}

/** 복원이 쓰는 core 통로. main이 core session으로 만든다. */
export interface RestorePort
  extends
    Pick<FilesPort, "read" | "versionFile" | "upload" | "write" | "watch"> {
  fixed(document: string, version?: string): Promise<PortResult<FixedRead>>;
  project(id: string): Promise<PortResult<{ revision: string }>>;
  prepare(input: unknown): Promise<PortResult<PreparedRestore>>;
  restore(request: unknown): Promise<PortResult<RestoreSaved>>;
}

export interface RestorerOptions {
  /** 연결된 core가 없으면 null이다. 그때 복원은 offline이다. */
  port: () => RestorePort | null;
  hash?: (bytes: Uint8Array) => string;
  log?: (message: string) => void;
}

export interface Restorer {
  restore(input: {
    document: string;
    version: string;
    /** 사람이 비교로 본 최신 판. 파일 hash 기준도 이 판의 원문에서 나온다. */
    base_version: string;
    request_key: string;
  }): Promise<EditorReply<RestoreReport>>;
}

/** 원본 파일로 쓸 판 바이트의 상한. documents upload 상한(256 MiB)보다 작게 main 메모리에 둔다. */
export const RESTORE_MAX_BYTES = 64 * 1024 * 1024;
/** 관측 loop가 그 사이 판을 만들면 새 기준으로 다시 묻는 횟수. */
const CONFIRM_ATTEMPTS = 3;

function report(
  outcome: RestoreReport["outcome"],
  over: Partial<RestoreReport> = {},
): RestoreReport {
  return { outcome, version: null, file: null, failure: null, ...over };
}

/** 응답이 오지 않았다. 판이 확정됐는지 모른다. */
function connectionLost(error: PortError): boolean {
  return error.code === "offline" ||
    (error.code === "unavailable" &&
      error.details?.["reason"] === "transport_failed");
}

function failedWith(
  error: PortError,
  file: RestoreFile | null = null,
): RestoreReport {
  // 연결이 끊기면 확인하지 못한 판 확정을 성공이나 확정 실패로 채우지 않는다.
  if (connectionLost(error)) {
    return report("failed", { file, failure: "offline" });
  }
  if (error.code === "conflict") return report("conflict", { file });
  return report(file === "written" ? "pending" : "failed", {
    file,
    failure: error.code === "unauthorized" ? "forbidden" : error.code,
  });
}

function targetOf(source: FileSource): FileTarget {
  return source.kind === "project_file"
    ? { kind: "project_file", project: source.project, path: source.path }
    : {
      kind: "instruction_file",
      instruction_target: source.instruction_target,
      project: source.project,
      path: source.path,
    };
}

/** 고른 판의 경로별 원문 blob을 그대로 가리키는 준비 입력. 새 바이트는 올리지 않는다. */
function existingFiles(version: FixedRead["version"], files: StoredFile[]) {
  return files.map((file) => ({
    path: file.path,
    blob_hash: file.blob_hash,
    bytes: file.bytes,
    media_type: file.media_type,
    primary: file.primary,
    content: {
      kind: "existing",
      reference: {
        owner_kind: "document_version",
        owner_key: `${version.id}/${file.path}`,
        field: "file",
        hash: file.blob_hash,
        registered_seq: "1",
      },
    },
  }));
}

function sameContent(left: FixedRead["version"], right: FixedRead["version"]) {
  return left.content_hash === right.content_hash &&
    left.format.name === right.format.name &&
    left.format.module_hash === right.format.module_hash &&
    left.format.explicit === right.format.explicit;
}

interface Observation {
  original_hash: string;
  observed_at: string;
}

export function createRestorer(options: RestorerOptions): Restorer {
  const hash = options.hash ?? sha256;
  const log = options.log ?? ((message) => console.log(`[lophn] ${message}`));

  // 준비와 확정. 관측 loop가 그 사이 판을 만들어 기준이 바뀌면 새 기준으로 다시 묻는다.
  async function confirm(
    port: RestorePort,
    selected: FixedRead,
    files: StoredFile[],
    key: string,
    observed: Observation | null,
    file: RestoreFile | null,
    shownBase: string,
  ): Promise<RestoreReport> {
    for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
      const latest = await port.fixed(selected.document.id);
      if (!latest.ok) return failedWith(latest.error, file);
      const document = latest.value.document;
      if (document.status !== "active") return report("conflict", { file });
      // 원본이 없는 문서는 사람이 비교로 본 판 위에서만 확정한다. 그 사이 판이 생기면 새 기준으로
      // 조용히 다시 묻지 않고 멈춰 다시 비교하게 한다. 원본 연결 문서는 쓰기 전에 같은 검사를 했고
      // 쓴 뒤의 새 판은 이 복원의 관측일 수 있어 관측 근거로 확정한다.
      if (observed === null && document.latest_version !== shownBase) {
        return report("conflict", { file });
      }
      const source = document.file_source;
      let basis: Record<string, unknown> | null = null;
      if (observed !== null && source !== null) {
        if (source.kind !== "project_file") {
          // 지침 파일은 관측 loop가 판을 정한다. 이 통로는 기다리지 않는다.
          return report("pending", { file });
        }
        const project = await port.project(source.project);
        if (!project.ok) return failedWith(project.error, file);
        basis = {
          source: {
            kind: "file",
            project: source.project,
            path: source.path,
            ...observed,
          },
          file_basis: {
            kind: "project_file",
            project: source.project,
            path: source.path,
            document_revision: document.revision,
            document_status: "active",
            ...observed,
            project_revision: project.value.revision,
            file_source: source,
          },
        };
      }
      const idempotency = attempt === 0 ? key : `${key}-${attempt}`;
      const prepared = await port.prepare({
        document: document.id,
        base_version: document.latest_version,
        files: existingFiles(selected.version, files),
        format: selected.version.format,
        source: basis === null ? null : basis.source,
        ...(basis === null ? {} : { file_basis: basis.file_basis }),
        idempotency_key: idempotency,
      });
      if (!prepared.ok) {
        if (prepared.error.code === "conflict" && observed !== null) continue;
        return failedWith(prepared.error, file);
      }
      const restored = await port.restore({
        input: {
          document: document.id,
          restore_version: selected.version.id,
          prepared: prepared.value,
        },
        idempotency_key: prepared.value.idempotency_key,
        compare: {
          base_version: document.latest_version,
          base_revision: document.revision,
        },
        prepared: [prepared.value.preparation_ref],
      });
      if (restored.ok) {
        // 쓴 바이트로 관측 loop가 먼저 판을 만들었으면 복원 명령은 같은 내용이라 unchanged다.
        // 그 판은 이 복원이 만든 것이다(시작할 때의 최신 판이 아니다).
        const made = restored.value.status === "unchanged" &&
          file === "written" &&
          restored.value.version !== selected.document.latest_version;
        return report(made ? "saved" : restored.value.status, {
          version: restored.value.version,
          file,
        });
      }
      if (restored.error.code !== "conflict") {
        return failedWith(restored.error, file);
      }
      // 원본 연결 문서는 관측 loop가 같은 바이트로 판을 먼저 만들 수 있다. 그 판이 고른 판의
      // 내용·형식이면 복원은 그 판으로 끝났다. 아니면 기준이 바뀐 것이라 다시 묻는다.
      const after = await port.fixed(selected.document.id);
      if (!after.ok) return failedWith(after.error, file);
      if (
        observed !== null &&
        after.value.version.id !== selected.version.id &&
        sameContent(after.value.version, selected.version)
      ) {
        return report("saved", { version: after.value.version.id, file });
      }
      if (observed === null) return report("conflict", { file });
    }
    return report("conflict", { file });
  }

  // 원본 연결 문서: 고른 판의 대표 파일 바이트를 원본 파일 위에 쓴다. 쓰기 기준 hash는 지금 디스크가
  // 아니라 사람이 비교로 본 최신 판의 원문 hash(expected)다. 디스크가 그 hash가 아니면 바깥 편집이
  // 아직 판이 되지 않았어도 쓰지 않고 충돌로 멈춘다(file-tracking#R11). 쓰기는 같은 hash로 시작 때와
  // 교체 직전에 다시 대조된다. 디스크가 이미 고른 바이트면 쓰지 않거나 같은 바이트를 다시 쓴다.
  async function writeOriginal(
    port: RestorePort,
    selected: FixedRead,
    source: FileSource,
    primary: StoredFile,
    key: string,
    expected: string,
  ): Promise<
    | { ok: true; file: "written"; observed: Observation }
    | { ok: false; report: RestoreReport }
  > {
    const target = targetOf(source);
    const current = await port.read(target, RESTORE_MAX_BYTES);
    let disk: string | null;
    if (current.ok) disk = hash(current.value);
    else if (current.error.code === "not_found") disk = null;
    else return { ok: false, report: failedWith(current.error) };
    if (disk !== expected && disk !== primary.blob_hash) {
      return { ok: false, report: report("conflict", { file: "conflict" }) };
    }
    if (disk === primary.blob_hash) {
      // 디스크가 이미 그 바이트이고 최신 판도 같은 내용이면 할 일이 없다(새 판을 만들지 않는다).
      const latest = await port.fixed(selected.document.id);
      if (!latest.ok) return { ok: false, report: failedWith(latest.error) };
      if (sameContent(latest.value.version, selected.version)) {
        return {
          ok: false,
          report: report("unchanged", {
            version: latest.value.version.id,
            file: "same",
          }),
        };
      }
      // 디스크만 같고 판은 다르다. 같은 바이트를 다시 써서 새 관측을 근거로 삼는다.
    }
    const bytes = await port.versionFile(
      selected.version.id,
      primary.path,
      RESTORE_MAX_BYTES,
    );
    if (!bytes.ok) return { ok: false, report: failedWith(bytes.error) };
    if (hash(bytes.value) !== primary.blob_hash) {
      return {
        ok: false,
        report: report("failed", { failure: "unavailable" }),
      };
    }
    const blob = await port.upload(bytes.value, primary.blob_hash);
    if (!blob.ok) return { ok: false, report: failedWith(blob.error) };
    const written = await port.write({
      request_key: `${key}-w`,
      target,
      base_hash: disk,
      content: { kind: "prepared", blob: blob.value },
    });
    if (!written.ok) {
      // 쓰기 응답을 잃으면 파일이 바뀌었는지 모른다. 확정된 저장이 아니다.
      if (connectionLost(written.error)) {
        return {
          ok: false,
          report: failedWith(written.error, "unknown"),
        };
      }
      return {
        ok: false,
        report: written.error.code === "conflict"
          ? report("conflict", { file: "conflict" })
          : failedWith(written.error, "failed"),
      };
    }
    const value = written.value;
    if (value.outcome === "unverified") {
      return {
        ok: false,
        report: report("failed", { file: "unknown", failure: "unknown" }),
      };
    }
    if (
      value.observed_hash !== primary.blob_hash || value.observed_at === null ||
      value.changed_again === true
    ) {
      // 쓴 뒤 그 사이 파일이 또 바뀌었다. 낡은 관측으로 판을 확정하지 않는다.
      return { ok: false, report: report("conflict", { file: "written" }) };
    }
    return {
      ok: true,
      file: "written",
      observed: {
        original_hash: primary.blob_hash,
        observed_at: value.observed_at,
      },
    };
  }

  return {
    async restore(input) {
      const port = options.port();
      if (port === null) return { ok: false, code: "offline" };
      const selected = await port.fixed(input.document, input.version);
      if (!selected.ok) {
        if (connectionLost(selected.error)) {
          return { ok: false, code: "offline" };
        }
        const code = selected.error.code;
        return {
          ok: false,
          code: code === "not_found" || code === "forbidden" ||
              code === "invalid_input"
            ? code
            : code === "unauthorized"
            ? "forbidden"
            : "unavailable",
        };
      }
      const files = selected.value.version.files;
      // 경로별 원문 행이 없는 옛 판은 원문 참조로 준비할 수 없다.
      if (!Array.isArray(files)) return { ok: false, code: "unsupported" };
      const source = selected.value.document.file_source;
      // 비교로 본 최신 판이 아니면 낡은 기준이다. 쓰기 전에 멈춘다(flow restore-document 5).
      if (selected.value.document.latest_version !== input.base_version) {
        return { ok: true, value: report("conflict") };
      }
      try {
        if (source === null) {
          return {
            ok: true,
            value: await confirm(
              port,
              selected.value,
              files,
              input.request_key,
              null,
              null,
              input.base_version,
            ),
          };
        }
        const primary = files.find((file) => file.primary);
        // 원본 파일 하나에 쓸 수 있는 판만 연결 문서로 되살린다.
        if (primary === undefined || files.length !== 1) {
          return { ok: false, code: "unsupported" };
        }
        // 파일 hash 기준은 비교로 본 최신 판의 원문이다.
        const shown = input.base_version === input.version
          ? selected
          : await port.fixed(input.document, input.base_version);
        if (!shown.ok) return { ok: true, value: failedWith(shown.error) };
        const shownFiles = shown.value.version.files;
        const shownPrimary = Array.isArray(shownFiles)
          ? shownFiles.find((file) => file.primary)
          : undefined;
        if (shownPrimary === undefined) {
          return { ok: false, code: "unsupported" };
        }
        const written = await writeOriginal(
          port,
          selected.value,
          source,
          primary,
          input.request_key,
          shownPrimary.blob_hash,
        );
        if (!written.ok) return { ok: true, value: written.report };
        return {
          ok: true,
          value: await confirm(
            port,
            selected.value,
            files,
            input.request_key,
            written.observed,
            written.file,
            input.base_version,
          ),
        };
      } catch (error) {
        log(`복원을 끝내지 못했다: ${(error as Error).message}`);
        return { ok: false, code: "unavailable" };
      }
    },
  };
}
