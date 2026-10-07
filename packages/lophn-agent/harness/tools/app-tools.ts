import { z } from "zod";
import { err, fingerprint, ok, type Result } from "../../../base/mod.ts";
import {
  type AppBlueprintCommand,
  appConnect,
  type InputSchema,
  type Invocation,
  invocationsList,
  validateInput,
} from "../../../contracts/apps/mod.ts";
import type {
  AgentAppScope,
  ToolResult,
} from "../../../contracts/lophn-agent/mod.ts";
import { COMMON_ERRORS, type ContractCall } from "./bundles/common.ts";
import { limitJson } from "./result.ts";
import type { ToolDefinition } from "./registry.ts";
import type { RunCredential, ToolHandler } from "./work.ts";

// 앱 command 자동 tool(concern harness/tools R16, R17). 허락된 앱의 active release blueprint에서 command
// 하나마다 tool 정의 하나를 만든다. 별도 MCP 등록도 app proxy server도 없다. 정의의 입력 schema는
// blueprint의 InputSchema 그대로이고 목록과 실행 검사가 같은 선언을 쓴다. 소스·원본 파일·secret 값에는
// 닿는 통로가 없다: 호출은 앱 통로(`app.connect`의 제한 연결과 앱 direct 호출) 하나뿐이다.

export const APP_TOOL_CONTRACT = appConnect.name;
export const APP_TOOL_PREFIX = "app_";

// active release의 blueprint에서 command 정의만 읽은 값이다. 범위 밖·없는 앱과 active release가 없는
// 앱은 읽히지 않는다(같은 답).
export type AppBlueprintView = {
  app: string;
  name: string;
  release: string;
  blueprint_hash: string;
  commands: readonly AppBlueprintCommand[];
};

// 현재 허락(agent.commands grant)이 연 command다. grant ID는 판정 근거에 남고 basis_seq는
// grant 집합이 마지막으로 바뀐 seq다(호출 기록의 permission_basis 원문).
export type AppGrant = {
  grant: string;
  commands: readonly string[];
  basis_seq: string;
};

// command를 연 grant다. 여럿이면 ID가 앞선 것이다. 없으면 허락이 없다.
export function grantFor(
  grants: readonly AppGrant[],
  command: string,
): AppGrant | undefined {
  return grants.filter((entry) => entry.commands.includes(command))
    .sort((a, b) => (a.grant < b.grant ? -1 : a.grant > b.grant ? 1 : 0))[0];
}

export type AppTool = {
  definition: ToolDefinition;
  app: string;
  appName: string;
  release: string;
  blueprintHash: string;
  command: string;
  effect: AppBlueprintCommand["effect"];
  confirm: boolean;
  // blueprint가 되돌리기 지원을 선언하고 대응 write command가 같은 blueprint에 있다.
  reversible: boolean;
  // 이 정의가 만들어진 선언의 지문. release·입력·effect·confirm·되돌리기 중 하나라도 바뀌면 달라진다.
  definitionHash: string;
  schema: InputSchema | null;
  // 사람의 허락 근거(grant·scope·basis_seq)다. 호출 기록이 이 열로 묶여 revert가 앱의 선언된
  // revert command를 부른다(lophn-agent#T48).
  permissionBasis: { grant: string; scope: string; basis_seq: string };
};

// 대응 command가 검증된 되돌리기만 지원으로 본다(tool-judgment R11). 선언 `supported`만으로 낮추지 않는다.
export function revertCounterpart(
  commands: readonly AppBlueprintCommand[],
  command: AppBlueprintCommand,
): string | null {
  if (command.effect !== "write" || command.revert?.supported !== true) {
    return null;
  }
  const counterpart = commands.find((entry) =>
    entry.key === command.revert?.command
  );
  return counterpart !== undefined && counterpart.key !== command.key &&
      counterpart.effect === "write"
    ? counterpart.key
    : null;
}

// command 선언 하나의 지문이다. 정의와 호출 직전 재검사가 같은 함수를 쓴다.
export function appDefinitionHash(
  view: Pick<AppBlueprintView, "app" | "release" | "blueprint_hash">,
  command: AppBlueprintCommand,
  reversible: boolean,
): Promise<string> {
  return fingerprint({
    app: view.app,
    release: view.release,
    blueprint_hash: view.blueprint_hash,
    key: command.key,
    label: command.label,
    description: command.description,
    effect: command.effect,
    confirm: command.confirm,
    input: command.input,
    reversible,
  });
}

async function appToolName(app: string, command: string): Promise<string> {
  const appHash = (await fingerprint(app)).slice(0, 8);
  const commandHash = (await fingerprint(command)).slice(0, 6);
  const readable = command.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
  return `${APP_TOOL_PREFIX}${appHash}_${readable}_${commandHash}`;
}

const NO_INPUT = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

// 입력이 object인 command는 그 입력이 tool 입력이고, 입력이 없는 command는 빈 object, 그 밖의 종류는
// `{input}` 하나로 감싼다(model의 tool 입력은 object여야 한다).
function toolInputSchema(schema: InputSchema | null): Record<string, unknown> {
  if (schema === null) return NO_INPUT;
  if (schema.type === "object") return schema as Record<string, unknown>;
  return {
    type: "object",
    properties: { input: schema },
    required: ["input"],
    additionalProperties: false,
  };
}

// 실행 검사다. blueprint의 검사(`validateInput`)를 그대로 쓰되 default를 채우지 않고 값을 바꾸지
// 않는다(R3). 반환 값은 입력 그대로다.
function toolInputValidator(schema: InputSchema | null): z.ZodType {
  return z.unknown().superRefine((value, context) => {
    const fail = (message: string) =>
      context.addIssue({ code: "custom", message });
    const plain = typeof value === "object" && value !== null &&
      !Array.isArray(value);
    if (schema === null) {
      if (!plain || Object.keys(value as object).length > 0) {
        fail("this command takes no input");
      }
      return;
    }
    if (schema.type === "object") {
      const checked = validateInput(schema, value);
      if (!checked.ok) fail(checked.error.message);
      return;
    }
    if (!plain || Object.keys(value as object).join() !== "input") {
      fail("input must be { input }");
      return;
    }
    const checked = validateInput(schema, (value as { input: unknown }).input);
    if (!checked.ok) fail(checked.error.message);
  });
}

// 앱에 보내는 command 입력이다. 입력이 없는 command는 보내지 않는다.
export function commandInputOf(tool: AppTool, input: unknown): unknown {
  if (tool.schema === null) return undefined;
  return tool.schema.type === "object"
    ? input
    : (input as { input: unknown }).input;
}

export type AppToolSource = {
  scope: AgentAppScope;
  views: readonly AppBlueprintView[];
  grants: ReadonlyMap<string, readonly AppGrant[]>;
};

// 역할·현재 허락·assignment의 교집합만 정의가 된다(R17). 범위(AgentAppScope)는 StartRun이 고정한
// 역할·assignment 상한이고, blueprint와 grant는 지금의 선언과 허락이다. 하나라도 빠지면 정의가 없다.
export async function buildAppTools(
  source: AppToolSource,
): Promise<readonly AppTool[]> {
  const tools: AppTool[] = [];
  const names = new Set<string>();
  for (const entry of source.scope.apps) {
    const view = source.views.find((item) => item.app === entry.app);
    const grant = source.grants.get(entry.app);
    if (view === undefined || grant === undefined) continue;
    for (const key of [...entry.commands].sort()) {
      const command = view.commands.find((item) => item.key === key);
      const allowed = grantFor(grant, key);
      if (command === undefined || allowed === undefined) continue;
      if (!entry.effects.includes(command.effect)) continue;
      if (command.confirm && !entry.confirm_allowed) continue;
      const reversible = revertCounterpart(view.commands, command) !== null;
      if (
        command.effect === "write" && entry.revert_required && !reversible
      ) continue;
      const name = await appToolName(view.app, key);
      if (names.has(name)) continue;
      names.add(name);
      const schema = command.input as InputSchema | null;
      const definitionHash = await appDefinitionHash(
        view,
        command,
        reversible,
      );
      const notes = [
        command.effect === "read"
          ? "reads only"
          : command.effect === "write"
          ? "changes the app"
          : "changes something outside lophn",
        ...(command.confirm ? ["a person confirms each call"] : []),
        ...(reversible ? ["can be reverted"] : []),
      ];
      const definition: ToolDefinition = {
        name,
        description:
          `App ${view.name} (${view.app}), command ${key}: ${command.label}. ${command.description} (${
            notes.join("; ")
          })`,
        revision: `${view.release}:${definitionHash.slice(0, 16)}`,
        input: toolInputValidator(schema),
        inputSchema: toolInputSchema(schema),
        effect: command.effect,
        confirm: command.confirm,
        contract: APP_TOOL_CONTRACT,
        scopeCheck: "apps the grant, role, and assignment allow",
        reversible,
        idempotent: command.effect === "read",
        errors: COMMON_ERRORS,
        origin: "app",
      };
      tools.push({
        definition,
        app: view.app,
        appName: view.name,
        release: view.release,
        blueprintHash: view.blueprint_hash,
        command: key,
        effect: command.effect,
        confirm: command.confirm,
        reversible,
        definitionHash,
        schema,
        permissionBasis: {
          grant: allowed.grant,
          // Grant.kind = agent.commands다. scope 원문은 command 목록의 JSON이다.
          scope: JSON.stringify(allowed.commands),
          basis_seq: allowed.basis_seq,
        },
      });
    }
  }
  return tools;
}

// ---- 호출 ----

export type AppInvokeCall = {
  app: string;
  release: string;
  command: string;
  input: unknown;
  // 같은 호출의 식별이다. 최초 ToolCall ID라 재전송이 handler를 다시 실행하지 않는다.
  requestKey: string;
  run: string;
  toolCall: string;
};

export type AppInvokeOutcome =
  | {
    kind: "result";
    result: unknown;
    invocation: string | null;
    revert:
      | { invocation: string; receipt: string; expected_revision: string }
      | null;
    source: unknown;
  }
  // 요청은 나갔지만 응답을 못 받았다. 앱이 처리했는지 모른다.
  | { kind: "unknown" };

export type AppStatusAnswer = {
  progress: "running" | "succeeded" | "failed" | "unknown";
  result?: { result: unknown; revert?: unknown; source?: unknown };
};

// 앱 통로다. 실제 연결(core의 `apps/connect`와 앱 direct socket)은 agent runtime 조립이 낸다. 연결을
// 열지 못해 요청이 나가지 않은 것은 err이고, 보낸 뒤 응답을 잃은 것은 `unknown`이다.
export type AppCommandPorts = {
  invoke(call: AppInvokeCall): Promise<Result<AppInvokeOutcome>>;
  status(
    call: AppInvokeCall & { invocation: string },
  ): Promise<Result<AppStatusAnswer>>;
};

type Terminal = Extract<Invocation["status"], "succeeded" | "failed">;
const TERMINAL = new Set<string>(["succeeded", "failed"]);
const LOOKUP_PAGES = 25;

// 이 ToolCall이 앱에 남긴 invocation이다. 호출자(caller)가 인증된 run·ToolCall이라 본문 주장이 아니다.
export async function findInvocation(
  read: (contract: string, input: unknown) => Promise<Result<unknown>>,
  app: string,
  toolCall: string,
): Promise<Result<Invocation | null>> {
  let cursor: string | undefined;
  for (let page = 0; page < LOOKUP_PAGES; page++) {
    const listed = await read(invocationsList.name, {
      app,
      limit: 200,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!listed.ok) return listed;
    const body = listed.value as {
      invocations: Invocation[];
      next_cursor?: string | null;
    };
    const found = body.invocations.find((item) =>
      item.caller.kind === "agent" && item.caller.tool_call === toolCall
    );
    if (found !== undefined) return ok(found);
    if (body.next_cursor === null || body.next_cursor === undefined) {
      return ok(null);
    }
    cursor = body.next_cursor;
  }
  return ok(null);
}

function resultOf(
  tool: Pick<AppTool, "appName" | "command">,
  outcome: Extract<AppInvokeOutcome, { kind: "result" }>,
): ToolResult {
  const full = {
    invocation: outcome.invocation,
    revert: outcome.revert,
    source: outcome.source ?? null,
    result: outcome.result,
  };
  const limited = limitJson(full);
  // 상한을 넘어도 되돌리기 receipt는 잃지 않는다.
  const content = limited.complete ? full : {
    invocation: outcome.invocation,
    revert: outcome.revert,
    source: outcome.source ?? null,
    result: null,
    omitted: true,
  };
  return {
    status: "success",
    summary: `command ${tool.command} of ${tool.appName} finished`,
    content: content as ToolResult["content"],
    complete: limited.complete,
    source: null,
    continuation: null,
    pending: [],
  };
}

// 앱 ledger의 종료 기록으로 만든 결과다. 앱이 돌려준 값 자체는 ledger에 없고 상태·요약만 있다.
export function recordedResult(
  tool: Pick<AppTool, "appName" | "command">,
  invocation: Invocation,
): { kind: Terminal; result: ToolResult } | null {
  if (!TERMINAL.has(invocation.status)) return null;
  const kind = invocation.status as Terminal;
  return {
    kind,
    result: {
      status: kind === "succeeded" ? "success" : "failure",
      summary: kind === "succeeded"
        ? `command ${tool.command} of ${tool.appName} finished`
        : `command ${tool.command} of ${tool.appName} failed`,
      content: {
        invocation: invocation.id,
        status: invocation.status,
        finished_at: invocation.finished_at,
        summary: invocation.summary,
      } as ToolResult["content"],
      complete: false,
      source: null,
      continuation: null,
      pending: ["the value the app returned is not kept"],
    },
  };
}

function uncertain(
  tool: Pick<AppTool, "appName" | "command">,
  invocation: string | null,
): ToolResult {
  return {
    status: "uncertain",
    summary:
      `the result of command ${tool.command} of ${tool.appName} is not known`,
    content: invocation === null ? null : { invocation },
    complete: true,
    source: null,
    continuation: null,
    pending: ["ask the app for the result of this call before repeating it"],
  };
}

// 앱 command tool의 handler다. 판정과 진입 기록은 이 handler 앞에서 끝났다. 입력은 실행기가 정의의
// schema로 검사했고 여기서는 앱 통로 하나만 부른다. 결과를 잃었으면 같은 request_key로 앱에 묻고,
// 그래도 모르면 성공이나 실패로 추측하지 않고 불명확으로 돌려준다.
export function createAppToolHandlers(
  tools: readonly AppTool[],
  ports: ContractCall & AppCommandPorts,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  for (const tool of tools) {
    handlers.set(
      tool.definition.name,
      async (input: unknown, credential: RunCredential) => {
        if (credential.call === undefined) {
          return err({ code: "unavailable", message: "no tool call" });
        }
        const call: AppInvokeCall = {
          app: tool.app,
          release: tool.release,
          command: tool.command,
          input: commandInputOf(tool, input),
          requestKey: credential.call,
          run: credential.run,
          toolCall: credential.call,
        };
        const sent = await ports.invoke(call);
        if (!sent.ok) return sent;
        if (sent.value.kind === "result") {
          return ok(resultOf(tool, sent.value));
        }
        const read = (contract: string, body: unknown) =>
          ports.call(contract, body, credential.run);
        const found = await findInvocation(read, tool.app, call.toolCall);
        if (!found.ok || found.value === null) {
          return ok(uncertain(tool, null));
        }
        const recorded = recordedResult(tool, found.value);
        if (recorded !== null) return ok(recorded.result);
        const asked = await ports.status({
          ...call,
          invocation: found.value.id,
        });
        if (asked.ok && asked.value.progress === "failed") {
          return ok({
            ...uncertain(tool, found.value.id),
            status: "failure",
            summary: `command ${tool.command} of ${tool.appName} failed`,
            pending: [],
          });
        }
        if (
          asked.ok && asked.value.progress === "succeeded" &&
          asked.value.result !== undefined
        ) {
          return ok(resultOf(tool, {
            kind: "result",
            result: asked.value.result.result,
            invocation: found.value.id,
            revert: (asked.value.result.revert ?? null) as never,
            source: asked.value.result.source ?? null,
          }));
        }
        return ok(uncertain(tool, found.value.id));
      },
    );
  }
  return handlers;
}
