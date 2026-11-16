import { z } from "zod";
import { defineMemory } from "../base/route.ts";

// 사람의 표시(keep_running·keep_awake)와 OS가 답한 사실을 같이 낸다. start_at_login은 표시와 상관없는 OS의 사실이라
// 화면이 둘을 짝지어 읽는다(표시 꺼짐 + registered는 아직 남은 등록이다).
export const alwaysOnStatusSchema = z.strictObject({
  keep_running: z.boolean(),
  keep_awake: z.boolean(),
  start_at_login: z.enum([
    "registered",
    "not_registered",
    "off_in_system",
    "unavailable",
  ]),
  // start_at_login이 unavailable일 때만 있다.
  login_reason: z
    .enum([
      "development_build",
      "no_service_manager",
      "unverified_path",
      "os_failed",
    ])
    .nullable(),
  awake: z.enum(["held", "released", "unavailable"]),
  awake_reason: z.enum(["no_inhibitor", "os_failed"]).nullable(),
  // 개발·test core는 null이다.
  mechanism: z.enum(["systemd", "launchd", "windows_run"]).nullable(),
});

export type AlwaysOnStatus = z.infer<typeof alwaysOnStatusSchema>;

// Whether lophn starts at this computer's login and keeps running without its window, as the OS reports it.
export const alwaysOnStatus = defineMemory({
  resource: "always_on",
  method: "status",
  name: "always_on.status",
  input: z.strictObject({}),
  output: alwaysOnStatusSchema,
  actors: ["user"],
  errors: ["invalid_input", "forbidden"],
});

export const alwaysOnSetInputSchema = z
  .strictObject({
    keep_running: z.boolean().optional(),
    keep_awake: z.boolean().optional(),
  })
  .refine(
    (input) =>
      input.keep_running !== undefined || input.keep_awake !== undefined,
    { message: "keep_running or keep_awake is required" },
  );

export type AlwaysOnSetInput = z.infer<typeof alwaysOnSetInputSchema>;

// Mark this computer so lophn starts at its login and keeps running without its window, and optionally keeps it awake.
// 같은 값을 다시 보내면 다시 등록한다(화면의 Try again).
export const alwaysOnSet = defineMemory({
  resource: "always_on",
  method: "set",
  name: "always_on.set",
  input: alwaysOnSetInputSchema,
  output: alwaysOnStatusSchema,
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

export const ALWAYS_ON_ROUTES = [alwaysOnStatus, alwaysOnSet] as const;
