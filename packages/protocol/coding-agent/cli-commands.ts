// coding agent CLI의 명령 목록. 이름, 입력, 출력, 인증을 묶는다.
// 인증은 셋이다. `coding_token`은 환경 변수 `LOPHN_CODING_TOKEN`이다. `user`는 coding token이 있으면
// 그것, 없으면 data root의 user token file이다(사람이 쓰는 run 명령). `local` 명령은 token 없이
// core를 부르지 않고 Settings와 shell main이 exec로 부른다.
// `app`은 route가 정한 대로다. core는 token에서 `app`을 채우지 않아 필수인 명령은
// 앱 id를 입력에 넣어야 한다. 앱 id는 session을 맡긴 쪽이 첫 prompt로 알려 준다.
import { z } from "zod";
import { appGet } from "../apps/apps.ts";
import { appTools } from "../apps/blueprint/read.ts";
import { appInvocations } from "../apps/calls/invocation.ts";
import { packageVersionNameSchema } from "../apps/packages.ts";
import { packagesList, packagesVersions } from "../apps/package-routes.ts";
import { previewsStart, previewsStop } from "../apps/previews.ts";
import { appLogs, appRuntime } from "../apps/runtime.ts";
import type { Route } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { jsonValueSchema } from "../base/json-values.ts";
import { toolNameSchema } from "../apps/channel-values.ts";
import { harnessDetectionSchema, harnessIdSchema } from "./harnesses.ts";
import { codingHook, HOOK_ROUTES } from "./hook.ts";
import { HARNESS_ROUTES } from "./harness-report.ts";
import { codingMessageSend, MESSAGE_ROUTES } from "./message.ts";
import { TERMINAL_ROUTES } from "./terminal-requests.ts";

// coding route 배열이다. `registry.ts`가 펼쳐 모은다.
export const CODING_ROUTES = [
  ...HOOK_ROUTES,
  ...MESSAGE_ROUTES,
  ...HARNESS_ROUTES,
  ...TERMINAL_ROUTES,
] as const;

const cliCommonSchema = z.strictObject({
  json: z.boolean().optional(),
  input: z.string().optional(),
  input_file: z.string().optional(),
  idempotency_key: z.string().optional(),
});

export type CodingCliCommand = {
  name: string;
  auth: "coding_token" | "user" | "local";
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
  return z.strictObject({ ...cliCommonSchema.shape, ...shape }).refine(
    (value) => value.input === undefined || value.input_file === undefined,
    { message: "input and input_file are exclusive" },
  );
}

function token(
  name: string,
  route: Route,
  input: z.ZodType,
  output: z.ZodType,
): CodingCliCommand {
  return {
    name,
    auth: "coding_token",
    input: withCommon(input),
    output,
    route,
  };
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
  command: z.string().regex(/^\/[\w./-]+$/).refine((path) =>
    !path.includes("..")
  ).optional(),
});
// `files`는 쓴(`dry_run`이면 쓸) 절대 경로다.
const harnessInstallOutputSchema = z.strictObject({
  skill: harnessInstallOutcomeSchema,
  hook: harnessInstallOutcomeSchema,
  files: z.array(z.string()),
});

const harnessDetections = z.array(harnessDetectionSchema);

export const CODING_CLI_COMMANDS: readonly CodingCliCommand[] = [
  token(
    "message send",
    codingMessageSend,
    codingMessageSend.input,
    codingMessageSend.output,
  ),
  // `hook <harness> <event>`. payload는 stdin JSON이다. token이 없으면 아무것도 하지 않고 성공한다.
  token(
    "hook",
    codingHook,
    (codingHook.input as z.ZodObject).omit({ payload: true }),
    codingHook.output,
  ),
  token("app show", appGet, appGet.input, appGet.output),
  token(
    "app preview start",
    previewsStart,
    previewsStart.input,
    previewsStart.output,
  ),
  token(
    "app preview stop",
    previewsStop,
    previewsStop.input,
    previewsStop.output,
  ),
  token("app status", appRuntime, appRuntime.input, appRuntime.output),
  token("app blueprint", appTools, appTools.input, appTools.output),
  token(
    "app invocations",
    appInvocations,
    appInvocations.input,
    appInvocations.output,
  ),
  token("app logs", appLogs, appLogs.input, appLogs.output),
  // 의존으로 선언된 package의 안내 읽기만 한다.
  token(
    "package list",
    packagesList,
    (packagesList.input as z.ZodObject).extend({
      query: z.string().regex(/\S/).max(200).optional(),
    }),
    packagesList.output,
  ),
  token(
    "package show",
    packagesVersions,
    (packagesVersions.input as z.ZodObject).extend({
      version: packageVersionNameSchema.optional(),
    }),
    packagesVersions.output,
  ),
  user(
    "agent run",
    z.strictObject({
      prompt: z.string().min(1),
      agent: z.string().min(1).optional().describe(
        "lophn | pm:<project> | ae:<app> | operator:<이름> | operator:<project 또는 app>/<이름> | NamedAgent JSON (없으면 lophn)",
      ),
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
  user(
    "run wait",
    z.strictObject({ run: idSchema("run") }),
  ),
  user(
    "run show",
    z.strictObject({ run: idSchema("run") }),
  ),
  user(
    "run cancel",
    z.strictObject({ run: idSchema("run") }),
  ),
  // workflow 명령도 route를 표에 두지 않는다(`cli/commands/workflow.ts`가 `protocol/workflows`의 route를 부른다).
  // 문자열 검사는 core의 route schema가 한다. 여기는 id와 `new | same`만 좁힌다.
  user(
    "workflow start",
    z.strictObject({
      workflow: z.string().min(1).describe("<project 이름>/<name>"),
      text: z.string().min(1),
      step: z.string().min(1).optional().describe(
        "첫 step 이름 (없으면 선언의 시작 step)",
      ),
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
