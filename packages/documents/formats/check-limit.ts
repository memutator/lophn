// 검사가 읽는 대표 파일이 검사 한도(contracts의 FORMAT_CHECK_CONTENT_MAX_BYTES)를 넘을 때의
// 검사 결과. 검사를 하지 못한 것을 통과로 꾸미지 않고 한도를 밝힌다(architecture/documents
// 2.2). 명시 format은 error라 저장 전 검사가 실패하고(formats#R4, 저장은 invalid_input),
// 미지정 새 문서는 warning이라 원문은 그대로 저장된다(formats#R5). 같은 입력의 저장 준비와
// 사전 검사(`/v1/formats/validate`)가 같은 결과를 보게 이 한 곳에서 만든다.
import {
  FORMAT_CHECK_CONTENT_MAX_BYTES,
  formatCheckLimitMessage,
  formatChecksContent,
  type FormatDiagnostic,
  type FormatRef,
} from "../../protocol/projects/mod.ts";

export const CHECK_SKIPPED_CODE = "check_skipped";

export type OverLimitOutcome = {
  input_hash: string;
  module_hash: string;
  status: "passed" | "failed";
  error_count: number;
  warning_count: number;
  diagnostics: FormatDiagnostic[];
};

// 대표 파일이 한도를 넘어 검사를 하지 못하면 그 결과를, 아니면 null이다. 바이트를 읽지 않는
// format은 크기와 무관하게 null이다.
export function overLimitOutcome(
  primary: { path: string; bytes: number; blob_hash: string },
  format: FormatRef,
): OverLimitOutcome | null {
  if (
    !formatChecksContent(format.name) ||
    primary.bytes <= FORMAT_CHECK_CONTENT_MAX_BYTES
  ) return null;
  const explicit = format.explicit;
  const diagnostic: FormatDiagnostic = {
    severity: explicit ? "error" : "warning",
    code: CHECK_SKIPPED_CODE,
    message: `${formatCheckLimitMessage(primary.bytes)}; the check was not run`,
    file: primary.path,
    start_line: null,
    end_line: null,
    column: null,
  };
  return {
    input_hash: primary.blob_hash,
    module_hash: format.module_hash,
    status: explicit ? "failed" : "passed",
    error_count: explicit ? 1 : 0,
    warning_count: explicit ? 0 : 1,
    diagnostics: [diagnostic],
  };
}
