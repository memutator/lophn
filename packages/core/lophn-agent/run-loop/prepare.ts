import { z } from "zod";
import {
  canonicalize,
  type Clock,
  err,
  fingerprint,
  type IdSource,
  ok,
  type Result,
} from "../../../base/mod.ts";
import {
  type AgentPlace,
  assignmentRead,
  finishRun,
  type ModelChoice,
  type ResolvedAgent,
  RUN_BLOB_PURPOSES,
  runList,
  runRead,
  sessionRead,
  startRun,
  type WorkPlace,
} from "../../../protocol/lophn-agent/mod.ts";
import { createApprovalRequest } from "../../../protocol/approvals/mod.ts";
import { settingsGet } from "../../../protocol/config/mod.ts";
import type { InstructionDeps } from "../instructions/mod.ts";
import type { SkillEntry } from "../extensions/mod.ts";
import { ROLE_CAPS } from "../agents/mod.ts";
import {
  abortableWait,
  type AgentRunCredential,
  type AppOffer,
  computeAgentAppScope,
  type LoopDeps,
  resolveRunLimits,
  RUN_LIMIT_SETTING_KEYS,
  type RunContext,
  type RunCredentials,
  type Selection,
} from "./mod.ts";
import {
  createWaitResolver,
  recoverRunFromLedger,
  type ToolLookup,
} from "../waiting-and-recovery/mod.ts";
import type {
  MaterialSource,
  SessionConversation,
} from "../prompt-assembly/mod.ts";
import type { ToolBinding } from "../tool-judgment/mod.ts";
import {
  BUILTIN_TOOLS,
  listTools,
  runOperations,
  type ToolDefinition,
  type ToolHandler,
} from "../tools/mod.ts";
import type { AppTool } from "../tools/mod.ts";
import type { AppToolkit } from "../tools/app-toolkit.ts";
import {
  contextReadToolsFor,
  type ContextToolkit,
  type ContextToolPin,
  pinsOf,
} from "../tools/context-search.ts";
import { loadContextMaterials } from "../prompt-assembly/context-overview.ts";
import {
  type CannotStart,
  pinnedRun,
  placeOfRun,
  resolveRunAgent,
} from "../agents/layers.ts";
import { commandOf, type CoreCall, readOf } from "./core-call.ts";
import { createCorePorts, type RunSeat } from "./core-ports.ts";
import { readSessionConversation } from "../session/history.ts";
import type { ModelBinding } from "../models/binding.ts";
import { type BlobPort, type RedactText, storeValue } from "./blobs.ts";
import type { DriveDeps, PreparedResume, PreparedRun } from "./driver.ts";
import {
  buildMcpTools,
  createMcpToolHandlers,
  EXTERNAL_TOOL_CONCERN,
  type ExternalTool,
  type McpSelection,
  type McpToolCall,
  type McpToolsSource,
} from "../extensions/mod.ts";

// 선택한 run을 시작하기 전의 재료를 core 기록에서 모은다(lophn-agent/harness/run-loop). assignment와
// 이번 run의 resolved agent(층을 합친 값, lophn-agent/agents), 역할 상한과 resolved agent가 받은 tool
// 목록, 적용 한도, StartRun이 확정할 AgentAppScope, 고정할 run 근거(basis)를 만든다. resolved agent는
// run마다 한 번 만들어 기준에 고정하고 이어 하기는 고정한 값을 그대로 쓴다. model 선택의 검증(catalog·
// credential)과 tool의 소유 계약 연결은 주입한다.

// 이 run의 외부 MCP tool 등록이다. 등록 화면은 현재 서버 설정과 연결 화면을 읽어
// buildMcpTools로 정의를 만들고, 재조회가 끝날 때까지 그 server tool 호출을 막는다.
// 어느 서버를 연결하나. place는 그 agent가 여는 자리다(전역 서버에 그 자리 층의 서버를 더한다).
// skip은 agent 정의가 통째로 끈 서버, only는 이미 고정한 agent가 켠 서버이고 둘 다 연결하지 않는다.
export type McpSourceOptions = {
  place?: AgentPlace | null;
  skip?: ReadonlySet<string>;
  only?: ReadonlySet<string>;
};

export type McpToolkit = {
  // 등록된 서버 설정과 검증을 지난 tool 목록을 읽는다. 설정은 사람의 registry 출처다.
  source(
    assignment: string,
    options?: McpSourceOptions,
  ): Promise<Result<McpToolsSource>>;
  // 고른 MCP(서버+현재 tool 정확한 쌍)와 safe 표시를 골라낸다.
  selection(definition: unknown): McpSelection | null;
  // 도구 호출 통로다(재조회가 끝날 때까지 호출은 거절된다).
  call(assignment: string): McpToolCall;
  // 서버의 연결 설정 판이다(판정 근거 mcp_configuration_revision).
  connectionRevision(
    definition: ToolDefinition,
    assignment: string,
  ): { revision: number } | undefined;
};

export type Toolkit = {
  // 내장 tool 정의의 출처. 없으면 제품 내장 전부다.
  definitions?: readonly ToolDefinition[];
  // 호출의 소유 계약 연결. 읽기 tool은 기본 연결을 쓰고 쓰기·external은 여기서 낸다. run은 이 run의
  // agent 자격과 자리, 확인을 마친 대상을 올리는 범위다.
  binding(
    definition: ToolDefinition,
    run?: { agent: CoreCall; seat: RunSeat; reach: Set<string> },
  ): ToolBinding | undefined;
  // 이 run의 agent 자격으로 소유 계약을 부르는 handler.
  handlers(seat: RunSeat, agent: CoreCall): ReadonlyMap<string, ToolHandler>;
  // 현재 run이 닿을 수 있는 대상 ID(assignment 담당 범위).
  targets?(
    assignment: { scope: { kind: string; id: string | null } },
  ): string[];
  // 외부 MCP tool 등록이다. 없으면 external 정의가 없다.
  mcp?(assignment: string): McpToolkit | undefined;
  // 선택한 context의 선언 검색 tool과 개체 읽기 tool의 재료·handler다. 없으면
  // context tool이 없다.
  contexts?: ContextToolkit;
  // 결과를 모르는 쓰기·external의 저장된 결과를 소유 계약에서 조회한다(tool 이름 → 조회). 없는 tool은
  // 결과를 확인할 수 없는 것으로 다룬다.
  lookups?(seat: RunSeat, agent: CoreCall): ReadonlyMap<string, ToolLookup>;
};

export type PreparerDeps = {
  clock: Clock;
  ids: IdSource;
  // machine 자격의 loopback.
  machine: CoreCall;
  // run의 agent credential token으로 부르는 loopback.
  agentCall(token: string): CoreCall;
  // resolved agent의 model 선택을 검증해 model 묶음으로 만든다(catalog·계정·adapter).
  resolveModel(
    input: { model: ModelChoice; purpose?: "judgment" | "organizing" },
  ): Promise<Result<ModelBinding>>;
  toolkit: Toolkit;
  // 앱 command 선언과 사람 허락. 없으면 앱 command 없는 scope다.
  offers?(assignment: { id: string }): Promise<readonly AppOffer[]>;
  // 앱 command의 자동 tool(선언·허락 읽기, 판정 근거, 호출, 결과 조회). 있으면 `offers`를 대신한다.
  apps?: AppToolkit;
  product: string;
  rolePrompt(role: string): Promise<Result<string>>;
  instructions: InstructionDeps;
  // run마다 그 run으로 지침 파일을 읽는 통로. 있으면 `instructions.files` 대신 쓴다(core가 run의 작업 자리와
  // 첨부만 읽게 한다).
  instructionFilesFor?(run: string): InstructionDeps["files"];
  // run 근거·결과와 model·tool 기록의 본문을 blob으로 먼저 저장하는 통로.
  blobs: BlobPort;
  // 그 agent가 여는 자리에서 발견하는 skill이다: 전역 층에 그 자리 층을 더한다.
  skills?(place: AgentPlace | null): Promise<readonly SkillEntry[]>;
  timezone?(): string | null;
  redact?: RedactText;
  approvalTtlMs?: number;
  reservedOutput?: number;
};

// 읽기 tool의 기본 연결이다. 읽기는 대상 변경이 없어 소유 계약의 이름만 있으면 된다.
export function readBinding(definition: ToolDefinition): ToolBinding {
  return {
    resolve: () =>
      ok({
        concern: definition.contract,
        operation: definition.contract,
        contractRevision: definition.revision,
        targets: [],
        comparison: {},
        changes: "reads only",
        external: null,
        reversibility: "nothing changes",
      }),
  };
}

// 외부 MCP tool의 연결이다. 대상은 고른 쌍 하나이고 판정이 그 쌍으로 범위와 되돌림을 본다.
// 분류가 안 됐거나 쓰기·external이면 판정표가 묻는다. 입력 비교 기준은 없다.
function externalBinding(tool: ExternalTool): ToolBinding {
  return {
    resolve: () =>
      ok({
        concern: EXTERNAL_TOOL_CONCERN,
        operation: tool.definition.contract,
        contractRevision: tool.definition.revision,
        targets: [{
          id: tool.target,
          reversibility: tool.reversible
            ? "reversible" as const
            : "unknown" as const,
        }],
        comparison: {},
        changes: tool.effect === "read"
          ? "reads only"
          : `calls tool ${tool.original} of server ${tool.server}`,
        external: tool.effect === "read" ? null : `MCP server ${tool.server}`,
        reversibility: tool.reversible ? "reversible" : "not guaranteed",
      }),
  };
}

type RunRecord = z.output<typeof runRead.output>["run"];
type AssignmentRecord = z.output<typeof assignmentRead.output>["assignment"];

export type PreparerResult =
  & Pick<
    DriveDeps,
    "prepare" | "closeUnusable" | "liveRuns"
  >
  & {
    // 재시작·사람의 결정 뒤 같은 run을 잇는 재료(lophn-agent/harness/waiting-and-recovery).
    prepareResume(
      run: string,
      credentials: RunCredentials,
    ): Promise<Result<PreparedResume>>;
  };

// 앱 command tool의 원래 호출 계약이다(tool_calls.app_command). revert_command가 있으면 기록이 앱의 선언된
// revert command를 revert에 싣는다.
export function appCommandOf(app: AppTool) {
  return {
    app: app.app,
    release: app.release,
    command: app.command,
    blueprint_hash: app.blueprintHash,
    definition_hash: app.definitionHash,
    permission_basis: app.permissionBasis,
    context_binding: null,
    ...(app.revertCommand === null
      ? {}
      : { revert_command: app.revertCommand }),
  };
}

export function createRunPreparer(deps: PreparerDeps): PreparerResult {
  const { machine, clock, ids } = deps;

  // 등록된 외부 MCP tool이다. 읽지 못하면 서버 자체가 없는 것과 같은 답이다(fails closed).
  async function loadMcp(
    assignment: string,
    options: McpSourceOptions = {},
  ) {
    const kit = deps.toolkit.mcp?.(assignment);
    if (kit === undefined) return { kit, source: null };
    const source = await kit.source(assignment, options);
    return { kit, source: source.ok ? source.value : null };
  }
  type LoadedMcp = Awaited<ReturnType<typeof loadMcp>>;

  // run과 assignment, 이번 run의 resolved agent로 tool·scope·model을 모은다. `pinnedContexts`는 resume에서
  // run이 시작할 때 선언 검색 정의를 만든 판들이다. 없으면 resolved agent의 context의 지금 적용된 판으로 만든다.
  async function material(
    run: RunRecord,
    assignment: AssignmentRecord,
    agent: ResolvedAgent,
    mcp: LoadedMcp,
    pinnedContexts?: readonly ContextToolPin[],
  ) {
    // 역할 상한 ∩ 자리·정의의 권한(resolved agent의 tools)이 이번 run이 제공하는 tool 목록이다. 외부 MCP
    // tool은 상한 항목이 아니라 agent 정의의 선택 항목이라 정의 이름을 양쪽 이름 목록에
    // 더한다. 그렇지 않으면 목록 이름 검사가 모두 떨어뜨린다.
    const roleTools = ROLE_CAPS.get(assignment.role)?.tools ?? null;
    const agentTools = agent.tools;

    // 앱 command의 선언과 사람의 허락. 읽지 못하면 앱 command 없는 scope다(fail closed).
    const loaded = deps.apps === undefined ? undefined : await deps.apps.load();
    const offers = loaded !== undefined
      ? (loaded.ok ? loaded.value.offers : [])
      : deps.offers === undefined
      ? []
      : await deps.offers(assignment);
    const scope = computeAgentAppScope({
      role: assignment.role,
      assignment: assignment.id,
      work: assignment.scope,
      read_apps: [...new Set(agent.app_reads.map((read) => read.app))],
      read_commands: agent.app_reads,
      offers,
    });
    if (!scope.ok) return scope;

    // 앱 command 정의는 역할·현재 허락·assignment(AgentAppScope)의 교집합만이다.
    const appTools: readonly AppTool[] = deps.apps === undefined ||
        loaded === undefined || !loaded.ok
      ? []
      : await deps.apps.define(scope.value, loaded.value);

    // 외부 MCP tool 등록이다. 사람의 registry(mcp_servers 설정)와 agent의 켜진 MCP만이 출처이며,
    // 목록을 다시 읽지 못하면 그 server tool 정의가 없는 것과 같다(재조회 실패는 옛 정의를
    // 호출 가능으로 두지 않는다).
    const mcpKit = mcp.kit;
    let external: readonly ExternalTool[] = [];
    if (mcpKit !== undefined && mcp.source !== null) {
      const selection = mcpKit.selection({
        mcp: {
          servers: [...new Set(agent.mcp.map((tool) => tool.server_name))],
          tools: agent.mcp,
        },
        safe_tools: agent.safe_tools,
      });
      // 켠 MCP가 없으면 제공도 없다.
      if (selection !== null) {
        const built = await buildMcpTools(mcp.source, selection);
        // 남은 충돌은 등록을 거절한다. 그 server의 정의가 전부 빠진다.
        if (built.ok) external = built.value;
      }
    }

    // 선언 검색 tool과 개체 읽기 tool은 resolved agent의 context의 적용된 판에서 만든다.
    // 판은 시작 전에 한 번 읽고 정의 hash가 Run.basis에 고정된다.
    const contextRead = await contextReadToolsFor(deps.toolkit.contexts, {
      contexts: agent.contexts,
      ...(pinnedContexts === undefined ? {} : { pinned: pinnedContexts }),
    });

    const listed = listTools(
      {
        builtin: [
          ...(deps.toolkit.definitions ?? BUILTIN_TOOLS),
          ...(contextRead.entity === null ? [] : [contextRead.entity]),
        ],
        app: appTools.map((tool) => tool.definition),
        context: contextRead.search.map((tool) => tool.definition),
        external: external.map((tool) => tool.definition),
      },
      {
        presetTools: external.length === 0
          ? agentTools
          : [...agentTools, ...external.map((tool) => tool.definition.name)],
        roleTools: roleTools === null || external.length === 0 ? roleTools : [
          ...roleTools,
          ...external.map((tool) => tool.definition.name),
        ],
        contexts: contextRead.contexts,
      },
    );

    const model = await deps.resolveModel({ model: agent.model });
    if (!model.ok) return model;

    const place: WorkPlace = agent.place;
    const seat: RunSeat = {
      run: run.id,
      assignment: assignment.id,
      session: run.session,
    };
    return ok({
      agent,
      listed,
      appTools,
      contextRead,
      // resume이면 prompt 자료도 tool 정의와 같은 고정한 판으로 만든다.
      pinnedContexts,
      external,
      scope: scope.value,
      model: model.value,
      place,
      seat,
      // 이 run의 요청 메시지. 이전 대화는 이 메시지 앞까지다.
      request: run.source.kind === "message" ? run.source.message : null,
      mcpKit,
    });
  }

  type Material = Extract<
    Awaited<ReturnType<typeof material>>,
    { ok: true }
  >["value"];

  // 이 run의 loop deps와 core port. agent 호출은 credential token을 받은 뒤에 열린다.
  function loopFor(
    m: Material,
    assignment: AssignmentRecord,
    agent: CoreCall,
  ) {
    const { seat, listed, model, agent: resolved, place, external } = m;
    const toolkit = deps.toolkit;
    const externalByName = new Map(
      external.map((tool) => [tool.definition.name, tool]),
    );
    const bindings = new Map<string, ToolBinding>();
    // 이 run이 닿는 대상 ID다. 앱 command의 대상은 AgentAppScope에 든 앱이고, 쓰기 tool의 연결이 확인을
    // 마친 대상을 더한다. run과 assignment는 호출하는 자기 자신이다.
    const reach = new Set<string>([
      ...(toolkit.targets?.(assignment) ?? []),
      ...m.scope.apps.map((entry) => entry.app),
      ...external.map((tool) => tool.target),
      seat.run,
      assignment.id,
    ]);
    const appByName = new Map(
      m.appTools.map((tool) => [tool.definition.name, tool]),
    );
    for (const tool of listed) {
      const app = appByName.get(tool.name);
      if (app !== undefined && deps.apps !== undefined) {
        bindings.set(tool.name, deps.apps.binding(app, agent));
        continue;
      }
      const bound = toolkit.binding(tool, { agent, seat, reach }) ??
        (tool.effect === "read" ? readBinding(tool) : undefined);
      if (bound !== undefined) bindings.set(tool.name, bound);
    }
    // 외부 MCP tool의 소유 계약 연결이다. 스코프 검사는 builder가 이미 정확한 쌍만 골랐다.
    for (const tool of external) {
      bindings.set(tool.definition.name, externalBinding(tool));
    }
    // context 자료는 run을 시작할 때 한 번만 읽고 turn마다 같은 값을 쓴다. resume이면
    // tool 정의와 같은 고정한 판으로 만든다.
    let sourcesRead: Promise<MaterialSource[]> | undefined;
    const contextSources = (): Promise<MaterialSource[]> =>
      sourcesRead ??= loadContextMaterials(agent, {
        contexts: resolved.contexts,
        ...(m.pinnedContexts === undefined ? {} : { pins: m.pinnedContexts }),
      }).then((set) => [
        ...set.materials.map((item) => ({
          address: item.context,
          title: item.title,
          version: item.bundle_hash,
          overview: item.overview,
          type_names: item.type_names,
          glossary: item.glossary,
          has_glossary: !item.glossary_empty,
        })),
        // 고른 context를 읽지 못했으면 조용히 빼지 않고 자료 자리에 이유를 남긴다. 판이 없으니 version은 없다.
        ...set.omitted.map((item) => ({
          address: item.context,
          title: item.title,
          version: null,
          overview: `[자료 없음] ${item.reason}. 필요하면 tool로 다시 읽는다.`,
          type_names: [],
          glossary: "",
          has_glossary: false,
          unavailable: item.reason,
        })),
      ]);
    // session의 이전 대화는 run마다 한 번 읽는다. 일하는 run이 있는 session은 Compact하지 않으므로 run 안에서
    // 바뀌지 않는다.
    let conversation: SessionConversation | undefined;
    const context = async (): Promise<Result<RunContext>> => {
      const role = await deps.rolePrompt(assignment.role);
      if (!role.ok) return role;
      if (conversation === undefined) {
        const read = await readSessionConversation(machine, {
          session: seat.session,
          request: m.request,
        });
        if (!read.ok) return read;
        conversation = read.value;
      }
      return ok({
        product: { instructions: deps.product },
        role: { instructions: role.value },
        tools: listed.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema ?? z.toJSONSchema(tool.input),
        })),
        work: {
          role: assignment.role,
          session: place,
          scope: assignment.scope,
        },
        attachments: [],
        purpose: null,
        run_facts: null,
        session: conversation,
        sources: await contextSources(),
        // 발견한 skill 중 agent가 끄지 않은 이름만 prompt에 오른다.
        skills: ((await deps.skills?.(place)) ?? []).map((entry) => ({
          ...entry,
          selected: resolved.skills.includes(entry.name),
        })),
        timezone: deps.timezone?.() ?? null,
        limits: {
          context_limit: model.call.limits.context_limit,
          input_limit: model.call.limits.input_limit,
          output_limit: model.call.limits.output_limit,
        },
        reserved_output: Math.min(
          deps.reservedOutput ?? 8000,
          model.call.limits.output_limit,
        ),
      });
    };
    const ported = createCorePorts({
      seat,
      clock,
      ids,
      machine,
      agent,
      blobs: deps.blobs,
      redact: deps.instructions.redact,
      agentHash: resolved.hash,
      model,
      tools: {
        listed,
        bindings,
        handlers: new Map([
          ...toolkit.handlers(seat, agent),
          ...(deps.apps?.handlers(m.appTools, agent) ?? []),
          ...(deps.toolkit.contexts?.handlers(m.contextRead, agent) ?? []),
          ...(m.mcpKit === undefined ? [] : createMcpToolHandlers(
            external,
            m.mcpKit.call(assignment.id),
          )),
        ]),
        credential: {
          run: seat.run,
          targets: reach,
          operations: new Set([
            ...runOperations(listed),
            // ask는 이 run의 자격으로 approval request를 만든다. 쓰기·external tool이 하나라도
            // 있으면 내장·앱·외부 어느 길이든 물을 수 있다.
            ...(external.length > 0 ||
                listed.some((tool) => tool.effect !== "read")
              ? [createApprovalRequest.name]
              : []),
          ]),
        },
        mcpConnection: (toolDefinition) =>
          m.mcpKit?.connectionRevision(toolDefinition, assignment.id),
        server: (toolDefinition) =>
          externalByName.get(toolDefinition.name)?.server ?? null,
        extension: (toolDefinition) => {
          const found = externalByName.get(toolDefinition.name);
          return found === undefined ? null : {
            server_name: found.server,
            configuration_revision: found.configurationRevision,
            original_tool: found.original,
            canonical_name: found.definition.name,
          };
        },
        // 앱 command tool의 원래 호출 계약이다. 기록이 tool_calls.app_command로 묶는다.
        // revert_command가 있으면 기록이 앱의 선언된 revert command를 revert에 싣는다.
        appCommand: (definition) => {
          const app = appByName.get(definition.name);
          return app === undefined ? undefined : appCommandOf(app);
        },
        approvalTtlMs: deps.approvalTtlMs ?? 600_000,
      },
      context,
    });
    const resolver = createWaitResolver({
      machine,
      judgment: ported.judgment,
      callRequest: ported.callRequest,
    });
    const loopDeps: LoopDeps = {
      clock,
      wait: abortableWait,
      random: Math.random,
      instructions: deps.instructionFilesFor === undefined
        ? deps.instructions
        : {
          ...deps.instructions,
          files: deps.instructionFilesFor(seat.run),
        },
      ports: ported.ports,
    };
    return { ported, resolver, loopDeps };
  }

  // 시작하지 못한 run을 영구 불가 이유로 끝내고 이유를 결과에 남긴다. 끝내지 못해도 run은
  // 접수 상태로 남아 다음에 다시 시도한다.
  async function closeUnstarted(run: RunRecord, cannot: CannotStart) {
    const result = await storeValue(
      deps.blobs,
      deps.instructions.redact,
      RUN_BLOB_PURPOSES.run_result,
      { run: run.id, why: cannot.why },
    );
    if (!result.ok) return;
    await commandOf(
      machine,
      finishRun,
      {
        run: run.id,
        outcome: { kind: "failed", reason: cannot.reason },
        result: result.value.hash,
        result_size: result.value.size,
      },
      { state_seq: run.state_seq },
      `${run.id}:finish:${cannot.why}`,
    );
  }

  async function prepare(
    selection: Selection,
  ): Promise<Result<PreparedRun>> {
    const run = await readOf(machine, runRead, { run: selection.run });
    if (!run.ok) return run;
    const assigned = await readOf(machine, assignmentRead, {
      assignment: selection.assignment,
    });
    if (!assigned.ok) return assigned;
    const assignment = assigned.value.assignment;

    const settings = await readOf(machine, settingsGet, {
      keys: Object.values(RUN_LIMIT_SETTING_KEYS),
    });
    if (!settings.ok) return settings;
    const limits = resolveRunLimits(settings.value.settings);
    if (!limits.ok) return limits;

    // 이번 run의 resolved agent. 층을 합친 값을 run 기준에 고정한다. model이 어느 층에도 없거나 정의 파일이
    // 틀렸으면 run을 시작하지 않고 이유와 함께 끝낸다.
    // 자리 층의 skill·MCP는 그 agent가 여는 자리의 것만이다. 켠 서버만 연결한다: 정의가 통째로
    // 끈 서버는 resolve가 정의를 읽은 뒤에 알려 주고, 정의가 끈 skill은 resolve가 뺀다.
    const sessionRecord = run.value.run.session === null
      ? null
      : await readOf(machine, sessionRead, { session: run.value.run.session });
    if (sessionRecord !== null && !sessionRecord.ok) return sessionRecord;
    const placed = await placeOfRun(
      machine,
      run.value.run,
      assignment,
      sessionRecord === null ? null : sessionRecord.value.session,
    );
    if (!placed.ok) return placed;
    const skills = (await deps.skills?.(placed.value)) ?? [];
    let mcp: LoadedMcp | undefined;
    const made = await resolveRunAgent(machine, {
      run: run.value.run,
      assignment,
      skills: skills.map((entry) => entry.name),
      mcp: async (off, place) => {
        mcp = await loadMcp(assignment.id, { place, skip: off });
        return (mcp.source?.tools ?? []).map((tool) => ({
          server_name: tool.server,
          original_tool: tool.original,
        }));
      },
    });
    if (!made.ok) return made;
    if (made.value.kind === "cannot_start") {
      await closeUnstarted(run.value.run, made.value);
      return err({
        code: "unavailable",
        message: `the run cannot start: ${made.value.why}`,
      });
    }
    const agent = made.value.agent;

    const found = await material(
      run.value.run,
      assignment,
      agent,
      mcp ?? await loadMcp(assignment.id, { place: agent.place }),
    );
    if (!found.ok) return found;
    const { listed, scope, model, place, contextRead } = found.value;

    // 전체 값은 blob이고 run 기준에는 hash와 칸별 출처만 둔다. 기준과 agent blob은 둘 다
    // 영구 참조라 저장한 바이트의 hash로 StartRun에 싣는다.
    const stored = await storeValue(
      deps.blobs,
      deps.instructions.redact,
      RUN_BLOB_PURPOSES.run_agent,
      agent,
    );
    if (!stored.ok) return stored;

    const basis = await storeValue(
      deps.blobs,
      deps.instructions.redact,
      RUN_BLOB_PURPOSES.run_basis,
      {
        agent: { hash: agent.hash, sources: agent.sources },
        assignment: {
          id: assignment.id,
          revision: assignment.revision,
          snapshot_hash: await fingerprint(assignment),
          basis_seq: run.value.as_of_seq,
        },
        tools: {
          revision: "1",
          definitions_hash: await fingerprint(
            listed.map((tool) => [tool.name, tool.revision]),
          ),
          // 선언 검색 정의를 만든 판이다. resume이 같은 판으로 정의를 다시 만든다.
          contexts: contextRead.pins,
        },
        models: { judgment: model.call, organizing: model.call },
        initial_work_place: place,
        limits: limits.value,
      },
    );
    if (!basis.ok) return basis;

    return ok({
      begin: {
        run: selection.run,
        assignment: selection.assignment,
        stateSeq: selection.stateSeq,
        basis: basis.value.hash,
        basisSize: basis.value.size,
        agent: stored.value.hash,
        agentSize: stored.value.size,
        limits: limits.value,
        scope,
      },
      async startRun(input) {
        const started = await commandOf(
          machine,
          startRun,
          {
            run: input.run,
            basis: input.basis,
            ...(input.basisSize === undefined
              ? {}
              : { basis_size: input.basisSize }),
            ...(input.agent === undefined || input.agentSize === undefined
              ? {}
              : { agent: input.agent, agent_size: input.agentSize }),
            limits: input.limits,
            scope: input.scope,
          },
          { state_seq: input.stateSeq },
          `${input.run}:start`,
        );
        return started.ok
          ? ok({
            run: started.value.id,
            state_seq: started.value.state_seq,
            basis: started.value.basis,
          })
          : started;
      },
      loop(credential) {
        const built = loopFor(
          found.value,
          assignment,
          deps.agentCall(credential.token),
        );
        return {
          provider: found.value.model.call.provider,
          settle: () => built.resolver.settle(selection.run),
          deps: built.loopDeps,
          input: {
            run: selection.run,
            session: found.value.seat.session,
            limits: limits.value,
            elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
            attempts: 0,
          },
        };
      },
    });
  }

  // 시작한 run을 저장된 경계에서 잇는 재료다. resolved agent는 run 기준이 고정한 값을 그대로 쓰고(정의·
  // 설정·Workspace는 다시 읽지 않는다) 한도는 StartRun이 고정한 값이다. 현재 assignment·scope·credential·model은 새 진입 전에 다시 확인한다.
  async function prepareResume(
    runId: string,
    credentials: RunCredentials,
  ): Promise<Result<PreparedResume>> {
    const run = await readOf(machine, runRead, { run: runId });
    if (!run.ok) return run;
    const record = run.value.run;
    const assigned = await readOf(machine, assignmentRead, {
      assignment: record.assignment,
    });
    if (!assigned.ok) return assigned;
    const assignment = assigned.value.assignment;
    const pinned = await pinnedRun(machine, runId, record.assignment);
    if (!pinned.ok) return pinned;
    // 이어 하기는 고정한 agent가 켠 서버만 연결한다.
    const found = await material(
      record,
      assignment,
      pinned.value.agent,
      await loadMcp(assignment.id, {
        place: pinned.value.agent.place,
        only: new Set(pinned.value.agent.mcp.map((tool) => tool.server_name)),
      }),
      // 선언 검색 정의를 만든 판도 run 기준이 고정한 값이다. 지금 적용된 판이 아니라 이 판으로 다시 만든다.
      pinsOf(pinned.value.contexts),
    );
    if (!found.ok) return found;
    const holder: { agent?: CoreCall } = {};
    const agent: CoreCall = (path, body) =>
      holder.agent === undefined
        ? Promise.resolve(
          err({ code: "unauthorized" as const, message: "no run credential" }),
        )
        : holder.agent(path, body);
    const built = loopFor(found.value, assignment, agent);
    const lookups = new Map([
      ...(deps.toolkit.lookups?.(found.value.seat, agent) ?? []),
      ...(deps.apps?.lookups(found.value.appTools) ?? []),
    ]);
    let held: AgentRunCredential | undefined;
    const recoveryDeps = {
      machine,
      clock,
      store: (purpose: string, value: unknown) =>
        storeValue(deps.blobs, deps.instructions.redact, purpose, value),
      lookup: (tool: string) => lookups.get(tool),
      close: built.ported.ports.tools.close,
    };
    return ok({
      assignment: record.assignment,
      settle: () => built.resolver.settle(runId),
      async recover(executing) {
        // 이 run의 ledger 사실로 경계를 확정한다. credential은 새 진입이 확정된 뒤에만 받는다.
        const outcome = await recoverRunFromLedger(recoveryDeps, runId, {
          ...(executing === undefined ? {} : { executing }),
          async preflight(fixed) {
            // 현재 scope가 StartRun이 고정한 값과 다르면 진행하지 않는다.
            if (
              canonicalize(fixed.scope) !== canonicalize(found.value.scope)
            ) return "target_unavailable";
            if (!(await found.value.model.available())) {
              return "configuration_unavailable";
            }
            const opened = await credentials.open({
              run: runId,
              assignment: record.assignment,
              scope: found.value.scope,
            });
            if (!opened.ok) return "configuration_unavailable";
            held = opened.value;
            holder.agent = deps.agentCall(opened.value.token);
            return null;
          },
        });
        if (!outcome.ok || outcome.value.kind !== "resume") {
          if (held !== undefined) credentials.end(runId);
          return outcome.ok
            ? ok({ kind: "ended" as const, outcome: outcome.value })
            : outcome;
        }
        const resumed = outcome.value;
        built.ported.resumeAfter(resumed.lastModelCall);
        return ok({
          kind: "resumed" as const,
          credential: held!,
          provider: found.value.model.call.provider,
          deps: built.loopDeps,
          settle: () => built.resolver.settle(runId),
          input: {
            run: runId,
            session: resumed.session,
            limits: record.limits,
            elapsed: resumed.elapsed,
            attempts: resumed.attempts,
            resume: resumed.resume,
          },
        });
      },
    });
  }

  return {
    prepare,
    prepareResume,
    // 재시작 뒤 복구할 run: 시작했고 끝나지 않은 run. 사람이 멈춘 run은 이미 끝나 있다.
    async liveRuns() {
      const live: { run: string; state: "running" | "waiting_user" }[] = [];
      for (const state of ["running", "waiting_user"] as const) {
        let cursor: string | undefined;
        for (let page = 0; page < 100; page++) {
          const listed = await readOf(machine, runList, {
            state,
            ...(cursor === undefined ? {} : { cursor }),
          });
          if (!listed.ok) return listed;
          for (const run of listed.value.runs) {
            live.push({ run: run.id, state });
          }
          if (
            listed.value.next_cursor === null ||
            listed.value.next_cursor === undefined
          ) break;
          cursor = listed.value.next_cursor;
        }
      }
      return ok(live);
    },
    // StartRun은 확정됐지만 credential을 받지 못한 run은 설정 불가로 끝낸다.
    async closeUnusable(selection) {
      const run = await readOf(machine, runRead, { run: selection.run });
      if (!run.ok) return;
      const result = await storeValue(
        deps.blobs,
        deps.instructions.redact,
        RUN_BLOB_PURPOSES.run_result,
        { run: selection.run, why: "credential" },
      );
      if (!result.ok) return;
      await commandOf(
        machine,
        finishRun,
        {
          run: selection.run,
          outcome: { kind: "failed", reason: "configuration_unavailable" },
          result: result.value.hash,
          result_size: result.value.size,
        },
        { state_seq: run.value.run.state_seq },
        `${selection.run}:finish:credential`,
      );
    },
  };
}
