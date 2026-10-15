import { z } from "zod";
import { commandKeySchema as apiKey } from "../apps/channel-values.ts";
import { jsonValueSchema } from "../base/json-values.ts";

// 외부 링크 상한. 8193자는 열지 않는다.
export const EXTERNAL_URL_MAX_CHARS = 8192;

function externalUrlAllowed(value: string): boolean {
  if (value.length > EXTERNAL_URL_MAX_CHARS) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" && url.password === "";
}

export const externalUrlSchema = z.string().refine(externalUrlAllowed, {
  message: "external url must be http(s), without userinfo, at most 8192 chars",
});

// app-api 이름과 JSON 입력만 받는다. token·경로·method는 field로 받지 않는다.
export const appCallSchema = z.strictObject({
  api: apiKey,
  input: jsonValueSchema,
});

export type AppCall = z.infer<typeof appCallSchema>;

export const appOpenExternalSchema = z.strictObject({
  url: externalUrlSchema,
});

export type AppOpenExternal = z.infer<typeof appOpenExternalSchema>;

// 설치 preload 내부 경로. 페이지가 주장한 앱·release는 받지 않는다.
export const appViewErrorSchema = z.strictObject({
  observation: z.enum(["error", "unhandledrejection", "render_error"]),
  name: z.string().regex(/\S/),
  message: z.string().nullable(),
});

export type AppViewError = z.infer<typeof appViewErrorSchema>;

export const APP_BRIDGE_IPC = {
  "app:call": appCallSchema,
  "app:open-external": appOpenExternalSchema,
  "app:view-error": appViewErrorSchema,
} as const;

export type AppBridgeIpc = keyof typeof APP_BRIDGE_IPC;

// 공개 preload. view-error는 설치 preload 내부라 여기 없다.
export type LophnApp = {
  call(api: string, input: AppCall["input"]): Promise<unknown>;
  openExternal(url: string): Promise<void>;
};

// 기록에 남기는 것만. query·fragment는 넣지 않는다.
export function externalLinkRecord(
  url: string,
): { origin: string; path: string } {
  const parsed = externalUrlSchema.parse(url);
  const value = new URL(parsed);
  return { origin: value.origin, path: value.pathname };
}
