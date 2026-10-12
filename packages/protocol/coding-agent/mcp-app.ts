import { z } from "zod";
import { appConnectSource, appCreate, appGet, appList } from "../apps/apps.ts";
import { invocationsGet, invocationsList } from "../apps/invocations.ts";
import { appLogs, appRuntime, RUNTIME_MODES } from "../apps/runtime.ts";
import { previewsStart, previewsStop } from "../apps/previews.ts";
import { releasePreparation, releasePrepareBundle } from "../apps/releases.ts";
import { requestTest } from "../problems/tests.ts";
import {
  packagesGuide,
  packagesList,
  packagesVersions,
} from "../apps/package-routes.ts";
import { appIdSchema, commandKeySchema } from "../apps/channel-values.ts";
import { packageVersionNameSchema } from "../apps/packages.ts";
import {
  ticketClaim,
  ticketReleaseClaim,
  ticketRenewClaim,
  ticketReportCompletion,
  ticketReportToolInputSchema,
} from "./ticket-claims.ts";
import { ticketChecks, ticketList, ticketShow } from "./ticket-routes.ts";
import { readOnlyHint, type ScopeMark, type Toolset } from "./output.ts";

// app 환경은 preview가 기본이고 운영은 live다(runtime mode 어휘).
const environmentSchema = z.enum(RUNTIME_MODES).optional();

// runtime adapter의 동작 command다(architecture 5.2). app·command·JSON input·
// environment·양의 timeout_ms?이며 기본 preview다. coding credential은
// effect=read·confirm=false인 command만 호출하므로 판정은 host에 남는다.
const commandOpInput = appRuntime.input.extend({
  op: z.literal("command"),
  command: commandKeySchema,
  input: z.unknown().optional(),
  environment: environmentSchema,
  timeout_ms: z.number().int().min(1).optional(),
});

// tool 입력은 owner route 입력을 다시 적지 않고 고른다(mcp-core·mcp-problem 같은
// 모양). app·state·status 같은 filter 이름도 owner 것이 그대로다.
const appReaderInput = z.discriminatedUnion("op", [
  appList.input.extend({ op: z.literal("list") }),
  appGet.input.extend({ op: z.literal("show") }),
  appCreate.input.extend({ op: z.literal("register") }),
  appConnectSource.input.extend({ op: z.literal("source") }),
  releasePrepareBundle.input.extend({ op: z.literal("validate") }),
  releasePreparation.input.extend({ op: z.literal("preparation") }),
  requestTest.input.extend({ op: z.literal("test") }),
  previewsStart.input.extend({ op: z.literal("preview_start") }),
  previewsStop.input.extend({ op: z.literal("preview_stop") }),
  releasePrepareBundle.input.extend({ op: z.literal("release_prepare") }),
  appRuntime.input.extend({ op: z.literal("status") }),
  appRuntime.input.extend({ op: z.literal("blueprint") }),
  invocationsList.input.omit({ limit: true }).extend({
    op: z.literal("invocations"),
    // plan 완료 기준은 페이지당 최대 20개다. owner 200을 20으로 묶는다.
    limit: z.number().int().min(1).max(20).optional(),
  }),
  invocationsGet.input.extend({
    op: z.literal("invocation"),
    app: z.string().optional(),
    environment: environmentSchema,
  }),
  appLogs.input.extend({ op: z.literal("logs") }),
  appRuntime.input.extend({ op: z.literal("sync_tools") }),
  commandOpInput,
]);

// SDK tool은 catalog 검색·상세·exact version 추가뿐이다. owner route 입력에
// 통로가 쓰는 field만 더한다: catalog의 설명·API 이름 검색어(`query`), show의 고를 version,
// add의 source 반영 선택(`apply`)과 반영할 앱. 더한 field는 owner route로 보내지 않는다.
export const sdkCatalogFields = {
  query: z.string().regex(/\S/).max(200).optional(),
};
export const sdkShowFields = {
  version: packageVersionNameSchema.optional(),
};
export const sdkAddFields = {
  apply: z.boolean().optional(),
  app: appIdSchema.optional(),
};
const sdkInput = z.discriminatedUnion("op", [
  packagesList.input.extend({
    op: z.literal("catalog"),
    ...sdkCatalogFields,
  }),
  packagesVersions.input.extend({ op: z.literal("show"), ...sdkShowFields }),
  packagesGuide.input.extend({ op: z.literal("add"), ...sdkAddFields }),
]);

// ticket tool은 목록·본문·조건 검사와 claim 읽기·갱신·반납·release 연결·완료 보고다.
// create·cancel·check 판정·start·resume·permission 응답 op는 없다.
const ticketInput = z.discriminatedUnion("op", [
  ticketList.input.extend({ op: z.literal("list") }),
  ticketShow.input.extend({ op: z.literal("show") }),
  ticketChecks.input.extend({ op: z.literal("checks") }),
  ticketClaim.input.extend({ op: z.literal("claim") }),
  ticketRenewClaim.input.extend({ op: z.literal("renew") }),
  ticketReleaseClaim.input.extend({ op: z.literal("release") }),
  ticketReportToolInputSchema.extend({ op: z.literal("report") }),
]);

export const MCP_APP_TOOLS = [
  {
    name: "lophn_app",
    toolset: "app",
    scope: "S/A",
    input: appReaderInput,
    ops: [
      "list",
      "show",
      "register",
      "source",
      "validate",
      "test",
      "preview_start",
      "preview_stop",
      "release_prepare",
      "status",
      "blueprint",
      "invocations",
      "logs",
      "sync_tools",
      "command",
      "invocation",
    ],
  },
  {
    name: "lophn_sdk",
    toolset: "app",
    scope: "G",
    input: sdkInput,
    ops: ["catalog", "show", "add"],
  },
  {
    name: "lophn_ticket",
    toolset: "app",
    scope: "S/A",
    input: ticketInput,
    ops: ["list", "show", "checks", "claim", "renew", "release", "report"],
  },
] as const satisfies readonly {
  name: string;
  toolset: Toolset;
  // architecture 표는 S/A로 쓴다. connection scope(S)와 app 대상(A) 검사가 둘 다 붙는다.
  scope: ScopeMark | "S/A";
  input: z.ZodType;
  ops: readonly string[];
}[];

export type McpAppToolName = (typeof MCP_APP_TOOLS)[number]["name"];

export const MCP_APP_ROUTES = {
  lophn_app: {
    list: appList,
    show: appGet,
    register: appCreate,
    source: appConnectSource,
  },
  lophn_sdk: {
    catalog: packagesList,
    show: packagesVersions,
    add: packagesGuide,
  },
  lophn_ticket: {
    list: ticketList,
    show: ticketShow,
    checks: ticketChecks,
    claim: ticketClaim,
    renew: ticketRenewClaim,
    release: ticketReleaseClaim,
    report: ticketReportCompletion,
  },
} as const;

export function mcpAppTool(name: string) {
  const tool = MCP_APP_TOOLS.find((item) => item.name === name);
  if (!tool) return undefined;
  // register·validate·쓰기 op를 가진 tool이므로 읽기 전용 주석은 없다(output.ts).
  return { ...tool, readOnlyHint: readOnlyHint(tool.name) };
}

// blueprint 유래 read tool 이름이다. Gemini CLI가 `mcp_<server>_<tool>`
// 을 63자에서 해시 없이 자르므로 app ID는 sha256 hex의 앞 12자, command 이름은 sha256
// hex의 앞 16자로 줄여 전체 39자에 둔다. 원 앱 이름과 command 이름은 description에
// 넣는다.
export const APP_TOOL_NAME_PREFIX = "lophn_app_";
export const APP_TOOL_NAME_LENGTH = 39;

export function appToolName(
  appIdHash: string,
  commandKeyHash: string,
): string {
  return `${APP_TOOL_NAME_PREFIX}${appIdHash.slice(0, 12)}_${
    commandKeyHash.slice(0, 16)
  }`;
}

// blueprint 유래 read tool의 바깥 입력이다. command input과 겹치지 않는
// 객체에 두고 같은 앱 통로 client로 호출한다. environment 생략은 preview다.
export const appCommandToolInputSchema = z.strictObject({
  input: z.unknown().optional(),
  environment: environmentSchema,
  timeout_ms: z.number().int().min(1).optional(),
});
