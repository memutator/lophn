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
  type AgentSession,
  agentSessionRead,
  finishTurn,
  type McpServer,
  type ModelChoice,
  type Role,
  startTurn,
  TURN_BLOB_PURPOSES,
  type TurnLimits,
  turnRead,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { settingsList } from "../../../protocol/config/mod.ts";
import { createListSettingsReader } from "../../config/mod.ts";
import {
  type InstructionDeps,
  readTurnInstructions,
  type TurnDomain,
  type TurnInstructionLayer,
} from "../instructions/mod.ts";
import { domainList } from "../../../protocol/domains/mod.ts";
import type { SkillEntry } from "../extensions/mod.ts";
import { abortableWait } from "./retry.ts";
import { TURN_LIMIT_SETTING_KEYS, turnLimitsOf } from "./limits.ts";
import type { LoopDeps, TurnContext, TurnInput, TurnInputs } from "./ports.ts";
import type { AgentEventSink } from "./ports.ts";
import type { AgentTurnCredential, BeginTurnInput } from "./credentials.ts";
import type { StartTurnResult } from "./credentials.ts";
import type {
  InstructionTexts,
  SeenBasis,
  TurnPromptInput,
} from "../prompt-assembly/mod.ts";
import {
  definitionHash,
  runOperations,
  selectTools,
  type ToolContext,
  type ToolDefinition,
  type ToolHandler,
} from "../tools/mod.ts";
import type { AppToolkit } from "../tools/app-toolkit.ts";
import { buildAppTools } from "../tools/app-tools.ts";
import { type CannotStart, resolveTurnAgent } from "../agents/layers.ts";
import type { ResolvedAgent } from "../agents/mod.ts";
import type { AgentRoleTable } from "../agents/role-table.ts";
import { commandOf, type CoreCall, readOf } from "./core-call.ts";
import {
  createCorePorts,
  type ToolSetup,
  type TurnSeat,
} from "./core-ports.ts";
import { readSessionConversation } from "../session/history.ts";
import { cappedOutput, type ModelBinding } from "../models/binding.ts";
import { type BlobPort, type RedactText, storeValue } from "./blobs.ts";
import { inputText } from "./input-text.ts";
import type { TurnStart } from "./work.ts";
import {
  buildMcpTools,
  createMcpToolHandlers,
  type ExternalTool,
  type McpSelection,
  type McpToolCall,
  type McpToolsSource,
} from "../extensions/mod.ts";

// 시작할 turn의 재료를 core 기록에서 모은다. session의 agent(role과 place)와 이번 turn의 resolved agent
// (층을 합친 값), tool 목록, 적용 한도, 고정할 turn 근거(basis)를 만든다. tool 목록은 turn마다 새로 만들지
// 않고 session의 첫 turn에서 만든 것을 쓴다(model에 보이는 `tools[]`가 session 동안 같다). 도중에 달라지면
// 목록은 그대로 두고 대화 끝에 notice를 붙인다. model 선택의 검증(catalog·credential)은 주입한다.

// 이 turn의 외부 MCP tool 등록이다. 등록 화면은 현재 서버 설정과 연결 화면을 읽어 buildMcpTools로 정의를
// 만들고, 재조회가 끝날 때까지 그 server tool 호출을 막는다.
// 어느 서버를 연결하나. place는 그 agent가 여는 자리다(전역 서버에 그 자리 층의 서버를 더한다).
// skip은 agent 정의가 통째로 끈 서버이고 연결하지 않는다. agent는 그 agent 정의 층이다: 정의가 가진 서버와, 아래
// 층(전역, project)에서 끈 서버 이름이다.
export type McpSourceOptions = {
  place?: AgentPlace | null;
  skip?: ReadonlySet<string>;
  only?: ReadonlySet<string>;
  agent?: { servers: readonly McpServer[]; off: readonly string[] };
};

export type McpToolkit = {
  // 등록된 서버 설정과 검증을 지난 tool 목록을 읽는다. 설정은 사람의 registry 출처다.
  source(
    session: string,
    options?: McpSourceOptions,
  ): Promise<Result<McpToolsSource>>;
  // 고른 MCP(서버+현재 tool 정확한 쌍)와 safe 표시를 골라낸다.
  selection(definition: unknown): McpSelection | null;
  // 도구 호출 통로다(재조회가 끝날 때까지 호출은 거절된다).
  call(session: string): McpToolCall;
};

export type Toolkit = {
  // 내장 tool 정의의 출처다. 조립(main/agent-tools.ts)이 준다.
  definitions: readonly ToolDefinition[];
  // 이 turn의 agent 자격으로 소유 계약을 부르는 handler. 정의가 handler를 들지 않은 tool만 쓴다.
  handlers(seat: TurnSeat, agent: CoreCall): ReadonlyMap<string, ToolHandler>;
  // 외부 MCP tool 등록이다. 없으면 external 정의가 없다.
  mcp?(session: string): McpToolkit | undefined;
  // 허락된 앱의 tool 정의와 목록에 없는 이유 구별이다. 없으면 tool이 없다.
  appTool?: AppToolkit;
};

// ToolContext에서 이 turn이 정하지 않는 칸들이다. 사람의 결정을 기다리는 Gate, Router, 질문, 폴더 범위,
// skill 읽기는 조립이 session마다 끼운다.
export type ToolPorts = Pick<
  ToolContext,
  "gate" | "router" | "questions" | "scope" | "skills" | "fetch"
>;

type PreparerDeps = {
  clock: Clock;
  ids: IdSource;
  // machine 자격의 loopback.
  machine: CoreCall;
  // turn의 agent credential token으로 부르는 loopback.
  agentCall(token: string): CoreCall;
  // resolved agent의 model 선택을 검증해 model 묶음으로 만든다(catalog·계정·adapter).
  resolveModel(
    input: { model: ModelChoice; purpose?: "judgment" | "organizing" },
  ): Promise<Result<ModelBinding>>;
  toolkit: Toolkit;
  // ToolContext의 바깥 연결. 끼우지 않으면 tool 호출은 닫힌 채 실패한다.
  // `core`는 이 turn의 agent 자격 loopback이고 `skills`는 resolved agent가 켠 skill 이름이다.
  toolPorts(
    session: AgentSession,
    turn: { core: CoreCall; skills: readonly string[] },
  ): ToolPorts;
  // agent event를 Bus로 보내는 길(감독 pipe).
  events: AgentEventSink;
  // 제품 고정 규칙을 포함한 role 지침 글.
  rolePrompt(role: string): Promise<Result<string>>;
  // prompt의 place 정보와 file tool이 닿는 폴더를 turn의 agent 자격 읽기로 모은다. role 규칙은 role 층이 쥔다.
  placeData(call: CoreCall, resolved: ResolvedAgent): Promise<
    Result<{
      place: TurnPromptInput["place"];
      scope: { read: string[]; write: string[]; base?: string };
    }>
  >;
  // role이 고정한 tool 이름 목록. 어느 role이 어느 tool을 보는지는 role 층이 정한다.
  roleTools(role: Role): readonly string[];
  // role마다 다른 이름·기본 profile 규칙. role 층이 정해 조립이 넘긴다.
  roles: AgentRoleTable;
  instructions: InstructionDeps;
  // session마다 그 session으로 지침 파일을 읽는 통로. 있으면 `instructions.files` 대신 쓴다(core가 session의
  // place로 어느 project인지 정한다).
  instructionFilesFor?(session: Id<"ses">): InstructionDeps["files"];
  // turn 근거·결과와 model·tool 기록의 본문을 blob으로 먼저 저장하는 통로.
  blobs: BlobPort;
  // 그 agent가 여는 자리에서 발견하는 skill이다: 전역 층에 그 자리 층을 더한다.
  skills?(place: AgentPlace | null): Promise<readonly SkillEntry[]>;
  timezone?(): string | null;
  redact?: RedactText;
};

type PreparedTurn = {
  turn: string;
  session: string;
  begin: BeginTurnInput;
  startTurn(input: BeginTurnInput): Promise<
    Result<StartTurnResult>
  >;
  // StartTurn은 확정됐지만 credential을 받지 못했을 때 turn을 failed(configuration_unavailable)로 닫는다.
  closeStarted(): Promise<void>;
  // StartTurn이 확정되고 credential을 받은 뒤에 loop 재료를 만든다.
  loop(
    credential: AgentTurnCredential,
    inputs: TurnInputs,
  ): {
    // 이 turn이 호출하는 provider. Disconnect를 알릴 때 회수할 turn을 고른다.
    provider: string;
    deps: LoopDeps;
    input: TurnInput;
  };
};

// 시작할 수 없는 turn은 core에서 failed로 닫혀 session은 입력을 계속 받는다.
type Preparation =
  | { kind: "ready"; turn: PreparedTurn }
  | { kind: "closed"; turn: string; reason: CannotStart["reason"] };

export type TurnPreparer = {
  prepare(start: TurnStart): Promise<Result<Preparation>>;
  // session이 끝났다. 고정한 tool 목록을 버린다.
  forget(session: string): void;
};

// session을 시작할 때 고정한 tool 목록이다. 정의는 model에 보인 그대로이고 handler는 turn마다 붙인다.
type FixedTools = {
  definitions: readonly ToolDefinition[];
  key: string;
};

// 지난 turn이 본 prompt의 판이다. compaction 경계(through_seq)를 같이 두어 Compact 뒤 첫 turn은 seen 없이 부른다.
type Seen = { basis: SeenBasis; compaction: string | null };

async function hashesOf(
  definitions: readonly ToolDefinition[],
): Promise<(string)[][]> {
  return await Promise.all(
    definitions.map(async (tool) => [tool.name, await definitionHash(tool)]),
  );
}

async function keyOf(definitions: readonly ToolDefinition[]): Promise<string> {
  return canonicalize(await hashesOf(definitions));
}

function names(definitions: readonly ToolDefinition[]): Set<string> {
  return new Set(definitions.map((tool) => tool.name));
}

// 고정한 목록과 지금 목록이 다를 때 대화 끝에 붙는 notice 본문이다. 이 session은 고정한 목록만 실행하므로 더한 tool은 새 session부터다. 빠진 tool은 Gate가 call 때 지금 grant를 읽어 바로 막으므로 지금부터 못 쓴다.
function toolsNotice(
  fixed: readonly ToolDefinition[],
  current: readonly ToolDefinition[],
): string {
  const before = names(fixed);
  const after = names(current);
  const added = [...after].filter((name) => !before.has(name));
  const removed = [...before].filter((name) => !after.has(name));
  const lines = ["The tools available to this session changed."];
  if (added.length > 0) {
    lines.push(`Available from a new session: ${added.join(", ")}.`);
  }
  if (removed.length > 0) {
    lines.push(
      `No longer available: ${removed.join(", ")}.`,
    );
  }
  lines.push(
    "This session keeps the tool list above; added tools can be called from a new session.",
  );
  return lines.join("\n");
}

function noticeText(body: string): string {
  return inputText({
    kind: "notice",
    from: { kind: "program", event_seq: "0" },
    call: null,
    reply_to: null,
    body,
    refs: [],
    delivery: "next_turn",
    message: null,
    reply: null,
    outcome: null,
    event: null,
    notice: "tools_changed",
  });
}

// prompt에 싣는 skill 목록이다. agent가 끄지 않은 이름만 켜지고, domain 층 skill은 agent가 맡은 domain의 것만 켜진다.
export function promptSkills(
  entries: readonly SkillEntry[],
  resolved: Pick<ResolvedAgent, "skills" | "domains">,
) {
  return entries.map((entry) => ({
    name: entry.name,
    description: entry.description,
    enabled: entry.enabled && resolved.skills.includes(entry.name) &&
      (entry.domain === null || resolved.domains.includes(entry.domain)),
  }));
}

// 없는 층은 빈 글이다.
function instructionTexts(
  layers: readonly TurnInstructionLayer[],
): InstructionTexts {
  const texts: InstructionTexts = {
    global: "",
    project: "",
    domain: "",
    agent: "",
  };
  for (const layer of layers) texts[layer.layer] = layer.text ?? "";
  return texts;
}

// agent가 맡은 domain의 이름과 purpose다(이름은 turn.ts가 순서를 정한다). turn을 시작하기 전이라 agent credential이
// 아직 없어 machine 자격으로 그릇의 domain 목록을 읽는다. 읽지 못하면 domain 층만 비우고 turn은 계속한다(prompt를
// 줄이는 쪽으로 실패한다).
async function readTurnDomains(
  machine: CoreCall,
  agent: ResolvedAgent,
): Promise<TurnDomain[]> {
  if (agent.domains.length === 0 || agent.place === null) return [];
  const listed = await readOf(machine, domainList, {
    owner: agent.place,
    limit: 1000,
  });
  if (!listed.ok) return [];
  return listed.value.domains
    .filter((domain) => agent.domains.includes(domain.id))
    .map(({ id, name, purpose }) => ({ id, name, purpose }));
}

export function createTurnPreparer(deps: PreparerDeps): TurnPreparer {
  const { machine, clock, ids } = deps;
  const fixedBySession = new Map<string, FixedTools>();
  const seenBySession = new Map<string, Seen>();

  // 등록된 외부 MCP tool이다. 읽지 못하면 서버 자체가 없는 것과 같은 답이다(fails closed).
  async function loadMcp(
    session: string,
    options: McpSourceOptions = {},
  ) {
    const kit = deps.toolkit.mcp?.(session);
    if (kit === undefined) return { kit, source: null };
    const source = await kit.source(session, options);
    return { kit, source: source.ok ? source.value : null };
  }
  type LoadedMcp = Awaited<ReturnType<typeof loadMcp>>;

  // session과 이번 turn의 resolved agent로 tool·model을 모은다.
  async function material(
    start: TurnStart,
    session: AgentSession,
    agent: ResolvedAgent,
    mcp: LoadedMcp,
    turn: string,
  ) {
    // 외부 MCP tool 등록이다. 사람의 registry(mcp_servers 설정)와 agent의 켜진 MCP만이 출처이며,
    // 목록을 다시 읽지 못하면 그 server tool 정의가 없는 것과 같다.
    const mcpKit = mcp.kit;
    let external: readonly ExternalTool[] = [];
    if (mcpKit !== undefined && mcp.source !== null) {
      const selection = mcpKit.selection({
        mcp: {
          servers: [...new Set(agent.mcp.map((tool) => tool.server_name))],
          tools: agent.mcp,
        },
        safe_tools: [],
      });
      // 켠 MCP가 없으면 제공도 없다.
      if (selection !== null) {
        const built = await buildMcpTools(mcp.source, selection);
        // 남은 충돌은 등록을 거절한다. 그 server의 정의가 전부 빠진다.
        if (built.ok) external = built.value;
      }
    }

    // 허락된 앱의 tool이다. 선언이나 grant를 읽지 못하면 그 앱은 없는 것과 같다.
    const apiKit = deps.toolkit.appTool;
    const loadedApi = apiKit === undefined
      ? null
      : await apiKit.load(session.agent);
    const appTool = apiKit === undefined || loadedApi === null || !loadedApi.ok
      ? null
      : {
        tools: await buildAppTools(loadedApi.value),
      };

    const model = await deps.resolveModel({ model: agent.model });
    if (!model.ok) return model;

    // role이 고정한 목록에 이 turn이 닿는 tool과 외부 MCP tool을 더한다.
    const current: readonly ToolDefinition[] = [
      ...selectTools(
        deps.roleTools(session.agent.role),
        { input_media: model.value.inputMedia },
        deps.toolkit.definitions,
      ),
      ...(appTool?.tools ?? []).map((tool) => tool.definition),
      ...external.map((tool) => tool.definition),
    ];
    const seat: TurnSeat = { turn, session: start.session };
    return ok({
      agent,
      current,
      appTool,
      external,
      model: model.value,
      seat,
      mcpKit,
      session,
    });
  }

  type Material = Extract<
    Awaited<ReturnType<typeof material>>,
    { ok: true }
  >["value"];

  // 이 turn의 loop deps와 core port. agent 호출은 credential token을 받은 뒤에 열린다.
  function loopFor(
    m: Material,
    request: TurnStart,
    agentCall: CoreCall,
    inputs: TurnInputs,
    instructions: InstructionTexts,
  ) {
    const { seat, model, agent: resolved, external, session } = m;
    const toolkit = deps.toolkit;
    const externalByName = new Map(
      external.map((tool) => [tool.definition.name, tool]),
    );
    // 이 session의 고정 목록(첫 turn에 만든 것). 정의가 handler를 들지 않은 tool(외부 MCP)은 이 turn의
    // handler를 붙인다.
    const fixed = fixedBySession.get(seat.session)!;
    const legacy = new Map<string, ToolHandler>([
      ...toolkit.handlers(seat, agentCall),
      ...(m.mcpKit === undefined ? [] : createMcpToolHandlers(
        external,
        m.mcpKit.call(seat.session),
      )),
    ]);
    const reach = new Set<string>([
      ...external.map((tool) => tool.target),
      seat.turn,
      seat.session,
    ]);
    const operations = new Set(runOperations(fixed.definitions));
    const listed: ToolDefinition[] = fixed.definitions.map((tool) => {
      const handler = legacy.get(tool.name);
      if (tool.handler !== undefined || handler === undefined) return tool;
      return {
        ...tool,
        handler: (input, ctx) =>
          handler(input, {
            turn: ctx.turn,
            targets: reach,
            operations,
            call: ctx.tool_call,
          }),
      };
    });
    const place = session.place;
    // file tool이 닿는 폴더. place 정보를 읽을 때 채운다(model call 전이라 tool보다 먼저다).
    const scope = {
      read: [] as string[],
      write: [] as string[],
      base: undefined as string | undefined,
      open(folder: string) {
        if (!scope.read.includes(folder)) scope.read.push(folder);
        if (!scope.write.includes(folder)) scope.write.push(folder);
      },
    };
    const ports = {
      ...deps.toolPorts(session, { core: agentCall, skills: resolved.skills }),
      scope,
    };
    const toolSetup: ToolSetup = {
      listed,
      context: (toolCall: Id<"tcl">): ToolContext => ({
        session: seat.session as Id<"ses">,
        turn: seat.turn as Id<"trn">,
        tool_call: toolCall,
        agent: session.agent,
        role: session.agent.role,
        place,
        domains: resolved.domains,
        listed,
        core: agentCall,
        clock,
        ids,
        ...ports,
      }),
      server: (definition) =>
        externalByName.get(definition.name)?.server ?? null,
      extension: (definition) => {
        const found = externalByName.get(definition.name);
        return found === undefined ? null : {
          server_name: found.server,
          configuration_revision: 0,
          original_tool: found.original,
          canonical_name: found.definition.name,
        };
      },
    };
    // prompt 재료는 turn을 시작할 때 한 번만 읽고 call마다 같은 값을 쓴다. 이전 대화는 일하는 turn이 있는
    // session은 Compact하지 않으므로 turn 안에서 바뀌지 않는다. seen은 이 turn이 시작할 때 본 지난 turn의 판이다.
    const seenAtStart = seenBySession.get(seat.session);
    type Built = Omit<TurnContext, "keep"> & { compaction: string | null };
    let built: Promise<Result<Built>> | undefined;
    const build = async (): Promise<Result<Built>> => {
      const role = await deps.rolePrompt(resolved.role);
      if (!role.ok) return role;
      const read = await readSessionConversation(machine, {
        session: seat.session,
        request: request.input.message,
      });
      if (!read.ok) return read;
      const placed = await deps.placeData(agentCall, resolved);
      if (!placed.ok) return placed;
      scope.read.push(...placed.value.scope.read);
      scope.write.push(...placed.value.scope.write);
      scope.base = placed.value.scope.base;
      const compaction = read.value.compaction === null
        ? null
        : String(read.value.compaction.through_seq);
      const notices = m.current.length === 0 ||
          await keyOf(m.current) === fixed.key
        ? []
        : [noticeText(toolsNotice(fixed.definitions, m.current))];
      return ok({
        prompt: {
          role_prompt: role.value,
          // 정본 이름이다. model에는 wire 이름으로 간다.
          tools: fixed.definitions.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema ?? z.toJSONSchema(tool.input),
          })),
          instructions,
          skills: promptSkills(
            (await deps.skills?.(resolved.place)) ?? [],
            resolved,
          ),
          place: placed.value.place,
          ...(seenAtStart !== undefined && seenAtStart.compaction === compaction
            ? { seen: seenAtStart.basis }
            : {}),
          limits: {
            context_limit: model.call.limits.context_limit,
            input_limit: model.call.limits.input_limit,
            output_limit: model.call.limits.output_limit,
          },
          reserved_output: cappedOutput(model.call.limits),
        },
        session: read.value,
        notices,
        compaction,
      });
    };
    const context = async (): Promise<Result<TurnContext>> => {
      built ??= build();
      const loaded = await built;
      if (!loaded.ok) return loaded;
      const { compaction, ...rest } = loaded.value;
      return ok({
        ...rest,
        keep: (basis) => seenBySession.set(seat.session, { basis, compaction }),
      });
    };
    const ports_ = createCorePorts({
      seat,
      clock,
      ids,
      machine,
      blobs: deps.blobs,
      redact: deps.instructions.redact,
      turnInputs: inputs,
      events: deps.events,
      agentHash: resolved.hash,
      model,
      tools: toolSetup,
      context,
    });
    const loopDeps: LoopDeps = {
      clock,
      wait: abortableWait,
      random: Math.random,
      ports: ports_,
    };
    return { loopDeps };
  }

  // 시작하지 못하는 turn을 이유와 함께 닫는다. 시작 기록(StartTurn)을 남기고 바로 failed로 끝내 session이
  // 입력을 계속 받게 한다. 끝내지 못하면 오류이고 입력은 입력함에 남아 다음에 다시 시도한다.
  async function closeUnstarted(
    start: TurnStart,
    why: { reason: CannotStart["reason"]; why: string; detail?: string },
    limits: TurnLimits,
  ): Promise<Result<Preparation>> {
    const turn = ids.newId("trn");
    const basis = await storeValue(
      deps.blobs,
      deps.instructions.redact,
      TURN_BLOB_PURPOSES.turn_basis,
      {
        session: start.session,
        why: why.why,
        ...(why.detail === undefined ? {} : { detail: why.detail }),
      },
    );
    if (!basis.ok) return basis;
    const started = await commandOf(
      machine,
      startTurn,
      {
        id: turn,
        session: start.session,
        input_message: start.input.message,
        basis: basis.value.hash,
        basis_size: basis.value.size,
        limits,
      },
      {},
      `${turn}:start:${why.why}`,
    );
    if (!started.ok) return started;
    const result = await storeValue(
      deps.blobs,
      deps.instructions.redact,
      TURN_BLOB_PURPOSES.turn_result,
      { turn, why: why.why },
    );
    if (!result.ok) return result;
    const finished = await commandOf(
      machine,
      finishTurn,
      {
        turn,
        outcome: { kind: "failed", reason: why.reason },
        result: result.value.hash,
        result_size: result.value.size,
      },
      { state_seq: started.value.state_seq },
      `${turn}:finish:${why.why}`,
    );
    if (!finished.ok) return finished;
    return ok({ kind: "closed", turn, reason: why.reason });
  }

  async function prepare(start: TurnStart): Promise<Result<Preparation>> {
    if (start.input.message === null) {
      return err({
        code: "invalid_input",
        message: "the input has no session message",
      });
    }
    const read = await readOf(machine, agentSessionRead, {
      session: start.session,
    });
    if (!read.ok) return read;
    const session = read.value.session;
    if (session.lifecycle !== "open") {
      return err({ code: "conflict", message: "the session is not open" });
    }

    const settings = await readOf(machine, settingsList, {
      keys: Object.values(TURN_LIMIT_SETTING_KEYS),
    });
    if (!settings.ok) return settings;
    const limits = turnLimitsOf(
      createListSettingsReader(settings.value.settings),
    );
    if (!limits.ok) return limits;

    // 이번 turn의 resolved agent. 층을 합친 값을 turn 기준에 고정한다. model이 어느 층에도 없거나 정의가
    // 틀렸으면 필수 선택이 비었다는 뜻이라 이 turn만 시작하지 않는다.
    const skills = (await deps.skills?.(session.place)) ?? [];
    let mcp: LoadedMcp | undefined;
    const made = await resolveTurnAgent(machine, {
      session: start.session,
      roleTools: deps.roleTools,
      roles: deps.roles,
      skills: skills.filter((entry) => entry.enabled),
      mcp: async (off, place, ownServers) => {
        mcp = await loadMcp(start.session, {
          place,
          skip: off,
          agent: { servers: ownServers ?? [], off: [...off] },
        });
        return (mcp.source?.tools ?? []).map((tool) => ({
          server_name: tool.server,
          original_tool: tool.original,
        }));
      },
    });
    if (!made.ok) return made;
    if (made.value.kind === "cannot_start") {
      return await closeUnstarted(start, made.value, limits.value);
    }
    const agent = made.value.agent;

    // 사람 지침은 turn을 시작할 때 한 번 읽고 turn 끝까지 쓴다. 한 층이라도 읽지 못했으면 turn을 시작하지 않는다.
    const instructions = await readTurnInstructions(
      {
        ...deps.instructions,
        files: deps.instructionFilesFor?.(start.session) ??
          deps.instructions.files,
      },
      { role: session.agent.role },
      await readTurnDomains(machine, agent),
    );
    if (instructions.status === "blocked") {
      return await closeUnstarted(
        start,
        {
          reason: "configuration_unavailable",
          why: "instructions_blocked",
          detail: instructions.message,
        },
        limits.value,
      );
    }
    const texts = instructionTexts(instructions.layers);

    const turn = ids.newId("trn");
    const found = await material(
      start,
      session,
      agent,
      mcp ?? await loadMcp(start.session, { place: agent.place }),
      turn,
    );
    if (!found.ok) {
      // model을 쓸 수 없으면 그 turn만 시작하지 않는다. 다른 일은 그대로다.
      return found.error.code === "unavailable" ||
          found.error.code === "not_found" ||
          found.error.code === "invalid_input"
        ? await closeUnstarted(
          start,
          { reason: "configuration_unavailable", why: "model_required" },
          limits.value,
        )
        : found;
    }
    const m = found.value;

    // session의 첫 turn이 tool 목록을 고정한다.
    if (!fixedBySession.has(start.session)) {
      fixedBySession.set(start.session, {
        definitions: m.current,
        key: await keyOf(m.current),
      });
    }
    const fixed = fixedBySession.get(start.session)!;

    // 전체 값은 blob이고 turn 기준에는 hash와 칸별 출처만 둔다. 기준과 agent blob은 둘 다 영구 참조라
    // 저장한 바이트의 hash로 StartTurn에 싣는다.
    const stored = await storeValue(
      deps.blobs,
      deps.instructions.redact,
      TURN_BLOB_PURPOSES.turn_resolved,
      agent,
    );
    if (!stored.ok) return stored;
    const basis = await storeValue(
      deps.blobs,
      deps.instructions.redact,
      TURN_BLOB_PURPOSES.turn_basis,
      {
        agent: session.agent,
        resolved: { hash: agent.hash, sources: agent.sources },
        instructions: instructions.layers.map((layer) => ({
          layer: layer.layer,
          hash: layer.hash,
        })),
        tools: {
          revision: "1",
          definitions_hash: await fingerprint(
            await hashesOf(fixed.definitions),
          ),
        },
        models: { judgment: m.model.call, organizing: m.model.call },
        place: session.place,
        limits: limits.value,
      },
    );
    if (!basis.ok) return basis;

    const begin: BeginTurnInput = {
      turn,
      session: start.session,
      role: session.agent.role,
      inputMessage: start.input.message,
      basis: basis.value.hash,
      basisSize: basis.value.size,
      resolved: stored.value.hash,
      resolvedSize: stored.value.size,
      limits: limits.value,
    };
    return ok({
      kind: "ready",
      turn: {
        turn,
        session: start.session,
        begin,
        async startTurn(input) {
          const started = await commandOf(
            machine,
            startTurn,
            {
              id: input.turn,
              session: input.session,
              input_message: input.inputMessage,
              basis: input.basis,
              ...(input.basisSize === undefined
                ? {}
                : { basis_size: input.basisSize }),
              ...(input.resolved === undefined ||
                  input.resolvedSize === undefined
                ? {}
                : {
                  resolved: input.resolved,
                  resolved_size: input.resolvedSize,
                }),
              limits: input.limits,
            },
            {},
            `${input.turn}:start`,
          );
          return started.ok
            ? ok({
              turn: started.value.id,
              state_seq: started.value.state_seq,
              basis: started.value.basis,
            })
            : started;
        },
        async closeStarted() {
          const current = await readOf(machine, turnRead, { turn });
          if (!current.ok || current.value.turn.state !== "running") return;
          const result = await storeValue(
            deps.blobs,
            deps.instructions.redact,
            TURN_BLOB_PURPOSES.turn_result,
            { turn, why: "credential" },
          );
          if (!result.ok) return;
          await commandOf(
            machine,
            finishTurn,
            {
              turn,
              outcome: { kind: "failed", reason: "configuration_unavailable" },
              result: result.value.hash,
              result_size: result.value.size,
            },
            { state_seq: current.value.turn.state_seq },
            `${turn}:finish:credential`,
          );
        },
        loop(credential, inputs) {
          const built = loopFor(
            m,
            start,
            deps.agentCall(credential.token),
            inputs,
            texts,
          );
          return {
            provider: m.model.call.provider,
            deps: built.loopDeps,
            input: {
              turn,
              session: start.session,
              limits: limits.value,
              elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
              attempts: 0,
            },
          };
        },
      },
    });
  }

  return {
    prepare,
    forget(session) {
      fixedBySession.delete(session);
      seenBySession.delete(session);
    },
  };
}
