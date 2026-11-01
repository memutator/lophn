// `lophn harness install|status|uninstall`의 입력과 결과 종류다. 명령 표는 `packages/cli`가 아니라
// `packages/coding-agent/local`에 있고, 여기는 shell main(Settings)과 harness 설치 code가 같이 쓰는 값만 둔다.
import { z } from "zod";
import { harnessIdSchema } from "./harnesses.ts";

export const HARNESS_INSTALL_OUTCOMES = [
  "installed",
  "unchanged",
  // `dry_run`일 때만 나온다. 놓을 것이 있다는 뜻이다.
  "missing",
  "not_supported",
  "failed",
] as const;
// 개발 실행의 hook command다. hook command는 shell 문자열이 되므로 공백·따옴표·`..` 없는 절대 경로만 받는다.
const hookCommandSchema = z
  .string()
  .regex(/^\/[\w./-]+$/)
  .refine((path) => !path.includes(".."));
export const harnessInstallInputSchema = z.strictObject({
  harness: harnessIdSchema,
  dry_run: z.boolean().optional(),
  command: hookCommandSchema.optional(),
});

// 모든 harness의 `install --dry_run`을 한 process에서 돈다. Settings가 harness마다 process를 띄우지 않게 한다.
export const harnessStatusInputSchema = z.strictObject({
  command: hookCommandSchema.optional(),
});
export const HARNESS_UNINSTALL_OUTCOMES = [
  "removed",
  // 지울 우리 항목이 없다.
  "unchanged",
  "not_supported",
  "failed",
] as const;
export const harnessUninstallInputSchema = z.strictObject({
  harness: harnessIdSchema,
});
