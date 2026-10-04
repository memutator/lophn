import { z } from "zod";
import {
  SETTINGS_EXCHANGE_FORMAT,
  SETTINGS_EXCHANGE_FORMAT_VERSION,
} from "./settings.ts";
import { workerRequestSchema, workerResponseSchema } from "./supervision.ts";
import { settingMutationSchema } from "./settings.ts";

// settings 교환 TOML의 import·export pipe 작업(T27 내놓는 contract).
// - 이 op는 공개 HTTP route가 아니다. supervision worker envelope의 op로만 부른다.
// - 안전 책임은 나눠진다. schema는 wire 모양만 고정한다. UTF-8 TOML 1.0 format
//   version 1의 해석·redaction·전체 영향 검증은 platform I/O worker가 하고,
//   mutation의 항목·값·층·비교 기준 검사와 적용은 ApplySettings command의 몫이다.
// - import bytes는 요청의 channel에 묶인 byte chunk로 온다. JSON payload에는 없다.
// - export 결과 bytes는 worker의 응답 payload에 담지 않는다. 정확한 전달 모양은
//   core 조립이 정한다. 이 descriptor는 op 이름과 입력 모양만 고정한다.

// 공개 HTTP route가 아니다. core→platform I/O 비공개 인증 pipe에서만 부른다.
export const SETTINGS_IMPORT_OP = "settings.import";
export const SETTINGS_EXPORT_OP = "settings.export";

// 크기 상한. 교환 문서는 등록 항목 목록이므로 RPC JSON 한도를 따른다.
export const SETTINGS_EXCHANGE_MAX_BYTES = 1024 * 1024;

export const settingsImportInputSchema = z.strictObject({});
export type SettingsImportInput = z.infer<typeof settingsImportInputSchema>;
// worker의 parse가 문법·format·값 모양을 거절하고, 통과한 mutation만 돌려준다.
// 항목·타입·범위·층 검사는 ApplySettings가 다시 한다.
export const settingsImportOutputSchema = z.object({
  format_version: z.number().int(),
  mutations: z.array(settingMutationSchema),
});
export type SettingsImportOutput = z.infer<typeof settingsImportOutputSchema>;

export const settingsExportInputSchema = z.strictObject({
  mutations: z.array(settingMutationSchema).min(1),
});
export type SettingsExportInput = z.infer<typeof settingsExportInputSchema>;
// stringify는 worker가 하고, bytes는 pipe의 byte chunk로 나간다. JSON에는 format만 있다.
export const settingsExportOutputSchema = z.object({
  format: z.literal(SETTINGS_EXCHANGE_FORMAT.format),
  toml_version: z.literal(SETTINGS_EXCHANGE_FORMAT.toml_version),
  encoding: z.literal(SETTINGS_EXCHANGE_FORMAT.encoding),
  format_version: z.literal(SETTINGS_EXCHANGE_FORMAT_VERSION),
});
export type SettingsExportOutput = z.infer<typeof settingsExportOutputSchema>;

// JSON 제어(channel 0) 전용이다. stream channel은 거절한다.
export const settingsImportRequestSchema = workerRequestSchema(
  settingsImportInputSchema,
).extend({
  op: z.literal(SETTINGS_IMPORT_OP),
  channel: z.never().optional(),
});
export type SettingsImportRequest = z.infer<typeof settingsImportRequestSchema>;
export const settingsExportRequestSchema = workerRequestSchema(
  settingsExportInputSchema,
).extend({
  op: z.literal(SETTINGS_EXPORT_OP),
  channel: z.never().optional(),
});
export type SettingsExportRequest = z.infer<typeof settingsExportRequestSchema>;

// request_id가 요청과 같은지는 runtime이 검사한다. 공통 worker failure는 그대로 쓴다.
export const settingsImportResponseSchema = workerResponseSchema(
  settingsImportOutputSchema,
);
export type SettingsImportResponse = z.infer<
  typeof settingsImportResponseSchema
>;
export const settingsExportResponseSchema = workerResponseSchema(
  settingsExportOutputSchema,
);
export type SettingsExportResponse = z.infer<
  typeof settingsExportResponseSchema
>;

// descriptor의 shape만 둔다. defineWorker도 HTTP route 등록도 하지 않는다.
export const settingsImport = {
  op: SETTINGS_IMPORT_OP,
  input: settingsImportInputSchema,
  output: settingsImportOutputSchema,
  request: settingsImportRequestSchema,
  response: settingsImportResponseSchema,
} as const;
export const settingsExport = {
  op: SETTINGS_EXPORT_OP,
  input: settingsExportInputSchema,
  output: settingsExportOutputSchema,
  request: settingsExportRequestSchema,
  response: settingsExportResponseSchema,
} as const;
