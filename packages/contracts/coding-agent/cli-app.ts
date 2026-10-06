import { z } from "zod";
import { appConnectSource, appCreate, appGet, appList } from "../apps/apps.ts";
import { invocationsGet, invocationsList } from "../apps/invocations.ts";
import { appLogs, appRuntime, RUNTIME_MODES } from "../apps/runtime.ts";
import { commandKeySchema } from "../apps/channel-values.ts";
import { previewsStart, previewsStop } from "../apps/previews.ts";
import { releasePrepareBundle } from "../apps/releases.ts";
import { requestTest } from "../problems/tests.ts";
import {
  sdkAddFields,
  sdkCatalogFields,
  sdkShowFields,
} from "./mcp-app.ts";
import {
  packagesGuide,
  packagesList,
  packagesVersions,
} from "../apps/package-routes.ts";
import {
  ticketChecks,
  ticketList,
  ticketShow,
  ticketShowInputSchema,
} from "./ticket-routes.ts";
import {
  ticketReleaseClaim,
  ticketRenewClaim,
  ticketReportCompletion,
} from "./ticket-claims.ts";
import { cliCommonSchema } from "./cli-core.ts";

// CLI도 MCP가 고른 op 밖의 command를 만들지 않는다(cli-decisions·cli-setup 같은
// 모양). 위치 인자가 없고 선택값만 있다. refine을 가진 owner 입력(test 등)은
// extend가 key를 덮지 못하므로 안전 확장(safeExtend)을 쓰고, owner shape를 한 번 더
// 펼쳐 common이 owner field type(base_revision·input)을 덮지 않게 한다. 펼침은
// shape 사본이라 common의 exclusive refine을 다시 붙인다.
const common = cliCommonSchema.shape;
const withCommon = <T extends z.ZodRawShape>(
  command: string,
  input: z.ZodObject<T>,
) => {
  const extensible = input as z.ZodObject<T> & {
    safeExtend: (schema: Record<string, z.ZodType>) => z.ZodObject<T>;
  };
  const merged = extensible.safeExtend({
    command: z.literal(command),
    ...common,
    ...(input.shape as unknown as Record<string, z.ZodType>),
  });
  return (merged as unknown as z.ZodObject<Record<string, z.ZodType>>).refine(
    (value: { input?: unknown; input_file?: unknown }) =>
      value.input === undefined || value.input_file === undefined,
    { message: "input and input_file are exclusive" },
  );
};

// `lophn app ...`(cli#R24). list·show·path는 apps.list·get 결과, register는
// apps.create, source는 apps.connect_source다.
export const cliAppListSchema = withCommon("app list", appList.input);
export const cliAppShowSchema = withCommon("app show", appGet.input);
// path는 app과 source 위치만 읽는다(appSchema의 source_path).
export const cliAppPathSchema = withCommon("app path", appGet.input);
export const cliAppRegisterSchema = withCommon(
  "app register",
  appCreate.input,
);
export const cliAppSourceSchema = withCommon(
  "app source",
  appConnectSource.input,
);
// validate는 준비 접수의 blueprint diagnostics·bundle_hash를 낸다(mcp#R20).
export const cliAppValidateSchema = withCommon(
  "app validate",
  releasePrepareBundle.input,
);
// test는 problems RequestTest의 소유 contract 입력을 그대로 받는다(cli#R26).
export const cliAppTestSchema = withCommon("app test", requestTest.input);
export const cliAppPreviewStartSchema = withCommon(
  "app preview start",
  previewsStart.input,
);
export const cliAppPreviewStopSchema = withCommon(
  "app preview stop",
  previewsStop.input,
);
export const cliAppReleasePrepareSchema = withCommon(
  "app release prepare",
  releasePrepareBundle.input,
);
export const cliAppStatusSchema = withCommon("app status", appRuntime.input);
export const cliAppBlueprintSchema = withCommon(
  "app blueprint",
  appGet.input,
);
export const cliAppInvocationsSchema = withCommon(
  "app invocations",
  invocationsList.input,
);
export const cliAppLogsSchema = withCommon("app logs", appLogs.input);
// sync-tools는 재배포 접수다(mcp#R19, cli#R29). 파일별 결과는 host가 낸다.
export const cliAppSyncToolsSchema = withCommon(
  "app sync-tools",
  appGet.input,
);

// `lophn sdk catalog|show|add`(cli#R30). catalog는 검색, show는 상세, add는
// exact version 추가다.
// 더한 field는 MCP `lophn_sdk`과 같다. add의 반영 앱은 공통 `--app`이다.
export const cliSdkCatalogSchema = withCommon(
  "sdk catalog",
  packagesList.input.extend(sdkCatalogFields),
);
export const cliSdkShowSchema = withCommon(
  "sdk show",
  packagesVersions.input.extend(sdkShowFields),
);
export const cliSdkAddSchema = withCommon(
  "sdk add",
  packagesGuide.input.extend({ apply: sdkAddFields.apply }),
);

// `lophn app command|invocation|automation run`(cli#R31, R32). command는
// appRuntime.input, invocation은 invocationsGet.input, automation run도 같은
// command 경계를 쓴다.
// `command` 이름은 CLI command 이름 literal이 쓰므로 앱 command key는 `name`이다. 그 command의
// JSON 입력은 공통 `--input`/`--input-file`이 싣고, 환경은 preview가 기본이다(cli#R31).
export const cliAppCommandSchema = withCommon(
  "app command",
  appRuntime.input.extend({
    name: commandKeySchema,
    environment: z.enum(RUNTIME_MODES).optional(),
    timeout_ms: z.number().int().min(1).optional(),
  }),
);
// invocation은 같은 환경의 기록만 읽는다. 환경 기본은 preview다(cli#R32, mcp#R29).
export const cliAppInvocationSchema = withCommon(
  "app invocation",
  invocationsGet.input.extend({
    app: z.string().optional(),
    environment: z.enum(RUNTIME_MODES).optional(),
  }),
);
export const cliAppAutomationRunSchema = withCommon(
  "app automation run",
  appRuntime.input,
);

// 사람 전용 `app start|stop|release activate`(cli#R7). coding credential은 거절이고
// 결정 화면 링크·대기 사실만 낸다.
const APP_HUMAN_ONLY_NAMES = [
  "app start",
  "app stop",
  "app release activate",
] as const;
export const appHumanOnlyNames = APP_HUMAN_ONLY_NAMES;
export const cliAppStartSchema = withCommon(
  "app start",
  z.strictObject({}),
);
export const cliAppStopSchema = withCommon(
  "app stop",
  z.strictObject({}),
);
export const cliAppReleaseActivateSchema = withCommon(
  "app release activate",
  z.strictObject({}),
);
export type CliAppHumanOnlyName = (typeof APP_HUMAN_ONLY_NAMES)[number];

// `lophn ticket ...`(cli#R36, R41). list·show·checks는 읽기, claim은 MCP 안내,
// renew·release·report는 대응 contract 입력이다.
export const cliTicketListSchema = withCommon(
  "ticket list",
  ticketList.input,
);
export const cliTicketShowSchema = withCommon(
  "ticket show",
  ticketShow.input,
);
export const cliTicketChecksSchema = withCommon(
  "ticket checks",
  ticketChecks.input,
);
// CLI claim은 실행하지 않는다. MCP 연결·지정 ticket 안내로 끝난다(cli#R41).
export const cliTicketClaimSchema = withCommon(
  "ticket claim",
  z.strictObject({ ticket: ticketShowInputSchema.shape.ticket }),
);
export const cliTicketRenewSchema = withCommon(
  "ticket renew",
  ticketRenewClaim.input,
);
export const cliTicketReleaseSchema = withCommon(
  "ticket release",
  ticketReleaseClaim.input,
);
export const cliTicketReportSchema = withCommon(
  "ticket report",
  ticketReportCompletion.input,
);

export const CLI_APP_NAMES = [
  "app list",
  "app show",
  "app path",
  "app register",
  "app source",
  "app validate",
  "app test",
  "app preview start",
  "app preview stop",
  "app release prepare",
  "app status",
  "app blueprint",
  "app invocations",
  "app logs",
  "app sync-tools",
  "app command",
  "app invocation",
  "app automation run",
  "app start",
  "app stop",
  "app release activate",
  "sdk catalog",
  "sdk show",
  "sdk add",
  "ticket list",
  "ticket show",
  "ticket checks",
  "ticket claim",
  "ticket renew",
  "ticket release",
  "ticket report",
] as const;

export type CliAppName = (typeof CLI_APP_NAMES)[number];
