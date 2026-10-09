import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  appAgentConfirmProof,
  appBlueprint,
  grantsList,
  invocationAcceptConfirm,
  type InvocationAcceptConfirmInput,
  invocationAcceptConfirmInputSchema,
  invocationsList,
  type SignedConfirmProof,
} from "../../packages/contracts/apps/mod.ts";
import {
  type AgentAppScope,
  toolCallRead,
} from "../../packages/contracts/lophn-agent/mod.ts";
import {
  applyApprovedAction,
  type ApprovalAction,
  approvalsGet,
  routePath,
} from "../../packages/contracts/platform/mod.ts";
import {
  createRuntimeClient,
  type DirectTransport,
} from "../../packages/apps/runtime/client/mod.ts";
import {
  type AppJudgmentPorts,
  createAppBinding,
  type ToolBinding,
} from "../../packages/lophn-agent/harness/tool-judgment/mod.ts";
import {
  type AppBlueprintView,
  type AppCommandPorts,
  type AppGrant,
  type AppInvokeCall,
  type AppTool,
  buildAppTools,
  createAppToolHandlers,
  revertCounterpart,
  type ToolHandler,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import {
  createAppToolLookups,
  type ToolLookup,
} from "../../packages/lophn-agent/harness/waiting-and-recovery/mod.ts";
import type { AppOffer } from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import { commandOf, type CoreCall, readOf } from "./core-call.ts";

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
};

const PLACEHOLDER_SCREEN = "main";

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
      async nonce(app, command, call) {
        const session = await connect({
          app,
          command,
          run: call.run,
          toolCall: call.toolCall,
        });
        return session.ok
          ? ok(session.value.connection.process_nonce)
          : session;
      },
    };
    return ports;
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
    lookups(tools) {
      return createAppToolLookups(
        tools,
        (_contract, input) => machine(routePath(invocationsList), input),
      );
    },
  };
}
