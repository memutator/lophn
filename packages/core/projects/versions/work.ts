// 파일 준비 조립(`document.prepare` worker의 handler). 호출자 자격·요청·기준을 받아
// 안전한 상대 경로·유일 경로·대표 파일 하나·바이트 수를 검사하고, 같은 stream을 hash와
// blob 준비로 보내며, canonical 목록 blob과 format validate 뒤 preparation_ref를
// 원래 요청·기준·blob에 묶은 PreparedVersion을 돌려준다.
// core는 파일을 다시 읽지 않는다. 여기도 파일을 읽지 않는다. 준비 worker가 파일을 읽고
// guest 입력으로 바꿔 넘긴다(reads.ts의 파일 바이트는 준비 worker 몫이다).
// 명시 format의 error는 invalid_input으로 거절(사전 validate와 같은 오류)하고 warning은
// 결과에 남긴다. 미지정 새 문서는 MIME 기본 format이고 구조 error는 warning으로 내려가며,
// 위험 경로·접근 실패·runner 실패는 낮추지 않는다. format을 생략한 후속 저장도 그 판의
// explicit를 따른다. 옛 module은 보존 목록에서 찾는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  ContentFile,
  Document,
  DocumentFileInput,
  FileObservationBasis,
  FormatDiagnostic,
  FormatRef,
  PreparedVersion,
} from "../../../protocol/projects/mod.ts";
import {
  BUILTIN_MODULE_HASH,
  CHECK_SKIPPED_CODE,
  formatForMediaType,
} from "../formats/mod.ts";
import { existingFileSource } from "./commands.ts";
import type { VersionRow } from "./store.ts";

// prepare worker가 파일 목록 검사를 부르는 정본(file-tracking의 T8 몫).
import { checkFileList, type FileListIssue } from "../file-tracking/mod.ts";

export type ValidateOutcome = {
  input_hash: string;
  module_hash: string;
  status: "passed" | "failed";
  error_count: number;
  warning_count: number;
  diagnostics: FormatDiagnostic[];
};

export type ValidateError = {
  code: "not_found" | "invalid_input" | "unavailable";
  message: string;
};

// validate port. 운영 wiring은 formats read(T4)의 format.validate pipe고, 테스트는
// outcome을 주입한다. 파일 바이트는 준비 worker가 guest 입력으로 바꿔 넘긴다.
export type ValidatePort = (
  files: readonly ContentFile[],
  format: FormatRef,
) => Promise<Result<ValidateOutcome, ValidateError>>;

export type PrepareFilesError = { code: string; message: string };

// canonical 목록 blob을 package하는 port. 같은 stream을 hash와 blob 준비로 보낸다.
export type PrepareFilesPort = (
  files: readonly ContentFile[],
) => Promise<
  Result<
    { preparation: string; hash: string; size_bytes: number },
    PrepareFilesError
  >
>;

// 옛 문서의 계약 생략은 base_version의 정확한 FormatRef다.
export type BaseVersionRead = (
  baseVersion: string,
) => Promise<Result<VersionRow | null>>;

export type PrepareDeps = {
  validateFiles: ValidatePort;
  prepareFiles: PrepareFilesPort;
  loadBaseVersion: BaseVersionRead;
};

export type PrepareRequest = {
  document: string;
  base_version: string | null;
  metadata?: PreparedVersion["metadata"];
  files: readonly DocumentFileInput[];
  format?: FormatRef;
  file_basis?: unknown;
  source: PreparedVersion["source"];
  idempotency_key: string;
};

// 조립이 내놓는 준비 결과. preparedVersionSchema와 같은 모양이되, 진단은
// 항상 목록(보류 blob 참조가 아님)이다.
export type PreparedResult = Omit<PreparedVersion, "validation"> & {
  validation: Omit<PreparedVersion["validation"], "diagnostics"> & {
    diagnostics: FormatDiagnostic[];
  };
};

export type PrepareError = { code: string; message: string };

// explicit가 아닌 format에서 구조 진단이 warning으로 내려간다(R5). 나머지 class는 그대로다.
const STRUCTURE_CODES = new Set(["invalid_structure", "duplicate_anchor"]);

function recastDiagnostic(
  diagnostic: FormatDiagnostic,
  implicit: boolean,
): FormatDiagnostic {
  if (!implicit || !STRUCTURE_CODES.has(diagnostic.code)) return diagnostic;
  return { ...diagnostic, severity: "warning" as const };
}

// 옛 문서 생략은 base_version의 정확한 FormatRef다. 신규 생략은 MIME 기본 format이다.
async function resolveFormat(
  request: PrepareRequest,
  primary: ContentFile,
  deps: PrepareDeps,
): Promise<Result<FormatRef, PrepareError>> {
  if (request.format !== undefined) return ok(request.format);
  if (request.base_version === null) {
    return ok({
      name: formatForMediaType(primary.media_type),
      module_hash: BUILTIN_MODULE_HASH,
      explicit: false,
    });
  }
  const base = await deps.loadBaseVersion(request.base_version);
  if (!base.ok) {
    return err({ code: "internal", message: "base version read failed" });
  }
  if (base.value === null) {
    return err({ code: "not_found", message: "base version not found" });
  }
  return ok(base.value.format);
}

function fileToContent(file: DocumentFileInput, primary: boolean): ContentFile {
  return {
    path: file.path,
    blob_hash: file.blob_hash,
    bytes: file.bytes,
    media_type: file.media_type,
    primary,
  };
}

function invalidIssues(issues: readonly FileListIssue[]): PrepareError {
  const first = issues[0];
  return {
    code: "invalid_input",
    message: `${first.code}: ${first.message}`,
  };
}

// 이 준비가 이미 받아들인 판의 restore인지. 모든 파일이 같은 판의 원문 blob 참조(`existing`)
// 이고 그 판의 파일 목록 hash·정확한 FormatRef와 같으면, 그 내용은 이 FormatRef 아래 이미
// 저장돼 있다. 판을 읽지 못하거나(권한 밖 포함) 하나라도 다르면 restore가 아니다.
async function restoresAcceptedVersion(
  request: PrepareRequest,
  format: FormatRef,
  filesHash: string,
  deps: PrepareDeps,
): Promise<boolean> {
  let version: string | undefined;
  for (const file of request.files) {
    if (file.content.kind !== "existing") return false;
    const source = existingFileSource(file.content.reference);
    if (source === undefined || source.path !== file.path) return false;
    if (version !== undefined && version !== source.version) return false;
    version = source.version;
  }
  if (version === undefined) return false;
  const base = await deps.loadBaseVersion(version);
  if (!base.ok || base.value === null) return false;
  const row = base.value;
  return row.files_hash === filesHash &&
    row.format.name === format.name &&
    row.format.module_hash === format.module_hash &&
    row.format.explicit === format.explicit;
}

export function createPrepareAssembly(deps: PrepareDeps) {
  return async function prepare(
    request: PrepareRequest,
  ): Promise<Result<PreparedResult, PrepareError>> {
    // 파일 목록 검사(R5). 위험 경로·접근 실패는 구조 경고로 낮추지 않는다.
    const issues = checkFileList(
      request.files.map((file) => ({
        path: file.path,
        bytes: file.bytes,
        primary: file.primary,
      })),
    );
    if (issues.length > 0) return err(invalidIssues(issues));
    const primary = request.files.find((file) => file.primary)!;
    const contentFiles = request.files.map((file) =>
      fileToContent(file, file.primary)
    );

    // 기준 FormatRef 해석(생략). 신규는 MIME 기본 implicit, 옛 문서는 base contract다.
    const resolved = await resolveFormat(request, primary, deps);
    if (!resolved.ok) return resolved;
    const format = resolved.value;
    // 요청이 format을 뺐는지는 보지 않는다. 해석된 판이 explicit이면 지정 계약이다.
    const implicit = !format.explicit;

    // 같은 stream을 hash와 blob 준비로 보낸다. 실패는 낮추지 않는다.
    const packaged = await deps.prepareFiles(contentFiles);
    if (!packaged.ok) {
      return err({
        code: "unavailable",
        message: `file preparation failed: ${packaged.error.message}`,
      });
    }
    const filesHash = packaged.value.hash;

    // validate port. runner 누락·실행 실패는 낮추지 않는다.
    const validated = await deps.validateFiles(contentFiles, format);
    if (!validated.ok) {
      return err({
        code: validated.error.code,
        message: validated.error.message,
      });
    }
    const outcome = validated.value;

    // 구조 진단은 explicit가 아닌 format에서 warning으로 내려간다. 나머지는 그대로 남는다.
    // 검사 한도를 넘어 검사를 하지 못한 것(check_skipped)은, 이미 이 FormatRef로 저장된 판을
    // 되돌리는 restore에서만 warning이다(새 바이트의 명시 format 저장은 거절 그대로다).
    const restoring = format.explicit &&
      outcome.diagnostics.some((d) => d.code === CHECK_SKIPPED_CODE) &&
      await restoresAcceptedVersion(request, format, filesHash, deps);
    const diagnostics = outcome.diagnostics.map((diagnostic) =>
      restoring && diagnostic.code === CHECK_SKIPPED_CODE
        ? { ...diagnostic, severity: "warning" as const }
        : recastDiagnostic(diagnostic, implicit)
    );
    const errorCount = diagnostics.filter((d) => d.severity === "error").length;
    const warningCount =
      diagnostics.filter((d) => d.severity === "warning").length;
    const passed = errorCount === 0;
    const status = passed ? ("passed" as const) : ("failed" as const);

    // 명시 format의 error는 invalid_input으로 거절한다(사전 validate와 같은 오류).
    if (format.explicit && !passed) {
      return err({
        code: "invalid_input",
        message: "requested format failed validation",
      });
    }

    // canonical 목록은 준비 worker가 확정한 FilesHash다. 카운트 일치 검사는
    // preparedVersionOutputSchema가 한다.
    const validation = {
      input_hash: filesHash,
      module_hash: format.module_hash,
      status,
      error_count: errorCount,
      warning_count: warningCount,
      diagnostics,
    };

    return ok({
      document: request.document,
      base_version: request.base_version,
      files_hash: filesHash,
      file_count: request.files.length,
      primary_path: primary.path,
      content_hash: filesHash,
      preparation_ref: packaged.value.preparation,
      idempotency_key: request.idempotency_key,
      ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
      format,
      validation,
      ...(request.file_basis === undefined
        ? {}
        : { file_basis: request.file_basis as FileObservationBasis }),
      source: request.source,
      // 새 바이트는 준비 참조로, 이미 등록된 blob은 그 참조로 판에 묶는다.
      files: contentFiles.map((file, index) => {
        const content = request.files[index].content;
        return content.kind === "prepared"
          ? { ...file, preparation_ref: content.blob.preparation }
          : { ...file, existing: content.reference };
      }),
    });
  };
}

// export 묶기(`document.export` worker의 handler). 사람이 고른 project·app 자리의
// 문서와 고정 판을 계약 출력으로 묶는다. 원본 바이트는 유지되는 ContentFile
// 상대 경로·blob hash·원래 MIME·바이트 수 metadata로 선행 documents/file 통로에서
// 열린다. HTML·PDF·image처럼 Markdown으로 못 바꾸는 원문도 파일 목록 그대로 원래
// MIME를 둔다. derived index·outline·요약은 넣지 않는다.
export type ExportDocument = {
  document: Document;
  row: VersionRow;
  files: readonly ContentFile[];
};

export type ExportError = {
  code:
    | "invalid_input"
    | "forbidden"
    | "not_found"
    | "unavailable"
    | "conflict";
  message: string;
};

export function createExportAssembly() {
  return function exportAssembly(
    selected: readonly ExportDocument[],
    format: "markdown" | "json",
  ): Result<{
    format: "markdown" | "json";
    documents: {
      document: Omit<Document, "file_source">;
      version: VersionRow & {
        files: readonly ContentFile[] | { hash: string; size_bytes: number };
      };
      reference: { document: string; version: string; section: null };
    }[];
  }, ExportError> {
    // 사람 자리의 문서만 묶는다. 고정 판의 metadata·파일 목록은 원래 그대로고
    // 자리 slug·파일 source는 출력에서 뺀다(agentDocumentSchema와 같은 모양).
    const documents: {
      document: Omit<Document, "file_source">;
      version: VersionRow & {
        files: readonly ContentFile[] | { hash: string; size_bytes: number };
      };
      reference: { document: string; version: string; section: null };
    }[] = [];
    for (const item of selected) {
      const { file_source: _source, ...visible } = item.document;
      // 파일 목록 행이 있으면 원래 파일 목록(원래 MIME·바이트 수)을 둔다.
      // 없으면 정규화 목록 blob 참조다(assembleVersion과 같은 규약).
      const files = item.files.length > 0
        ? item.files
        : { hash: item.row.files_hash, size_bytes: 0 };
      // versionSchema는 source 필드를 요구한다. 디스크 경로가 든 파일·지침 출처는 null로
      // 가리고(agent history와 같다) 앱 출처만 남긴다.
      const source = item.row.source?.kind === "app" ? item.row.source : null;
      documents.push({
        document: visible,
        version: {
          ...item.row,
          source,
          files,
        },
        reference: {
          document: item.document.id,
          version: item.row.id,
          section: null,
        },
      });
    }
    return ok({ format, documents });
  };
}
