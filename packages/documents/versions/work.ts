// 파일 준비 조립(`document.prepare` worker의 handler). 호출자 자격·요청·기준을 받아
// 안전한 상대 경로·유일 경로·대표 파일 하나·바이트 수를 검사하고, 같은 stream을 hash와
// blob 준비로 보내며, canonical 목록 blob과 format validate 뒤 preparation_ref를
// 원래 요청·기준·blob에 묶은 PreparedVersion을 돌려준다.
// core는 파일을 다시 읽지 않는다. 여기도 파일을 읽지 않는다. 준비 worker가 파일을 읽고
// guest 입력으로 바꿔 넘긴다(reads.ts의 파일 바이트는 준비 worker 몫이다).
// 명시 format의 error는 invalid_input으로 거절(사전 validate와 같은 오류)하고 warning은
// 결과에 남긴다. 미지정 새 문서는 MIME 기본 format이고 구조 error는 warning으로 내려가며,
// 위험 경로·접근 실패·runner 실패는 낮추지 않는다. 옛 module은 보존 목록에서 찾는다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type ContentFile,
  type DocumentFileInput,
  type FileObservationBasis,
  type FormatDiagnostic,
  type FormatRef,
  type PreparedVersion,
} from "../../contracts/documents/mod.ts";
import { formatForMediaType } from "../formats/model.ts";
import { BUILTIN_MODULE_HASH } from "../formats/guest/module-hash.ts";
import { loadVersion, type VersionRow } from "./store.ts";

// prepare worker가 파일 목록 검사를 부르는 정본(file-tracking의 T8 몫).
import { checkFileList, type FileListIssue } from "../file-tracking/model.ts";

export type ValidateOutcome = {
  input_hash: string;
  module_hash: string;
  status: "passed" | "failed";
  error_count: number;
  warning_count: number;
  diagnostics: FormatDiagnostic[];
};

export type ValidateError = { code: "not_found" | "unavailable"; message: string };

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
  files: readonly ContentFile[];
};

export type PrepareError = { code: string; message: string };

// 미지정 계약에서 구조 진단이 warning으로 내려간다(R5). 나머지 class는 그대로다.
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
    const implicit = request.format === undefined;

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

    // 구조 진단은 미지정 계약에서 warning으로 내려간다. 나머지는 그대로 남는다.
    const diagnostics = outcome.diagnostics.map((diagnostic) =>
      recastDiagnostic(diagnostic, implicit)
    );
    const errorCount = diagnostics.filter((d) => d.severity === "error").length;
    const warningCount = diagnostics.filter((d) =>
      d.severity === "warning"
    ).length;
    const passed = errorCount === 0;
    const status = passed ? ("passed" as const) : ("failed" as const);

    // 명시 format의 error는 invalid_input으로 거절한다(사전 validate와 같은 오류).
    if (format.explicit && !passed) {
      return err({ code: "invalid_input", message: "requested format failed validation" });
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
      files: contentFiles,
    });
  };
}
