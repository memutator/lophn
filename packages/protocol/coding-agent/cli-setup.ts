import { z } from "zod";
import { seqSchema } from "../base/values.ts";
import { harnessIdSchema, integrationTargetSchema } from "./harnesses.ts";
import { sessionPlanInputSchema, sessionPlanOutputSchema } from "./launch.ts";
import { connectionIdSchema, connectionScopeSchema } from "./connections.ts";
import { cliCommonSchema } from "./cli-core.ts";
import { CodingAgentSessionSummaryInputSchema } from "./sessions.ts";

// CLI도 MCP가 고른 op 밖의 command를 만들지 않는다(cli-decisions와 같다).
// 위치 인자가 없고 선택값만 있다. 사람 전용 command는 허락 입력을 받지 않는다.
const common = cliCommonSchema.shape;
const withCommon = <T extends z.ZodRawShape>(
  command: string,
  input: z.ZodObject<T>,
) => input.extend({ command: z.literal(command), ...common });

// `lophn doctor`의 입력(cli#R10). target·profile과 함께 daemon·인증·설정과 네
// loading 단계 결과를 낸다. app은 공통 선택값에 더해 앱 안내 loading 대상이다.
export const cliDoctorSchema = withCommon(
  "doctor",
  z.strictObject({
    target: integrationTargetSchema.optional(),
  }),
);

// `lophn daemon start|stop|status|logs`(cli#R8). start·stop은 사람 전용이라
// coding credential이 부르지 못하고 status·logs는 token 없이 읽는다.
export const cliDaemonStartSchema = withCommon(
  "daemon start",
  z.strictObject({}),
);
export const cliDaemonStopSchema = withCommon(
  "daemon stop",
  z.strictObject({}),
);
export const cliDaemonStatusSchema = withCommon(
  "daemon status",
  z.strictObject({}),
);
export const cliDaemonLogsSchema = withCommon(
  "daemon logs",
  z.strictObject({
    cursor: z.string().min(1).optional(),
    lines: z.number().int().min(1).max(2_000).optional(),
  }),
);

// 공통 선택에 더해 필수가 되는 값은 common 뒤에 다시 적는다. extend는 뒤의
// key가 이기므로 common을 먼저 펼치고 필수 값을 덮는다.
const commonWith = <T extends z.ZodRawShape>(
  command: string,
  required: T,
) => z.strictObject({ command: z.literal(command), ...common, ...required });

// `lophn mcp config`(cli#R9). 선택 제품의 executable·분리 argv·환경 조각만
// 문자열로 반환하고 제품 설정 파일은 고치지 않는다. scope는 user|app이며
// connection이 필수다.
export const cliMcpConfigSchema = commonWith("mcp config", {
  target: harnessIdSchema,
  scope: z.enum(["user", "app"]),
  connection: connectionIdSchema,
  toolsets: z.string().min(1).optional(),
});

// `lophn harness list|detect|refresh|inspect|plan|install|update|remove`
// (cli#R40). catalog·최초 감지·사람 요청 재감지·자원별 observance·설치 계획·
// 설치·갱신·제거다. 관리 쓰기(plan·install·update·remove)는 사람 전용이다.
export const cliHarnessListSchema = withCommon(
  "harness list",
  z.strictObject({}),
);
export const cliHarnessDetectSchema = withCommon(
  "harness detect",
  z.strictObject({}),
);
export const cliHarnessRefreshSchema = withCommon(
  "harness refresh",
  z.strictObject({}),
);
export const cliHarnessInspectSchema = withCommon(
  "harness inspect",
  z.strictObject({
    harness: harnessIdSchema.optional(),
  }),
);
export const cliHarnessPlanSchema = withCommon(
  "harness plan",
  z.strictObject({
    target: integrationTargetSchema,
    components: z.array(z.string().min(1)).min(1),
  }),
);
export const cliHarnessInstallSchema = withCommon(
  "harness install",
  z.strictObject({
    target: integrationTargetSchema,
    components: z.array(z.string().min(1)).min(1),
    operation_id: z.string().min(1),
  }),
);
export const cliHarnessUpdateSchema = withCommon(
  "harness update",
  z.strictObject({
    target: integrationTargetSchema,
    components: z.array(z.string().min(1)).min(1),
  }),
);
export const cliHarnessRemoveSchema = withCommon(
  "harness remove",
  z.strictObject({
    target: integrationTargetSchema,
    components: z.array(z.string().min(1)).min(1),
  }),
);

// `lophn skills list|install`(cli#R10). 목록은 이름·설명·version을 읽고 설치는
// 사람이 고른 catalog target에 한다.
export const cliSkillsListSchema = withCommon(
  "skills list",
  z.strictObject({}),
);
export const cliSkillsInstallSchema = withCommon(
  "skills install",
  z.strictObject({
    target: integrationTargetSchema,
    names: z.array(z.string().min(1)).min(1).optional(),
  }),
);

// `lophn connection list|show|create|revoke|install`(cli#R6, R7, R8).
// create·install은 사람 전용, revoke는 사람 전용에 confirmation window를 쓴다.
export const cliConnectionListSchema = withCommon(
  "connection list",
  z.strictObject({}),
);
export const cliConnectionShowSchema = withCommon(
  "connection show",
  z.strictObject({
    connection: connectionIdSchema,
  }),
);
// create는 사람이 고른 label·scope만 받는다. token 검증 hash는 인증 경계가 준비하고
// 원문 token field는 없다. label은 connections.ts와 같이 공백뿐인 문자열을 거절한다.
export const cliConnectionCreateSchema = commonWith("connection create", {
  label: z.string().regex(/\S/),
  scope: connectionScopeSchema,
});
export const cliConnectionRevokeSchema = commonWith("connection revoke", {
  connection: connectionIdSchema,
  base_revision: seqSchema,
});
export const cliConnectionInstallSchema = withCommon(
  "connection install",
  z.strictObject({
    target: integrationTargetSchema,
    connection: connectionIdSchema,
  }),
);

// `lophn session summary|plan`(cli#R40). summary는 lophn_session 결과를 내고
// hook mode일 때 출력 상한이 guides.ts에 있다. plan의 stdin·stdout은 launch.ts
// 의 sessionPlan 입출력을 그대로 한다.
export const cliSessionSummarySchema = withCommon(
  "session summary",
  z.strictObject({
    ...CodingAgentSessionSummaryInputSchema.shape,
    hook: z.boolean().optional(),
    // 설치한 hook command가 소유 항목을 찾는 표식이다. 실행에는 쓰지 않는다(harnesses#R11).
    owner: z.string().min(1).optional(),
  }),
);
export const cliSessionPlanSchema = withCommon(
  "session plan",
  z.strictObject({
    plan_input: sessionPlanInputSchema,
  }),
);
export const cliSessionPlanOutputSchema = sessionPlanOutputSchema;
// `lophn session observe --hook <harness>`는 제품 hook·plugin·extension이 stdin으로 준 payload를 정규화해
// `LOPHN_TERMINAL_OBSERVE` socket에만 쓴다(sessions#R6). 환경에 socket이 없으면 아무것도 보내지 않는다.
export const cliSessionObserveSchema = withCommon(
  "session observe",
  z.strictObject({
    hook: harnessIdSchema,
  }),
);

export const CLI_SETUP_NAMES = [
  "doctor",
  "daemon start",
  "daemon stop",
  "daemon status",
  "daemon logs",
  "mcp config",
  "harness list",
  "harness detect",
  "harness refresh",
  "harness inspect",
  "harness plan",
  "harness install",
  "harness update",
  "harness remove",
  "skills list",
  "skills install",
  "connection list",
  "connection show",
  "connection create",
  "connection revoke",
  "connection install",
  "session summary",
  "session plan",
  "session observe",
] as const;

export type CliSetupName = (typeof CLI_SETUP_NAMES)[number];

// 사람 전용 command다(daemon start·stop, connection create·revoke·install).
// coding credential로는 거절이다(architecture 5.4의 사람 전용 표시).
export const HUMAN_ONLY_NAMES = [
  "daemon start",
  "daemon stop",
  "connection create",
  "connection revoke",
  "connection install",
  "harness plan",
  "harness install",
  "harness update",
  "harness remove",
  "skills install",
  // 시작 계획은 사람 클릭을 검증한 shell main만 부른다(sessions#R2).
  "session plan",
] as const;

export type HumanOnlyName = (typeof HUMAN_ONLY_NAMES)[number];

// 사람이 confirmation window를 쓰는 command다(cli#R7). revoke만 그렇다.
export const CONFIRMATION_NAMES = ["connection revoke"] as const;

export const CLI_SETUP_COMMANDS = [
  cliDoctorSchema,
  cliDaemonStartSchema,
  cliDaemonStopSchema,
  cliDaemonStatusSchema,
  cliDaemonLogsSchema,
  cliMcpConfigSchema,
  cliHarnessListSchema,
  cliHarnessDetectSchema,
  cliHarnessRefreshSchema,
  cliHarnessInspectSchema,
  cliHarnessPlanSchema,
  cliHarnessInstallSchema,
  cliHarnessUpdateSchema,
  cliHarnessRemoveSchema,
  cliSkillsListSchema,
  cliSkillsInstallSchema,
  cliConnectionListSchema,
  cliConnectionShowSchema,
  cliConnectionCreateSchema,
  cliConnectionRevokeSchema,
  cliConnectionInstallSchema,
  cliSessionSummarySchema,
  cliSessionPlanSchema,
  cliSessionObserveSchema,
] as const;
