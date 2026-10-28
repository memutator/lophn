// coding agent CLI의 명령 목록. 이름, 입력, 출력, 인증을 묶는다.
// 인증은 `user`와 `local` 둘이다. `user`는 data root의 user token file을 쓴다(사람이 쓰는 run 명령).
// `local` 명령은 token 없이 core를 부르지 않는다(harness 명령은 Settings와 shell main이 exec로 부르고,
// `hook`은 harness가 부른다).
import { z } from "zod";
import type { Route } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { jsonValueSchema } from "../base/json-values.ts";
import { toolNameSchema } from "../apps/channel-values.ts";
import { harnessDetectionSchema, harnessIdSchema } from "./harnesses.ts";
import { HOOK_EVENT_MAX_CHARS } from "./terminal-hook.ts";

const cliCommonSchema = z.strictObject({
  json: z.boolean().optional(),
  input: z.string().optional(),
  input_file: z.string().optional(),
  idempotency_key: z.string().optional(),
});

export type CodingCliCommand = {
  name: string;
  auth: "user" | "local";
  input: z.ZodType;
  output: z.ZodType;
  route?: Route;
};

// route 입력 위에 공통 칸을 얹는다. 칸 이름이 겹치면 route 쪽이 이긴다.
function withCommon(input: z.ZodType): z.ZodType {
  if (!(input instanceof z.ZodObject)) {
    throw new Error("cli input must be an object");
  }
  const shape = { ...input.shape } as Record<string, z.ZodType>;
  return z
    .strictObject({ ...cliCommonSchema.shape, ...shape })
    .refine(
      (value) => value.input === undefined || value.input_file === undefined,
      { message: "input and input_file are exclusive" },
    );
}

// 사람이 쓰는 명령이다. 입력은 route 입력이 아니라 CLI 칸이고, 명령이 route 입력을 만든다.
// route를 표에 두지 않는다: runs가 lophn-agent를, lophn-agent가 coding-agent를 import해 protocol 순환이 된다.
// 명령(`cli/commands/run.ts`)이 `protocol/runs`의 route를 직접 부른다. 출력은 run 기록이다.
function user(name: string, input: z.ZodType): CodingCliCommand {
  return { name, auth: "user", input: withCommon(input), output: z.unknown() };
}

export const HARNESS_INSTALL_OUTCOMES = [
  "installed",
  "unchanged",
  // `dry_run`일 때만 나온다. 놓을 것이 있다는 뜻이다.
  "missing",
  "not_supported",
  "failed",
] as const;
const harnessInstallOutcomeSchema = z.enum(HARNESS_INSTALL_OUTCOMES);
export const harnessInstallInputSchema = z.strictObject({
  harness: harnessIdSchema,
  dry_run: z.boolean().optional(),
  // 개발 실행의 hook command다. hook command는 shell 문자열이 되므로 공백·따옴표·`..` 없는 절대 경로만 받는다.
  command: z
    .string()
    .regex(/^\/[\w./-]+$/)
    .refine((path) => !path.includes(".."))
    .optional(),
});
// `files`는 쓴(`dry_run`이면 쓸) 절대 경로다.
const harnessInstallOutputSchema = z.strictObject({
  skill: harnessInstallOutcomeSchema,
  hook: harnessInstallOutcomeSchema,
  files: z.array(z.string()),
});

const harnessDetections = z.array(harnessDetectionSchema);

export const CODING_CLI_COMMANDS: readonly CodingCliCommand[] = [
  // `hook <harness> <event>`. payload는 stdin JSON이다. core를 부르지 않고 터미널의 hook socket에 한 줄을 쓴다.
  // `LPN_TERMINAL_HOOK`이 없으면 아무것도 하지 않고 성공한다.
  {
    name: "hook",
    auth: "local",
    input: withCommon(
      z.strictObject({
        harness: harnessIdSchema,
        event: z.string().min(1).max(HOOK_EVENT_MAX_CHARS),
      }),
    ),
    output: z.unknown(),
  },
  user(
    "agent run",
    z.strictObject({
      prompt: z.string().min(1),
      agent: z.string().min(1).optional().describe("agent 이름 (없으면 lophn)"),
      project: z
        .string()
        .min(1)
        .optional()
        .describe("place가 될 project의 이름이나 id. --app과 같이 쓰지 않는다"),
      app: z
        .string()
        .min(1)
        .optional()
        .describe("place가 될 앱의 이름이나 id. --project와 같이 쓰지 않는다"),
      session: idSchema("ses").optional(),
      schema: z.string().min(1).optional().describe("출력 JSON Schema 글"),
      async: z.boolean().optional(),
      input: jsonValueSchema.optional(),
    }),
  ),
  user(
    "tool call",
    z.strictObject({
      app: z.string().min(1),
      tool: toolNameSchema,
      async: z.boolean().optional(),
      input: jsonValueSchema.optional(),
    }),
  ),
  user("run wait", z.strictObject({ run: idSchema("run") })),
  user("run show", z.strictObject({ run: idSchema("run") })),
  user("run cancel", z.strictObject({ run: idSchema("run") })),
  // workflow 명령도 route를 표에 두지 않는다(`cli/commands/workflow.ts`가 `protocol/workflows`의 route를 부른다).
  // 문자열 검사는 core의 route schema가 한다. 여기는 id와 `new | same`만 좁힌다.
  user(
    "workflow start",
    z.strictObject({
      workflow: z.string().min(1).describe("<project 이름>/<name>"),
      text: z.string().min(1),
      step: z
        .string()
        .min(1)
        .optional()
        .describe("첫 step 이름 (없으면 선언의 시작 step)"),
    }),
  ),
  user(
    "workflow report",
    z.strictObject({
      instance: idSchema("wfi"),
      step: z.string().min(1),
      text: z.string().min(1),
      next: z.string().min(1).optional().describe("다음 step 이름 또는 end"),
      session: z.enum(["new", "same"]).optional().describe("new | same"),
    }),
  ),
  user("workflow stop", z.strictObject({ instance: idSchema("wfi") })),
  user("workflow show", z.strictObject({ instance: idSchema("wfi") })),
  {
    name: "harness detect",
    auth: "local",
    input: withCommon(z.strictObject({})),
    output: harnessDetections,
  },
  {
    name: "harness refresh",
    auth: "local",
    input: withCommon(z.strictObject({})),
    output: harnessDetections,
  },
  {
    name: "harness install",
    auth: "local",
    input: withCommon(harnessInstallInputSchema),
    output: harnessInstallOutputSchema,
  },
];
