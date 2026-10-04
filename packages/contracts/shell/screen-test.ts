import { z } from "zod";
import { endpointSchema, screenKeySchema } from "../apps/channel-values.ts";
import { sha256Schema } from "../platform/values.ts";

// 상속 fd 3의 JSON lines. stdout은 쓰지 않는다(shell#T46, problems 계획 Q7).
export const SCREEN_TEST_FD = 3;
export const SCREEN_TEST_FLAG = "--app-screen-test";

// runner가 host를 찾는 설치 경로. platform 설치 묶음의 desktop 실행 파일이다.
export const SCREEN_TEST_HOST = {
  linux: "/opt/lophn/desktop/lophn-desktop",
  macos: "Lophn.app/Contents/Resources/desktop/lophn-desktop",
  windows: "Lophn/resources/desktop/lophn-desktop.exe",
} as const;

const screenEntrySchema = z.strictObject({
  key: screenKeySchema,
  path: z.string().min(1).refine((value) => !value.split("/").includes(".."), {
    message: "screen path leaves the bundle",
  }),
});

export const screenTestInputSchema = z.strictObject({
  bundle_screens_dir: z.string().min(1),
  screens: z.array(screenEntrySchema).min(1),
  app_socket_path: endpointSchema,
  deadline_ms: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

export type ScreenTestInput = z.infer<typeof screenTestInputSchema>;

const loadSchema = z.strictObject({
  screen: screenKeySchema,
  ok: z.boolean(),
  reason: z.string().nullable(),
});

const errorSchema = z.strictObject({
  screen: screenKeySchema,
  observation: z.enum(["error", "unhandledrejection", "render_error"]),
  name: z.string().regex(/\S/),
  message: z.string().nullable(),
});

const feedbackCheckSchema = z.strictObject({
  screen: screenKeySchema,
  binding: z.boolean(),
  capture: z.enum(["captured", "missing"]),
  dialog: z.enum(["opened", "blocked"]),
});

const blockedRequestSchema = z.strictObject({
  screen: screenKeySchema,
  url_hash: sha256Schema,
});

export const screenTestObservationSchema = z.strictObject({
  load: z.array(loadSchema),
  errors: z.array(errorSchema),
  feedback_check: z.array(feedbackCheckSchema),
  blocked_requests: z.array(blockedRequestSchema),
});

export type ScreenTestObservation = z.infer<typeof screenTestObservationSchema>;

// 한 줄 JSON. 빈 줄과 줄바꿈 안의 값은 거절한다.
export function screenTestLine(value: unknown): string {
  const text = JSON.stringify(value);
  if (text.includes("\n")) {
    throw new Error("screen test line contains a newline");
  }
  return `${text}\n`;
}
