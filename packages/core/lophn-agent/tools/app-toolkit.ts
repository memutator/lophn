import { err, ok, type Result } from "../../../base/mod.ts";
import {
  appAgentConfirmProof,
  appBlueprint,
  appRuntime,
  appScreenContextSchema,
  grantsList,
  invocationAcceptConfirm,
  type InvocationAcceptConfirmInput,
  invocationAcceptConfirmInputSchema,
  invocationsList,
  type SignedConfirmProof,
} from "../../../protocol/apps/mod.ts";
import {
  type AgentAppScope,
  toolCallRead,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  applyApprovedAction,
  type ApprovalAction,
  approvalsGet,
  routePath,
} from "../../../protocol/server/mod.ts";
import {
  workspaceRead,
  workspaceReadOutputSchema,
} from "../../../protocol/shell/mod.ts";
import {
  createRuntimeClient,
  type DirectTransport,
} from "../../apps/runtime/client/mod.ts";
import {
  type AppContextJudgmentPorts,
  type AppJudgmentPorts,
  createAnnotateBinding,
  createAppBinding,
  createScreenContextBinding,
  type ToolBinding,
} from "../tool-judgment/mod.ts";
import {
  appAnnotateTool,
  type AppBlueprintView,
  type AppCommandPorts,
  type AppContextPorts,
  type AppGrant,
  type AppInvokeCall,
  appScreenContextTool,
  type AppTool,
  buildAppContextTools,
  buildAppTools,
  createAppContextToolHandlers,
  createAppToolHandlers,
  revertCounterpart,
  type ToolDefinition,
  type ToolHandler,
} from "./mod.ts";
import {
  createAppToolLookups,
  type ToolLookup,
} from "../waiting-and-recovery/mod.ts";
import type { AppOffer } from "../run-loop/mod.ts";
import { commandOf, type CoreCall, readOf } from "../run-loop/core-call.ts";

// agent runtime의 앱 command 연결(lophn-agent/harness/tools R8, R16, R17). 이 run이 부를 수 있는 앱
// command의 선언과 사람의 허락을 apps 계약 읽기로 모으고(StartRun의 AgentAppScope 입력과 tool 정의의
// 재료), 호출은 core의 `apps/connect`가 준 제한 연결로 앱 direct socket에 보낸다. 앱 소스·원본 파일·
// secret 값에는 닿지 않고 별도 MCP 서버도 없다.

export type AppLoad = {
  offers: readonly AppOffer[];
  views: readonly AppBlueprintView[];
  grants: ReadonlyMap<string, readonly AppGrant[]>;
};

export type AppToolkit = {
  // 지금의 선언과 허락. 허락(agent.commands grant)이 하나도 없는 앱은 범위에 들지 않는다.
  load(): Promise<Result<AppLoad>>;
  define(scope: AgentAppScope, loaded: AppLoad): Promise<readonly AppTool[]>;
  binding(tool: AppTool, agent: CoreCall): ToolBinding;
  handlers(
    tools: readonly AppTool[],
    agent: CoreCall,
  ): ReadonlyMap<string, ToolHandler>;
  lookups(tools: readonly AppTool[]): ReadonlyMap<string, ToolLookup>;
  // 화면 context 조회(`app.screen_context`)와 주석 쓰기(`app.annotate`). 앱이 선언한 화면·주석 자리와
  // 현재 허락, 역할·assignment 범위가 하나라도 열어 둔 것만 정의가 된다(tools R18).
  defineContext(
    scope: AgentAppScope,
    loaded: AppLoad,
  ): readonly ToolDefinition[];
  // `session`은 이 run이 묶인 대화 session이다. 입력의 view_session은 그 session의 사람 창에 열린 그 앱의
  // 패널 탭의 것일 때만 믿고, 아니면 없는 대상과 같은 답이다(apps/agent-context#R2).
  contextBinding(
    tool: ToolDefinition,
    scope: AgentAppScope,
    agent: CoreCall,
    session: string | null,
  ): ToolBinding | undefined;
  contextHandlers(
    scope: AgentAppScope,
    agent: CoreCall,
    session: string | null,
  ): ReadonlyMap<string, ToolHandler>;
};

const PLACEHOLDER_SCREEN = "main";
const WORKSPACE_PAGE_LIMIT = 10;

const NOT_AVAILABLE = () =>
  err({
    code: "not_found" as const,
    message: "the app command is not available",
  });

// agent가 준 view_session이 지금 이 run의 workspace(사람 창)에 열린 그 앱의 패널 탭의 것인지. 현재 보기를
// 읽지 못하거나 끊겼거나 session이 없으면 아니다. 열린 탭은 식별일 뿐 허락이 아니다.
async function panelOpen(
  agent: CoreCall,
  session: string | null,
  app: string,
  viewSession: string,
): Promise<boolean> {
  if (session === null) return false;
  let page: number | undefined = 0;
  for (
    let read = 0;
    page !== undefined && read < WORKSPACE_PAGE_LIMIT;
    read++
  ) {
    const reply = await agent(routePath(workspaceRead), { session, page });
    if (!reply.ok) return false;
    const parsed = workspaceReadOutputSchema.safeParse(reply.value);
    if (!parsed.success || parsed.data.availability !== "current") return false;
    if (
      parsed.data.tab_page?.some((tab) =>
        tab.kind === "app_panel" && tab.app === app &&
        tab.view_session === viewSession
      )
    ) return true;
    page = parsed.data.next_page;
  }
  return false;
}

function claimed(
  input: unknown,
): { app: string; view_session: string } | undefined {
  const value = input as { app?: unknown; view_session?: unknown } | null;
  return typeof value?.app === "string" &&
      typeof value.view_session === "string"
    ? { app: value.app, view_session: value.view_session }
    : undefined;
}

export function createAppToolkit(options: {
  // machine 자격의 loopback. 선언·허락·invocation 기록과 confirm 접수 proof를 다룬다.
  machine: CoreCall;
  // 앱 direct socket의 transport. 기본은 unix socket이다.
  direct?: DirectTransport;
}): AppToolkit {
  const { machine } = options;

  // 앱 하나의 지금 blueprint와 허락이다. 없는 앱·active release 없는 앱은 읽히지 않는다.
  async function current(
    app: string,
  ): Promise<
    Result<{ view: AppBlueprintView; grants: readonly AppGrant[] }>
  > {
    const blueprint = await readOf(machine, appBlueprint, { app });
    if (!blueprint.ok) return blueprint;
    const grants: AppGrant[] = [];
    let basis_seq = "0";
    let cursor: string | undefined;
    do {
      const page = await readOf(machine, grantsList, {
        app,
        status: "active",
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!page.ok) return page;
      // grant 집합이 마지막으로 바뀐 seq다(app을 지정했으므로 읽기가 준다).
      if (page.value.grants_seq !== undefined) {
        basis_seq = String(page.value.grants_seq);
      }
      for (const grant of page.value.grants) {
        if (grant.scope.kind === "agent.commands") {
          grants.push({
            grant: grant.id,
            commands: grant.scope.commands,
            basis_seq,
          });
        }
      }
      cursor = page.value.next_cursor ?? undefined;
    } while (cursor !== undefined);
    const value = blueprint.value;
    return ok({
      view: {
        app: value.app,
        name: value.name,
        release: value.release,
        blueprint_hash: value.blueprint_hash,
        commands: value.commands,
        screens: value.screens,
        agent_context: value.agent_context ?? [],
      },
      grants,
    });
  }

  async function apps(): Promise<Result<string[]>> {
    const found = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await readOf(machine, grantsList, {
        status: "active",
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!page.ok) return page;
      for (const grant of page.value.grants) {
        if (grant.scope.kind === "agent.commands") found.add(grant.app);
      }
      cursor = page.value.next_cursor ?? undefined;
    } while (cursor !== undefined);
    return ok([...found].sort());
  }

  // confirm command의 접수 입력. approval이 없거나 이 ToolCall의 접수가 아니면 연결하지 않는다.
  async function confirmAcceptance(call: AppInvokeCall): Promise<
    Result<{
      approval: string;
      action: ApprovalAction;
      accept: InvocationAcceptConfirmInput;
      process_nonce: string;
    }>
  > {
    const read = await readOf(machine, toolCallRead, {
      tool_call: call.toolCall,
    });
    if (!read.ok) return read;
    const approval = read.value.tool_call.decision?.approval ?? null;
    if (approval === null) {
      return err({
        code: "forbidden",
        message: "confirm command has no approval",
      });
    }
    const got = await readOf(machine, approvalsGet, { approval });
    if (!got.ok) return got;
    const action = got.value.request.action;
    if (
      action.command !== invocationAcceptConfirm.name ||
      action.input.kind !== "inline"
    ) {
      return err({
        code: "conflict",
        message: "approval is not a confirm acceptance",
      });
    }
    const parsed = invocationAcceptConfirmInputSchema.safeParse(
      action.input.value,
    );
    if (
      !parsed.success || parsed.data.app !== call.app ||
      parsed.data.release !== call.release ||
      parsed.data.command !== call.command ||
      parsed.data.caller.kind !== "agent" ||
      parsed.data.caller.tool_call !== call.toolCall
    ) {
      return err({
        code: "conflict",
        message: "approval is not a confirm acceptance",
      });
    }
    return ok({
      approval,
      action,
      accept: parsed.data,
      process_nonce: parsed.data.process_nonce,
    });
  }

  function commandPorts(agent: CoreCall) {
    const client = createRuntimeClient({
      core: {
        call: async (path, body) => {
          const reply = await agent(path, body);
          return reply.ok
            ? { status: 200, body: reply.value }
            : { status: 400, body: { error: reply.error } };
        },
      },
      ...(options.direct === undefined ? {} : { direct: options.direct }),
    });
    // 호출자는 인증된 run과 ToolCall이다. 연결을 열지 못하면 요청은 나가지 않았다.
    const connect = (
      call: Pick<AppInvokeCall, "app" | "command" | "run" | "toolCall">,
    ) =>
      client.connect({
        app: call.app,
        mode: "live",
        screens: [PLACEHOLDER_SCREEN],
        screen_sizes: {},
        commands: [call.command],
        caller: { kind: "agent", run: call.run, tool_call: call.toolCall },
      });
    const ports: AppCommandPorts & AppJudgmentPorts = {
      async invoke(call) {
        const acceptance = call.confirm === true
          ? await confirmAcceptance(call)
          : undefined;
        if (acceptance !== undefined && !acceptance.ok) return acceptance;
        const session = await connect(call);
        if (!session.ok) return session;
        // 정의가 만들어진 release가 지금 앱의 release와 같을 때만 보낸다(옛 정의로 부르지 않는다).
        if (session.value.connection.release !== call.release) {
          return err({
            code: "conflict",
            message: "the app release changed",
          });
        }
        // confirm은 사람이 허락한 접수를 한 번 적용하고, 그 proof의 nonce가 지금 프로세스와 같을 때만 보낸다.
        let proof: SignedConfirmProof | undefined;
        if (acceptance?.ok) {
          if (
            session.value.connection.process_nonce !==
              acceptance.value.process_nonce
          ) {
            return err({
              code: "conflict",
              message: "the app process changed",
            });
          }
          const applied = await commandOf(
            machine,
            applyApprovedAction,
            {
              approval: acceptance.value.approval,
              action: acceptance.value.action,
              idempotency_key: call.toolCall,
            },
            {},
            `${call.toolCall}:apply`,
          );
          if (!applied.ok) return applied;
          const signed = await readOf(
            machine,
            appAgentConfirmProof,
            acceptance.value.accept,
          );
          if (!signed.ok) return signed;
          proof = signed.value.proof;
        }
        const sent = await session.value.invoke({
          command: call.command,
          ...(call.input === undefined ? {} : { input: call.input as never }),
          request_key: call.requestKey,
          ...(proof === undefined ? {} : { proof }),
        });
        if (!sent.ok) return sent;
        if (sent.value.kind === "unknown") return ok({ kind: "unknown" });
        const output = sent.value.output;
        return ok({
          kind: "result",
          result: output.result.result,
          invocation: output.invocation ?? null,
          revert: output.result.revert ?? null,
          source: output.result.source ?? null,
        });
      },
      async status(call) {
        const session = await connect(call);
        if (!session.ok) return session;
        const asked = await session.value.status(
          call.requestKey,
          call.invocation,
        );
        return asked.ok ? ok(asked.value as never) : asked;
      },
      current,
      async nonce(app) {
        // confirm이 묶는 프로세스 nonce다. apps/connect는 연결을 남겨 credential이
        // 끝나면 그 프로세스를 다시 띄운다. 사람 허락을 기다리는 동안 nonce가 바뀌므로
        // 여기서는 연결을 만들지 않고 machine 관측만 읽는다. 실제 호출은 run이 다시
        // 돈 뒤 agent의 apps/connect로 한다.
        const observed = await readOf(machine, appRuntime, { app });
        if (!observed.ok) return observed;
        const observation = observed.value.observation;
        if (
          observation === null || observation.mode !== "live" ||
          !observation.ready || !observation.accepting ||
          observation.process_nonce === "none"
        ) {
          return err({ code: "unavailable", message: "app is not running" });
        }
        return ok(observation.process_nonce);
      },
    };
    return ports;
  }

  // 화면 context의 판정 근거와 실행 통로다. 조회·주석은 선언한 command를 같은 앱 direct 통로로 부른다.
  function contextPorts(
    agent: CoreCall,
  ): AppContextPorts & AppContextJudgmentPorts {
    const ports = commandPorts(agent);
    return {
      ...ports,
      // 주석을 쓰기 직전의 현재 화면 revision이다. 선언한 read command에 지금 물어 얻고, 앱이 이 view의
      // 화면을 모르거나 닫혔으면 null이다(옛 조회의 revision을 재사용하지 않는다).
      async currentRevision(probe, call) {
        const state = await current(probe.app);
        if (!state.ok) return state;
        const declaration = state.value.view.agent_context?.find((entry) =>
          entry.screen === probe.screen
        );
        if (declaration === undefined) return ok(null);
        const sent = await ports.invoke({
          app: probe.app,
          release: probe.release,
          command: declaration.read_command,
          input: {
            screen: probe.screen,
            view_session: probe.view_session,
            detail: false,
          },
          requestKey: `${call.toolCall}:revision`,
          run: call.run,
          toolCall: call.toolCall,
        });
        if (!sent.ok) return sent;
        if (sent.value.kind !== "result") return ok(null);
        const parsed = appScreenContextSchema.safeParse(sent.value.result);
        if (
          !parsed.success || parsed.data.app !== probe.app ||
          parsed.data.release !== probe.release ||
          parsed.data.screen !== probe.screen ||
          parsed.data.view_session !== probe.view_session
        ) return ok(null);
        return ok(parsed.data.revision);
      },
    };
  }

  return {
    async load() {
      const listed = await apps();
      if (!listed.ok) return listed;
      const offers: AppOffer[] = [];
      const views: AppBlueprintView[] = [];
      const grants = new Map<string, readonly AppGrant[]>();
      for (const app of listed.value) {
        const read = await current(app);
        // 읽지 못한 앱은 없는 앱과 같다.
        if (!read.ok) continue;
        const { view, grants: opened } = read.value;
        views.push(view);
        grants.set(app, opened);
        offers.push({
          app,
          commands: view.commands.map((command) => ({
            key: command.key,
            effect: command.effect,
            confirm: command.confirm,
            revert_supported:
              revertCounterpart(view.commands, command) !== null,
          })),
          granted: [...new Set(opened.flatMap((grant) => grant.commands))],
        });
      }
      return ok({ offers, views, grants });
    },
    define(scope, loaded) {
      return buildAppTools({
        scope,
        views: loaded.views,
        grants: loaded.grants,
      });
    },
    binding(tool, agent) {
      return createAppBinding(tool, commandPorts(agent));
    },
    handlers(tools, agent) {
      return createAppToolHandlers(tools, {
        // 결과를 잃은 호출이 이 ToolCall의 invocation 기록을 찾을 때만 쓴다.
        call(contract, input) {
          return contract === invocationsList.name
            ? agent(routePath(invocationsList), input)
            : Promise.resolve(
              err({ code: "not_found", message: "contract is not open" }),
            );
        },
        ...commandPorts(agent),
      });
    },
    defineContext(scope, loaded) {
      return buildAppContextTools({
        scope,
        views: loaded.views,
        grants: loaded.grants,
      });
    },
    contextBinding(tool, scope, agent, session) {
      const inner = tool.name === appScreenContextTool.name
        ? createScreenContextBinding(scope, contextPorts(agent))
        : tool.name === appAnnotateTool.name
        ? createAnnotateBinding(scope, contextPorts(agent))
        : undefined;
      if (inner === undefined) return undefined;
      return {
        async resolve(input, call) {
          const asked = claimed(input);
          if (
            asked === undefined ||
            !await panelOpen(agent, session, asked.app, asked.view_session)
          ) return NOT_AVAILABLE();
          return await inner.resolve(input, call);
        },
      };
    },
    contextHandlers(scope, agent, session) {
      const inner = createAppContextToolHandlers(scope, contextPorts(agent));
      return new Map(
        [...inner].map(([name, handler]): [string, ToolHandler] => [
          name,
          async (input, credential) => {
            const asked = claimed(input);
            if (
              asked === undefined ||
              !await panelOpen(agent, session, asked.app, asked.view_session)
            ) return NOT_AVAILABLE();
            return await handler(input, credential);
          },
        ]),
      );
    },
    lookups(tools) {
      return createAppToolLookups(
        tools,
        (_contract, input) => machine(routePath(invocationsList), input),
      );
    },
  };
}
