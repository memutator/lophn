import { z } from "zod";
import { atSchema } from "../base/values.ts";
import {
  driveActInputSchema,
  driveActOutputSchema,
  driveScreenshotInputSchema,
  driveScreenshotOutputSchema,
  driveSnapshotInputSchema,
  driveSnapshotOutputSchema,
  driveWaitInputSchema,
  driveWaitOutputSchema,
} from "./drive.ts";

// 폰이 답하는 kind의 목록. kind를 더하면 여기 한 항목이다(frame은 바뀌지 않는다). `deadline_ms`는 core가 request에 싣는 값이다.

// accuracy 기본은 balanced, max_age_ms 기본은 0(캐시 없이 새로 잰다). 기본은 폰이 적용한다.
export const locationGetInputSchema = z.strictObject({
  accuracy: z.enum(["low", "balanced", "high"]).optional(),
  max_age_ms: z.number().int().min(0).max(300_000).optional(),
});
export type LocationGetInput = z.infer<typeof locationGetInputSchema>;

export const locationSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0),
  at: atSchema,
});
export type Location = z.infer<typeof locationSchema>;

export const PHONE_KINDS = {
  "location.get": {
    input: locationGetInputSchema,
    output: locationSchema,
    deadline_ms: 20_000,
  },
  // preview 화면을 다루는 kind다(`drive.ts`). `drive.wait`의 deadline은 core가 `timeout_ms + 5_000`으로 싣는다.
  "drive.snapshot": {
    input: driveSnapshotInputSchema,
    output: driveSnapshotOutputSchema,
    deadline_ms: 10_000,
  },
  "drive.act": {
    input: driveActInputSchema,
    output: driveActOutputSchema,
    deadline_ms: 15_000,
  },
  "drive.screenshot": {
    input: driveScreenshotInputSchema,
    output: driveScreenshotOutputSchema,
    deadline_ms: 10_000,
  },
  "drive.wait": {
    input: driveWaitInputSchema,
    output: driveWaitOutputSchema,
    deadline_ms: 30_000,
  },
} as const;
export type PhoneKind = keyof typeof PHONE_KINDS;

// `unavailable` 오류의 `details.reason`이다.
// - no_phone: 기준 폰이 짝지어져 있지 않다
// - phone_unreachable: 그 기기와 열린 channel이 없거나, 기다리는 동안 닫혔다
// - unsupported: 폰의 `hello.capabilities`에 그 kind가 없다
// - phone_in_background: channel은 열렸지만 폰 앱이 활성이 아니다
// - location_off: OS 위치 서비스가 꺼져 있다
// - no_preview: `drive.*`의 view가 이 폰이 연 preview view가 아니거나 guest가 닫혔다
// - screen_off: 화면이 꺼졌거나 창에 focus가 없다(`drive.*`)
// - timeout: deadline까지 답이 없다
export const phoneUnavailableReasonSchema = z.enum([
  "no_phone",
  "phone_unreachable",
  "unsupported",
  "phone_in_background",
  "location_off",
  "no_preview",
  "screen_off",
  "timeout",
]);
export type PhoneUnavailableReason = z.infer<
  typeof phoneUnavailableReasonSchema
>;

// 거절은 `forbidden`이다.
// - 폰이 OS 권한을 거절당했을 때: `details.reason: "os_permission_denied"`
// - core가 grant 없음으로 거절할 때: `details: {permission: "phone.use", scope: {capability}}`(폰에는 묻지 않는다)
export const PHONE_OS_PERMISSION_DENIED = "os_permission_denied";
