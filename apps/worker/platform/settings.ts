// I/O worker의 settings 교환 경계(platform/settings#R3, R26).
// UTF-8 TOML 1.0 format version 1의 parse·redaction·stringify는 이 worker만 한다.
// core는 해석 없이 bytes를 넘긴다. mutation의 항목·값·층·비교 기준 검사와 적용은
// ApplySettings command의 몫이다. 이 pipe는 문서 모양만 만든다.

import {
  SETTINGS_EXPORT_OP,
  SETTINGS_IMPORT_OP,
  type SettingsExportInput,
  type SettingsExportOutput,
  type SettingsImportInput,
  type SettingsImportOutput,
} from "../../../packages/contracts/platform/mod.ts";
import type { ErrorCode } from "../../../packages/base/mod.ts";
import {
  exportSettingsTOML,
  parseSettingsTOML,
} from "../../../packages/platform/settings/mod.ts";

export type SettingsPipeRequest = {
  request_id: string;
  op: string;
  payload: unknown;
};

export type SettingsPipePayload =
  | SettingsImportOutput
  | { op: typeof SETTINGS_EXPORT_OP; document: Uint8Array }
  | SettingsExportOutput;

export type SettingsPipeResponse =
  | { request_id: string; ok: true; payload: SettingsPipePayload }
  | {
    request_id: string;
    ok: false;
    error: { code: ErrorCode; message: string };
  };

type SettingsPipeErrorCode = ErrorCode;

export type SettingsPipe = {
  // bytes callback은 core가 교환 문서 bytes를 메모리로 넘길 때 부른다.
  // parse·stringify 밖에 IO·치환·실행 경로는 없다(R3).
  handle(
    request: SettingsPipeRequest,
    bytes: () => Promise<Uint8Array | undefined>,
  ): Promise<SettingsPipeResponse>;
};

const ENCODER = new TextEncoder();

function failure(
  request_id: string,
  code: SettingsPipeErrorCode,
  message: string,
): SettingsPipeResponse {
  return { request_id, ok: false, error: { code, message } };
}

export type SettingsPipeDeps = {};

export function createSettingsPipe(_deps: SettingsPipeDeps = {}): SettingsPipe {
  return {
    async handle(request, bytes) {
      if (request.op === SETTINGS_IMPORT_OP) {
        // import 입력은 JSON이 없다. bytes callback만 본다.
        const _input = request.payload;
        void _input;
        const raw = await bytes();
        if (raw === undefined) {
          return failure(
            request.request_id,
            "invalid_input",
            "교환 문서 bytes가 없다",
          );
        }
        let text: string;
        try {
          // UTF-8이 아니면 전체 거절한다(R3).
          text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
        } catch {
          return failure(
            request.request_id,
            "invalid_input",
            "교환 문서가 UTF-8이 아니다",
          );
        }
        const document = parseSettingsTOML(text);
        if (!document.ok) {
          return {
            request_id: request.request_id,
            ok: false,
            error: {
              code: document.error.code,
              message: document.error.message,
            },
          };
        }
        return {
          request_id: request.request_id,
          ok: true,
          payload: {
            format_version: document.value.format_version,
            mutations: document.value.mutations,
          },
        };
      }
      if (request.op === SETTINGS_EXPORT_OP) {
        const raw = await bytes();
        // export는 bytes callback 없이 payload의 mutations를 쓴다.
        if (raw !== undefined) {
          return failure(
            request.request_id,
            "invalid_input",
            "export는 바이트 입력을 받지 않는다",
          );
        }
        const input = request.payload as { mutations?: unknown };
        if (
          input === null || typeof input !== "object" ||
          !Array.isArray(input.mutations) || input.mutations.length === 0
        ) {
          return failure(
            request.request_id,
            "invalid_input",
            "내보낼 설정 변경이 없다",
          );
        }
        const text = exportSettingsTOML({
          mutations: input.mutations as never,
        });
        if (!text.ok) {
          return {
            request_id: request.request_id,
            ok: false,
            error: { code: text.error.code, message: text.error.message },
          };
        }
        return {
          request_id: request.request_id,
          ok: true,
          payload: {
            op: SETTINGS_EXPORT_OP,
            document: ENCODER.encode(text.value),
          },
        };
      }
      return failure(request.request_id, "invalid_input", "settings pipe op가 아니다");
    },
  };
}

// import payload 모양은 contract의 settingsImportInputSchema가 고정한다. 여기서는
// bytes callback만 보므로 스키마 검사는 core ingress가 한다.
export type { SettingsImportInput, SettingsExportInput };
