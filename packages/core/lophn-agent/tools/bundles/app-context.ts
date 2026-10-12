import { z } from "zod";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type AppBlueprintAgentContext,
  type AppBlueprintCommand,
  appIdSchema,
  appScreenContextSchema,
  type InputSchema,
  validateInput,
} from "../../../../protocol/apps/mod.ts";
import type {
  AgentAppScope,
  ToolResult,
} from "../../../../protocol/lophn-agent/mod.ts";
import {
  APP_TOOL_CONTRACT,
  type AppBlueprintView,
  type AppCommandPorts,
  type AppGrant,
  grantFor,
  revertCounterpart,
} from "../app-tools.ts";
import { limitJson } from "../result.ts";
import type { ToolDefinition } from "../registry.ts";
import type { RunCredential, ToolHandler } from "../work.ts";
import { COMMON_ERRORS } from "./common.ts";

// 앱 화면 context 묶음(concern harness/tools). 앱이 apps/agent-context로 선언한 현재 화면 상태 read
// command(상세 조회)와 주석 자리의 write command(힌트·주석 되쓰기)를 그대로 부른다. 별도 DOM 조작도 임의
// 입력 통로도 없다: 선언한 화면·command·자리 밖은 정의가 있어도 호출이 없는 것과 같다. 이 정의는 앱
// command tool과 같이 origin이 app이고 역할·현재 허락·assignment의 교집합(AgentAppScope)이 이미 고른
// 앱에서만 만들어진다.

export const APP_CONTEXT_TOOL_REVISION = "2026-10-07";

const opaque = z.string().min(1).refine((value) => !/\p{Cc}/u.test(value), {
  message: "expected an opaque value without control characters",
});

// default를 채우지 않는다. 실행 검사는 입력이 검사 뒤에도 같아야 통과시킨다.
const screenInput = z.strictObject({
  app: appIdSchema,
  screen: z.string().min(1),
  view_session: opaque,
  detail: z.boolean().optional(),
});
const annotateInput = z.strictObject({
  app: appIdSchema,
  screen: z.string().min(1),
  view_session: opaque,
  // 조회한 화면의 revision이다. 달라졌으면 되쓰기는 적용되지 않는다.
  expected_revision: opaque,
  target: z.string().min(1),
  text: z.string().max(4096),
});
export type ScreenContextInput = z.infer<typeof screenInput>;
export type AnnotateInput = z.infer<typeof annotateInput>;

function define(
  name: string,
  description: string,
  input: z.ZodType,
  effect: ToolDefinition["effect"],
  scopeCheck: string,
): ToolDefinition {
  return {
    name,
    description,
    revision: APP_CONTEXT_TOOL_REVISION,
    input,
    effect,
    confirm: false,
    contract: APP_TOOL_CONTRACT,
    scopeCheck,
    // 되돌릴 수 있는지는 선언한 write command의 되돌리기 계약에서 호출마다 읽는다.
    reversible: false,
    idempotent: effect === "read",
    errors: COMMON_ERRORS,
    origin: "app",
  };
}

export const appScreenContextTool = define(
  "app.screen_context",
  "Read what an app shows now on a screen it declared for you: the short summary, and with detail true the extra data, " +
    "through the read command the app declared. Pass the screen and view_session of the current view. " +
    "The result carries the revision to use in app.annotate. Nothing is changed.",
  screenInput,
  "read",
  "screens an allowed app declared for agent context",
);
export const appAnnotateTool = define(
  "app.annotate",
  "Write a hint or note into a place an app declared on its current screen, through the write command the app declared for that place. " +
    "Pass the screen, view_session, the target key, the text, and the revision you read with app.screen_context; " +
    "if the screen changed since, nothing is written and you must read the screen again.",
  annotateInput,
  "write",
  "annotation places an allowed app declared on its current screen",
);

export const APP_CONTEXT_TOOL_NAMES: readonly string[] = [
  appScreenContextTool.name,
  appAnnotateTool.name,
];

const unavailable = () =>
  err({
    code: "not_found" as const,
    message: "the app command is not available",
  });

export function declaredContext(
  view: Pick<AppBlueprintView, "agent_context">,
  screen: string,
): AppBlueprintAgentContext | undefined {
  return view.agent_context?.find((entry) => entry.screen === screen);
}

export type AppContextState = {
  view: AppBlueprintView;
  grants: readonly AppGrant[];
};

// scope가 이 command를 이 effect로 열어 두었고 현재 허락도 있는지. 둘 다 있어야 호출할 수 있다.
function opened(
  scope: AgentAppScope,
  state: AppContextState,
  command: AppBlueprintCommand,
): boolean {
  const entry = scope.apps.find((item) => item.app === state.view.app);
  return entry !== undefined && entry.commands.includes(command.key) &&
    entry.effects.includes(command.effect) &&
    !(command.confirm && !entry.confirm_allowed) &&
    grantFor(state.grants, command.key) !== undefined;
}

export type ScreenReadPlan = {
  declaration: AppBlueprintAgentContext;
  command: AppBlueprintCommand;
  payload: { screen: string; view_session: string; detail: boolean };
};

// 선언한 화면의 read command로 조회할 수 있는지. 선언하지 않은 화면·read가 아닌 command·사람 확인을 요구하는
// command·허락 없는 command는 같은 답이다.
export function planScreenRead(
  scope: AgentAppScope,
  state: AppContextState,
  input: ScreenContextInput,
): Result<ScreenReadPlan> {
  const declaration = declaredContext(state.view, input.screen);
  if (declaration === undefined) return unavailable();
  const command = state.view.commands.find((entry) =>
    entry.key === declaration.read_command
  );
  if (
    command === undefined || command.effect !== "read" || command.confirm ||
    !opened(scope, state, command)
  ) return unavailable();
  const payload = {
    screen: input.screen,
    view_session: input.view_session,
    detail: input.detail === true,
  };
  if (!validateInput(command.input as InputSchema | null, payload).ok) {
    return unavailable();
  }
  return ok({ declaration, command, payload });
}

export type AnnotationPlan = {
  declaration: AppBlueprintAgentContext;
  command: AppBlueprintCommand;
  // 대응 command가 검증된 되돌리기만 값이 있다. 없으면 되돌릴 수 없다고 본다.
  counterpart: string | null;
  payload: {
    screen: string;
    view_session: string;
    expected_revision: string;
    target: string;
    text: string;
  };
};

// 선언한 화면·주석 자리·write command, 현재 허락, scope를 확인한다. 현재 화면 revision의 일치는 판정이
// 따로 읽는다(그 값은 앱 안에 있다). 사람 확인을 요구하는 command는 이 통로가 아니라 앱 command tool의 사람
// 확인 갈래로 간다(flow ask-app-hint).
export function planAnnotation(
  scope: AgentAppScope,
  state: AppContextState,
  input: AnnotateInput,
): Result<AnnotationPlan> {
  const declaration = declaredContext(state.view, input.screen);
  if (declaration === undefined) return unavailable();
  const place = declaration.annotation_targets.find((entry) =>
    entry.key === input.target
  );
  if (place === undefined) return unavailable();
  const command = state.view.commands.find((entry) =>
    entry.key === place.write_command
  );
  if (
    command === undefined || command.effect !== "write" || command.confirm ||
    !opened(scope, state, command)
  ) return unavailable();
  const counterpart = revertCounterpart(state.view.commands, command);
  const entry = scope.apps.find((item) => item.app === state.view.app);
  if (entry?.revert_required === true && counterpart === null) {
    return unavailable();
  }
  const payload = {
    screen: input.screen,
    view_session: input.view_session,
    expected_revision: input.expected_revision,
    target: input.target,
    text: input.text,
  };
  if (!validateInput(command.input as InputSchema | null, payload).ok) {
    return unavailable();
  }
  return ok({ declaration, command, counterpart, payload });
}

// 도구가 만들어진 뒤에도 현재 선언·허락·scope가 같아야 하므로 정의는 상태가 아니라 가능성만 본다. 화면 하나라도
// 쓸 수 있으면 정의가 있다.
export function buildAppContextTools(source: {
  scope: AgentAppScope;
  views: readonly AppBlueprintView[];
  grants: ReadonlyMap<string, readonly AppGrant[]>;
}): readonly ToolDefinition[] {
  let read = false;
  let write = false;
  for (const entry of source.scope.apps) {
    const view = source.views.find((item) => item.app === entry.app);
    const grants = source.grants.get(entry.app);
    if (view === undefined || grants === undefined) continue;
    const state = { view, grants };
    for (const declaration of view.agent_context ?? []) {
      const probe = {
        app: entry.app,
        screen: declaration.screen,
        view_session: "x",
        expected_revision: "x",
        // 앱이 text의 길이 하한을 선언할 수 있어 비어 있지 않은 값으로 가능성을 본다.
        text: "x",
      };
      if (planScreenRead(source.scope, state, probe).ok) read = true;
      for (const place of declaration.annotation_targets) {
        if (
          planAnnotation(source.scope, state, { ...probe, target: place.key })
            .ok
        ) write = true;
      }
    }
  }
  return [
    ...(read ? [appScreenContextTool] : []),
    ...(write ? [appAnnotateTool] : []),
  ];
}

export type AppContextPorts = AppCommandPorts & {
  // 앱의 지금 active release blueprint와 현재 허락. 범위 밖·없는 앱은 읽히지 않는다.
  current(app: string): Promise<Result<AppContextState>>;
};

function failed(summary: string, reason: string): ToolResult {
  return {
    status: "success",
    summary,
    content: { availability: "unavailable", reason },
    complete: true,
    source: null,
    continuation: null,
    pending: ["read the screen again before writing a hint"],
  };
}

export function createAppContextToolHandlers(
  scope: AgentAppScope,
  ports: AppContextPorts,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set(
    appScreenContextTool.name,
    async (input: unknown, credential: RunCredential) => {
      if (credential.call === undefined) {
        return err({ code: "unavailable", message: "no tool call" });
      }
      const value = input as ScreenContextInput;
      const state = await ports.current(value.app);
      if (!state.ok) return unavailable();
      const plan = planScreenRead(scope, state.value, value);
      if (!plan.ok) return plan;
      const sent = await ports.invoke({
        app: value.app,
        release: state.value.view.release,
        command: plan.value.command.key,
        input: plan.value.payload,
        requestKey: credential.call,
        run: credential.run,
        toolCall: credential.call,
      });
      if (!sent.ok) return sent;
      if (sent.value.kind !== "result") {
        return ok(failed(
          "screen not read",
          "the app did not answer, so the current screen is not known",
        ));
      }
      // 앱이 돌려준 값이 지금 물은 화면·view session·release의 것인지 본다. 다른 탭·옛 화면의 상태를
      // 지금 보고 있는 것으로 넘기지 않는다.
      const parsed = appScreenContextSchema.safeParse(sent.value.result);
      if (
        !parsed.success || parsed.data.app !== value.app ||
        parsed.data.release !== state.value.view.release ||
        parsed.data.screen !== value.screen ||
        parsed.data.view_session !== value.view_session
      ) {
        return ok(failed(
          "screen not read",
          "the app has no current screen for this view",
        ));
      }
      const context = parsed.data;
      const base = {
        availability: "current",
        app: context.app,
        release: context.release,
        screen: context.screen,
        view_session: context.view_session,
        revision: context.revision,
        summary: context.summary,
        redacted: context.redacted,
      };
      // 상세는 요청했을 때만 싣는다. 요약만 받은 호출에는 자료를 붙이지 않는다.
      const detail = plan.value.payload.detail && context.data !== undefined &&
          context.data !== null
        ? { data: context.data }
        : {};
      const full = { ...base, ...detail };
      const limited = limitJson(full);
      return ok({
        status: "success",
        summary: "screen context read",
        content:
          (limited.complete ? full : { ...base, omitted: true }) as ToolResult[
            "content"
          ],
        complete: limited.complete,
        source: null,
        continuation: null,
        pending: [],
      });
    },
  );

  handlers.set(
    appAnnotateTool.name,
    async (input: unknown, credential: RunCredential) => {
      if (credential.call === undefined) {
        return err({ code: "unavailable", message: "no tool call" });
      }
      const value = input as AnnotateInput;
      const state = await ports.current(value.app);
      if (!state.ok) return unavailable();
      const plan = planAnnotation(scope, state.value, value);
      if (!plan.ok) return plan;
      const sent = await ports.invoke({
        app: value.app,
        release: state.value.view.release,
        command: plan.value.command.key,
        input: plan.value.payload,
        requestKey: credential.call,
        run: credential.run,
        toolCall: credential.call,
      });
      if (!sent.ok) return sent;
      // 응답을 잃으면 힌트가 적용됐다고 하지 않고 같은 호출을 자동으로 반복하지도 않는다.
      if (sent.value.kind !== "result") {
        return ok({
          status: "uncertain",
          summary: "the app did not confirm the hint was written",
          content: null,
          complete: true,
          source: null,
          continuation: null,
          pending: [
            "read the screen again to see whether the hint was applied",
          ],
        });
      }
      return ok(
        success(
          plan.value.command.key,
          sent.value.invocation,
          sent.value.revert,
        ),
      );
    },
  );
  return handlers;
}

function success(
  command: string,
  invocation: string | null,
  revert: unknown,
): ToolResult {
  return {
    status: "success",
    summary: `hint written through command ${command}`,
    content: { invocation, revert } as ToolResult["content"],
    complete: true,
    source: null,
    continuation: null,
    pending: [],
  };
}
