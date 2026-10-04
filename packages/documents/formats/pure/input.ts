import type {
  FormatDiagnostic,
  FormatValidationResult,
  SectionExtractionResult,
} from "../../../contracts/documents/mod.ts";
import { decodeUtf8 } from "./utf8.ts";

const SHA256 = /^[0-9a-f]{64}$/;
// deno-lint-ignore no-control-regex -- 경로에 control character를 막는다.
const RELATIVE_PATH = /^(?!\/)(?![A-Za-z]:)[^\\\u0000-\u001f\u007f]+$/;

export type FormatModuleFile = {
  path: string;
  media_type: string;
  primary: boolean;
  content: readonly number[];
};

// host가 넘기는 실행 바인딩. hash는 이 module이 계산하지 않는다.
export type FormatModuleInput = {
  input_hash: string;
  module_hash: string;
  files: readonly FormatModuleFile[];
};

export type PrimaryBytes = {
  file: FormatModuleFile;
  bytes: readonly number[];
};

export type InputIssue = {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
};

function diagnostic(issue: InputIssue): FormatDiagnostic {
  return {
    severity: "error",
    code: issue.code,
    message: issue.message,
    file: issue.file ?? null,
    start_line: issue.line ?? null,
    end_line: issue.line ?? null,
    column: issue.column ?? null,
  };
}

export function failedValidation(
  input: FormatModuleInput,
  issues: readonly InputIssue[],
): FormatValidationResult {
  return {
    input_hash: input.input_hash,
    module_hash: input.module_hash,
    status: "failed",
    diagnostics: issues.map(diagnostic),
    error_count: issues.length,
    warning_count: 0,
  };
}

export function passedValidation(
  input: FormatModuleInput,
): FormatValidationResult {
  return {
    input_hash: input.input_hash,
    module_hash: input.module_hash,
    status: "passed",
    diagnostics: [],
    error_count: 0,
    warning_count: 0,
  };
}

export function failedExtraction(
  input: FormatModuleInput,
  reason: string,
): SectionExtractionResult {
  return {
    input_hash: input.input_hash,
    module_hash: input.module_hash,
    status: "failed",
    title: null,
    failure_reason: reason,
    sections: [],
  };
}

function validPath(path: string): boolean {
  if (!RELATIVE_PATH.test(path)) return false;
  return path.split("/").every((part) =>
    part !== "" && part !== "." && part !== ".."
  );
}

function byteArray(value: readonly number[]): boolean {
  return value.every((byte) =>
    Number.isInteger(byte) && byte >= 0 && byte <= 255
  );
}

// 파일 모양과 primary 하나만 본다. media type 해석은 module이 한다.
export function primaryFile(
  input: FormatModuleInput,
): { ok: true; primary: FormatModuleFile } | {
  ok: false;
  issues: InputIssue[];
} {
  const issues: InputIssue[] = [];
  if (!SHA256.test(input.input_hash) || !SHA256.test(input.module_hash)) {
    issues.push({
      code: "invalid_binding",
      message: "input_hash and module_hash must be lowercase sha256",
    });
  }
  if (!Array.isArray(input.files) || input.files.length === 0) {
    issues.push({
      code: "missing_primary",
      message: "files need exactly one primary file",
    });
    return { ok: false, issues };
  }
  const paths = new Set<string>();
  let primary: FormatModuleFile | undefined;
  for (const file of input.files) {
    if (!validPath(file.path)) {
      issues.push({
        code: "invalid_path",
        message: "file path must be a root-relative path",
        file: typeof file.path === "string" && file.path.length > 0
          ? file.path
          : undefined,
      });
    } else if (paths.has(file.path)) {
      issues.push({
        code: "duplicate_path",
        message: "file paths must be unique",
        file: file.path,
      });
    }
    paths.add(file.path);
    if (!byteArray(file.content ?? [])) {
      issues.push({
        code: "invalid_bytes",
        message: "file content must be integer bytes 0..255",
        file: validPath(file.path) ? file.path : undefined,
      });
    }
    if (file.primary) {
      if (primary !== undefined) {
        issues.push({
          code: "multiple_primary",
          message: "files need exactly one primary file",
          file: file.path,
        });
      }
      primary = file;
    }
  }
  if (primary === undefined) {
    issues.push({
      code: "missing_primary",
      message: "files need exactly one primary file",
    });
  }
  return issues.length > 0 || primary === undefined
    ? { ok: false, issues }
    : { ok: true, primary };
}

export type NormalizedText = {
  text: string;
  bytes: readonly number[];
  file: FormatModuleFile;
};

// UTF-8 → 선행 BOM 하나 → CRLF/CR → LF → NFC. 원문 바이트는 바꾸지 않는다.
export function normalizeDocumentText(
  input: FormatModuleInput,
): { ok: true; value: NormalizedText } | { ok: false; issues: InputIssue[] } {
  const primary = primaryFile(input);
  if (!primary.ok) return primary;
  const decoded = decodeUtf8(primary.primary.content);
  if (!decoded.ok) {
    return {
      ok: false,
      issues: [{
        code: "invalid_utf8",
        message: "primary file is not valid UTF-8",
        file: primary.primary.path,
        line: 1,
        column: 1,
      }],
    };
  }
  const withoutBom = decoded.text.charCodeAt(0) === 0xfeff
    ? decoded.text.slice(1)
    : decoded.text;
  const text = withoutBom.replace(/\r\n?/g, "\n").normalize("NFC");
  return {
    ok: true,
    value: { text, bytes: primary.primary.content, file: primary.primary },
  };
}
