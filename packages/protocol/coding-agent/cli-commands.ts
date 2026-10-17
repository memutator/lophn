// coding agent CLI의 명령 목록. 이름, 입력, 출력, 인증을 묶는다.
// 인증은 환경 변수 `LOPHN_CODING_TOKEN`(`coding_token`)뿐이다. `local` 명령은 token 없이
// core를 부르지 않고 Settings와 shell main이 exec로 부른다.
// 앱은 token이 정하므로 입력의 `app`은 선택이다.
import { z } from "zod";
import { appGet } from "../apps/apps.ts";
import { appAppApi } from "../apps/blueprint/read.ts";
import { appInvocations } from "../apps/calls/invocation.ts";
import { appIdSchema } from "../apps/channel-values.ts";
import { packageVersionNameSchema } from "../apps/packages.ts";
import { packagesList, packagesVersions } from "../apps/package-routes.ts";
import { previewsStart, previewsStop } from "../apps/previews.ts";
import { releasePrepareBundle } from "../apps/releases.ts";
import { appLogs, appRuntime } from "../apps/runtime.ts";
import type { Route } from "../base/route.ts";
import { requestTest } from "../problems/tests.ts";
import {
  problemGet,
  problemList,
  problemMore,
} from "../problems/problem-views.ts";
import { CODING_SKILL_NAMES } from "./harness-adapter.ts";
import { harnessDetectionSchema, harnessIdSchema } from "./harnesses.ts";
import { codingHook, HOOK_ROUTES } from "./hook.ts";
import { HARNESS_ROUTES } from "./harness-report.ts";
import { codingMessageSend, MESSAGE_ROUTES } from "./message.ts";
import { codingSourceDiff, SOURCE_DIFF_ROUTES } from "./source-diff.ts";
import { TERMINAL_ROUTES } from "./terminal-requests.ts";
import {
  ticketClaim,
  ticketRenewClaim,
  ticketReportCompletion,
  ticketReportToolInputSchema,
} from "./ticket/claims.ts";
import { ticketList, ticketShow } from "./ticket/routes.ts";

// coding route 배열이다. `registry.ts`가 펼쳐 모은다.
export const CODING_ROUTES = [
  ...HOOK_ROUTES,
  ...MESSAGE_ROUTES,
  ...SOURCE_DIFF_ROUTES,
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
  auth: "coding_token" | "local";
  input: z.ZodType;
  output: z.ZodType;
  route?: Route;
};

// route 입력 위에 공통 칸을 얹는다. route 쪽 검사는 core가 다시 한다. 칸 이름이 겹치면 route 쪽이 이긴다.
function withCommon(input: z.ZodType): z.ZodType {
  if (!(input instanceof z.ZodObject)) {
    throw new Error("cli input must be an object");
  }
  const shape = { ...input.shape } as Record<string, z.ZodType>;
  if ("app" in shape) shape["app"] = appIdSchema.optional();
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
    "ticket list",
    ticketList,
    ticketList.input,
    ticketList.output,
  ),
  // 근거 annotation은 메모, component 겹, release, screenshot 파일 경로까지 돌려준다.
  token("ticket show", ticketShow, ticketShow.input, ticketShow.output),
  token("ticket claim", ticketClaim, ticketClaim.input, ticketClaim.output),
  token(
    "ticket renew",
    ticketRenewClaim,
    ticketRenewClaim.input,
    ticketRenewClaim.output,
  ),
  // summary 본문을 받아 hash를 내고 upload한 뒤 완료 보고한다.
  token(
    "ticket report",
    ticketReportCompletion,
    ticketReportToolInputSchema,
    ticketReportCompletion.output,
  ),
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
  token("app test", requestTest, requestTest.input, requestTest.output),
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
  token("app blueprint", appAppApi, appAppApi.input, appAppApi.output),
  token(
    "app invocations",
    appInvocations,
    appInvocations.input,
    appInvocations.output,
  ),
  token("app logs", appLogs, appLogs.input, appLogs.output),
  // 지금 claim 아래에서 release를 준비한다.
  token(
    "release prepare",
    releasePrepareBundle,
    releasePrepareBundle.input,
    releasePrepareBundle.output,
  ),
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
  token(
    "problem list",
    problemList,
    problemList.input,
    problemList.output,
  ),
  token("problem show", problemGet, problemGet.input, problemGet.output),
  token("problem more", problemMore, problemMore.input, problemMore.output),
  token(
    "problem diff",
    codingSourceDiff,
    codingSourceDiff.input,
    codingSourceDiff.output,
  ),
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
  // `guide <name>`: skill의 절차 본문을 돌려준다(전역 skill은 얇고 이 명령을 가리킨다).
  {
    name: "guide",
    auth: "local",
    input: withCommon(z.strictObject({ name: z.enum(CODING_SKILL_NAMES) })),
    output: z.string(),
  },
];
