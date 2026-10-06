import { z } from "zod";
import { ok } from "../../../../base/mod.ts";
import {
  appBlueprint,
  appGet,
  appIdSchema,
  appRuntime,
  invocationsList,
  invocationStatusValueSchema,
  releasesList,
  releaseStatusValueSchema,
} from "../../../../contracts/apps/mod.ts";
import { readCursorSchema } from "../../../../contracts/documents/mod.ts";
import type { ToolResult } from "../../../../contracts/lophn-agent/mod.ts";
import {
  getProblem,
  getProblemInputSchema,
  getReport,
  getReportInputSchema,
  getSnapshot,
  getSnapshotInputSchema,
  getVerification,
  getVerificationInputSchema,
  listProblemFixes,
  listProblems,
  listProblemsInputSchema,
} from "../../../../contracts/problems/mod.ts";
import { fitJson, PAGE_SIZE } from "../result.ts";
import type { ToolDefinition } from "../registry.ts";
import type { RunCredential, ToolHandler } from "../work.ts";
import {
  type ContractCall,
  defineBuiltin,
  type DefineOptions,
  READ,
} from "./common.ts";
import { type Body, bodyOf, pageThrough, scopeOf } from "./paging.ts";

// 앱·problem 읽기 묶음(concern harness/tools R8). 앱 blueprint·release·invocation·정상 신호와 problem·
// 보고·snapshot·검증·고친 기록을 소유 contract 읽기 하나로 준다. 앱 소스 경로·실행 연결(endpoint·
// process nonce)·secret 값은 결과에 싣지 않는다. 앱 command 호출은 이 묶음이 아니라 blueprint에서
// 자동으로 만든 tool(`../app-tools.ts`)이 한다.

export const APP_TOOL_REVISION = "2026-10-07";

function define(
  name: string,
  description: string,
  input: z.ZodType,
  contract: string,
  scopeCheck: string,
): ToolDefinition {
  const options: DefineOptions = { ...READ, scopeCheck };
  return defineBuiltin(
    APP_TOOL_REVISION,
    name,
    description,
    input,
    contract,
    options,
  );
}

const cursor = { cursor: readCursorSchema.optional() };
const appInput = z.strictObject({ app: appIdSchema });

const APPS = "apps the assignment may read";
const PROBLEMS = "problems of apps the assignment may read";

export const appReadTool = define(
  "app.read",
  "Read one app: name, description, status, the active release, and whether it may run. No source path is read.",
  appInput,
  appGet.name,
  APPS,
);
export const appBlueprintTool = define(
  "app.blueprint",
  "Read the blueprint of the active release of an app: commands, screens, automations, declared needs, and the evidence for each.",
  appInput,
  appBlueprint.name,
  APPS,
);
export const appCommandsTool = define(
  "app.commands",
  "List the commands the active release of an app declares: key, label, description, input schema, effect, confirm, and revert support. This does not call any command.",
  appInput,
  appBlueprint.name,
  APPS,
);
export const appReleasesTool = define(
  "app.releases",
  "List the releases of an app, newest first by preparation. This changes nothing.",
  z.strictObject({
    app: appIdSchema,
    status: releaseStatusValueSchema.optional(),
    ...cursor,
  }),
  releasesList.name,
  APPS,
);
export const appHealthTool = define(
  "app.health",
  "Read whether an app is running now and why not. This changes nothing.",
  appInput,
  appRuntime.name,
  APPS,
);
export const appInvocationsTool = define(
  "app.invocations",
  "List the recorded command calls of an app: who called, which command, status, and time. This changes nothing.",
  z.strictObject({
    app: appIdSchema,
    status: invocationStatusValueSchema.optional(),
    ...cursor,
  }),
  invocationsList.name,
  APPS,
);
export const problemListTool = define(
  "problem.list",
  "List problems, optionally of one app or one status. This changes nothing.",
  z.strictObject({
    app: listProblemsInputSchema.shape.app,
    status: listProblemsInputSchema.shape.status,
    ...cursor,
  }),
  listProblems.name,
  PROBLEMS,
);
export const problemReadTool = define(
  "problem.read",
  "Read one problem: its text, status, report count, and the releases it was seen in.",
  getProblemInputSchema,
  getProblem.name,
  PROBLEMS,
);
export const reportReadTool = define(
  "report.read",
  "Read one problem report with its snapshot and what is missing from it.",
  getReportInputSchema,
  getReport.name,
  PROBLEMS,
);
export const snapshotReadTool = define(
  "snapshot.read",
  "Read one fixed snapshot of a report, or one item of it.",
  getSnapshotInputSchema,
  getSnapshot.name,
  PROBLEMS,
);
export const verificationReadTool = define(
  "verification.read",
  "Read one recorded test result.",
  z.strictObject({
    verification: getVerificationInputSchema.shape.verification,
    detail: z.boolean().optional(),
  }),
  getVerification.name,
  PROBLEMS,
);
export const repairReadTool = define(
  "repair.read",
  "List what was recorded as fixed for a problem.",
  z.strictObject({
    problem: getProblemInputSchema.shape.problem,
    ...cursor,
  }),
  listProblemFixes.name,
  PROBLEMS,
);

export const APP_READ_TOOLS: readonly ToolDefinition[] = [
  appReadTool,
  appBlueprintTool,
  appCommandsTool,
  appReleasesTool,
  appHealthTool,
  appInvocationsTool,
];
export const PROBLEM_READ_TOOLS: readonly ToolDefinition[] = [
  problemListTool,
  problemReadTool,
  reportReadTool,
  snapshotReadTool,
  verificationReadTool,
  repairReadTool,
];
export const APP_READ_TOOL_NAMES: readonly string[] = APP_READ_TOOLS.map((
  tool,
) => tool.name);
export const PROBLEM_READ_TOOL_NAMES: readonly string[] = PROBLEM_READ_TOOLS
  .map((tool) => tool.name);

export type AppReadToolPorts = ContractCall;

type AppRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  planning_version: string | null;
  active_release: string | null;
  run_enabled: boolean;
  status: string;
  revision: string;
};

function fitted(
  summary: string,
  value: Record<string, unknown>,
  arrayKeys: readonly string[] = [],
): ToolResult {
  const limited = fitJson(value, arrayKeys);
  return {
    status: "success",
    summary,
    content: limited.content as ToolResult["content"],
    complete: limited.complete,
    source: null,
    continuation: null,
    pending: [],
  };
}

export function createAppReadToolHandlers(
  ports: AppReadToolPorts,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // 소유 contract 읽기 하나의 결과를 `shape`로 줄여 돌려준다.
  function single(
    tool: ToolDefinition,
    summary: string,
    shape: (body: Body, input: never) => Record<string, unknown>,
    arrayKeys: readonly string[] = [],
    send: (input: never) => unknown = (input) => input,
  ) {
    handlers.set(
      tool.name,
      async (input: unknown, credential: RunCredential) => {
        const read = await ports.call(
          tool.contract,
          send(input as never),
          credential.run,
        );
        if (!read.ok) return read;
        const { next_cursor: _next, ...body } = bodyOf(read.value);
        return ok(
          fitted(summary, shape(body as Body, input as never), arrayKeys),
        );
      },
    );
  }

  function listing(
    tool: ToolDefinition,
    summary: string,
    key: string,
    fixed: (input: never) => Record<string, unknown>,
    paged: boolean,
  ) {
    handlers.set(
      tool.name,
      (input: unknown, credential: RunCredential) => {
        const value = input as { cursor?: string } & Record<string, unknown>;
        const { cursor: given, ...rest } = value;
        return pageThrough(
          ports,
          summary,
          tool.contract,
          scopeOf(tool.name, rest),
          given,
          { ...fixed(input as never), ...(paged ? { limit: PAGE_SIZE } : {}) },
          [key],
          credential,
        );
      },
    );
  }

  // 앱의 소스 경로는 읽는 쪽이 아니라 소유 contract에서 이미 목적 밖이다. 결과에서 뺀다.
  single(appReadTool, "app read", (body) => {
    const app = body["app"] as AppRecord;
    return {
      app: {
        id: app.id,
        slug: app.slug,
        name: app.name,
        description: app.description,
        planning_version: app.planning_version,
        active_release: app.active_release,
        run_enabled: app.run_enabled,
        status: app.status,
      },
      as_of_seq: body.as_of_seq ?? null,
    };
  });
  single(appBlueprintTool, "app blueprint read", (body) => {
    const { as_of_seq: asOf, ...rest } = body;
    return { ...rest, as_of_seq: asOf ?? null };
  }, ["commands", "screens", "automations"]);
  single(appCommandsTool, "app commands read", (body) => ({
    app: body["app"],
    release: body["release"],
    blueprint_hash: body["blueprint_hash"],
    commands: body["commands"],
    as_of_seq: body.as_of_seq ?? null,
  }), ["commands"]);
  // 연결 정보(endpoint·process nonce)는 정상 신호가 아니다. 실행 상태와 이유만 보인다.
  single(appHealthTool, "app health read", (body) => {
    const observation = body["observation"] as
      | {
        release: string | null;
        mode: string;
        ready: boolean;
        accepting: boolean;
        reason?: string;
      }
      | null;
    return {
      app: body["app"],
      state: body["state"],
      observation: observation === null ? null : {
        release: observation.release,
        mode: observation.mode,
        ready: observation.ready,
        accepting: observation.accepting,
        ...(observation.reason === undefined
          ? {}
          : { reason: observation.reason }),
      },
      observed_at: body["observed_at"] ?? null,
      as_of_seq: body.as_of_seq ?? null,
    };
  });
  listing(appReleasesTool, "app releases listed", "releases", (input) => {
    const value = input as { app: string; status?: string };
    return {
      app: value.app,
      ...(value.status === undefined ? {} : { status: value.status }),
    };
  }, true);
  listing(
    appInvocationsTool,
    "app invocations listed",
    "invocations",
    (input) => {
      const value = input as { app: string; status?: string };
      return {
        app: value.app,
        ...(value.status === undefined ? {} : { status: value.status }),
      };
    },
    true,
  );
  listing(problemListTool, "problems listed", "problems", (input) => {
    const value = input as { app?: string; status?: string };
    return {
      ...(value.app === undefined ? {} : { app: value.app }),
      ...(value.status === undefined ? {} : { status: value.status }),
    };
  }, true);
  listing(repairReadTool, "fixes listed", "fixes", (input) => ({
    problem: (input as { problem: string }).problem,
  }), false);

  single(problemReadTool, "problem read", (body) => body);
  single(reportReadTool, "report read", (body) => body);
  single(snapshotReadTool, "snapshot read", (body) => body, ["blobs"]);
  single(
    verificationReadTool,
    "verification read",
    (body) => body,
    [],
    (input) => ({
      verification: (input as { verification: string }).verification,
      detail: (input as { detail?: boolean }).detail ?? false,
    }),
  );
  return handlers;
}
