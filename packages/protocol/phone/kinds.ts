import { z } from "zod";
import type { PhoneCapability } from "../apps/phone-request.ts";
import {
  type BackendCapability,
  capabilityFrom,
  PHONE_CAPABILITY_TABLE,
  type PhoneCapabilityTable,
} from "./capabilities.ts";
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

// 폰이 답하는 kind의 목록이다. 앱 기능 가운데 backend가 부를 수 있는 것(`capabilities.ts`의 `from`에 `backend`가 든
// 항목, schema를 다시 적지 않는다)과 preview 화면을 다루는 `drive.*`(`drive.ts`)다. kind를 더하면 frame은 바뀌지 않는다.
// `deadline_ms`는 core가 request에 싣는 값이다. `drive.wait`의 deadline은 core가 `timeout_ms + 5_000`으로 싣는다.
type BackendKind = {
  [K in BackendCapability]: Pick<
    PhoneCapabilityTable[K],
    "input" | "output" | "deadline_ms"
  >;
};

const backendKinds = Object.fromEntries(
  Object.entries(PHONE_CAPABILITY_TABLE)
    .filter(([name]) => capabilityFrom(name as PhoneCapability, "backend"))
    .map(([name, { input, output, deadline_ms }]) => [
      name,
      { input, output, deadline_ms },
    ]),
) as BackendKind;

export const PHONE_KINDS = {
  ...backendKinds,
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
// - screen_off: 화면이 꺼졌다(`drive.*`)
// - covered: 앱은 앞에 있지만 무언가(sheet, dialog, notification shade)가 preview를 덮어 창에 focus가 없다(`drive.*`)
// - timeout: deadline까지 답이 없다
export const phoneUnavailableReasonSchema = z.enum([
  "no_phone",
  "phone_unreachable",
  "unsupported",
  "phone_in_background",
  "location_off",
  "no_preview",
  "screen_off",
  "covered",
  "timeout",
]);
export type PhoneUnavailableReason = z.infer<
  typeof phoneUnavailableReasonSchema
>;

// 거절은 `forbidden`이다. 화면 길(`apps/phone-screen.ts`의 `reply` 오류)도 같은 `reason`과 grant 거절 모양을 쓴다.
// - 폰이 OS 권한(위치, 카메라)을 거절당했을 때: `details.reason: "os_permission_denied"`
// - core가 grant 없음으로 거절할 때: `details: {permission: "phone.use", scope: {capability}}`(폰에는 묻지 않는다)
export const PHONE_OS_PERMISSION_DENIED = "os_permission_denied";
