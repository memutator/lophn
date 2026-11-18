import { z } from "zod";
import {
  type Clock,
  canonicalize,
  err,
  fingerprint,
  type IdSource,
  ok,
  type Result,
} from "../../../base/mod.ts";
import type { Tracer } from "../../../base/telemetry/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { settingsList } from "../../../protocol/config/mod.ts";
import { extensionToolsCatalog } from "../../../protocol/lophn-agent/extension-tools.ts";
import {
  type AgentId,
  type AgentWorkspace,
  agentRead,
  finishTurn,
  isHarnessRuntime,
  type McpServer,
  type ModelChoice,
  type WorkspaceKind,
  type WorkspaceSession,
  workspaceKindOf,
  workspaceSessionRead,
  startTurn,
  textBlocks,
  toolCallList,
  TURN_BLOB_PURPOSES,
  type TurnLimits,
  type TurnMode,
  turnList,
  turnRead,
} from "../../../protocol/lophn-agent/mod.ts";
import { createListSettingsReader } from "../../config/mod.ts";
import { type CannotStart, resolveTurnAgent } from "../agents/layers.ts";
import type { ResolvedAgent } from "../agents/mod.ts";
import type { SkillEntry } from "../extensions/mod.ts";
import {
  buildMcpTools,
  createMcpToolHandlers,
  type ExternalTool,
  type McpSelection,
  type McpToolCall,
  type McpToolsSource,
} from "../extensions/mod.ts";
import {
  type InstructionDeps,
  readTurnInstructions,
  type TurnInstructionLayer,
} from "../instructions/mod.ts";
import { cappedOutput, type ModelBinding } from "../models/binding.ts";
import {
  type HistoryMessage,
  noInstructions,
  type SeenBasis,
  type TurnPromptInput,
} from "../prompt-assembly/mod.ts";
import { readSessionConversation } from "../session/history.ts";
import {
  appCommandEntries,
  appCommandTool,
} from "../tools/app-tool/command.ts";
import type { AppToolkit } from "../tools/app-toolkit.ts";
import { dispatchTarget } from "../tools/dispatch.ts";
import { buildExtensionTools } from "../tools/extension-tools.ts";
import { commandTools } from "../tools/lophn/command-tool.ts";
import { resolveAppCall } from "../tools/lophn/resolve.ts";
import {
  type AppCommandLookup,
  describeLophn,
  LOPHN_TOOL_NAME,
  withApps,
} from "../tools/lophn/tool.ts";
import {
  definitionHash,
  runOperations,
  selectTools,
  type ToolContext,
  type ToolDefinition,
  type ToolHandler,
} from "../tools/mod.ts";
import { type BlobPort, type RedactText, storeValue } from "./blobs.ts";
import { type CoreCall, commandOf, readOf } from "./core-call.ts";
import {
  createCorePorts,
  type ToolSetup,
  type TurnSeat,
} from "./core-ports.ts";
import type {
  AgentTurnCredential,
  BeginTurnInput,
  StartTurnResult,
} from "./credentials.ts";
import { createImageReader, inputParts, partsText } from "./input-text.ts";
import { TURN_LIMIT_SETTING_KEYS, turnLimitsOf } from "./limits.ts";
import type {
  AgentEventSink,
  LoopDeps,
  TurnContext,
  TurnInput,
  TurnInputs,
  TurnPorts,
} from "./ports.ts";
import { abortableWait } from "./retry.ts";
import { turnModeOf } from "./turn-mode.ts";
import type { TurnStart } from "./work.ts";

// 시작할 turn의 재료를 core 기록에서 모은다. session의 agent id와 workspace, 이번 turn의 resolved agent
// (층을 합친 값), tool 목록, 적용 한도, 고정할 turn 근거(basis)를 만든다. tool 목록은 turn마다 새로 만들지
// 않고 session의 첫 turn에서 만든 것을 쓴다(model에 보이는 `tools[]`가 session 동안 같다). 도중에 달라지면
// 목록은 그대로 두고 대화 끝에 notice를 붙인다. model 선택의 검증(catalog·credential)은 주입한다.

// 이 turn의 외부 MCP tool 등록이다. 등록 화면은 현재 서버 설정과 연결 화면을 읽어 buildMcpTools로 정의를
// 만들고, 재조회가 끝날 때까지 그 server tool 호출을 막는다.
// 어느 서버를 연결하나. workspace는 그 agent가 여는 자리다(전역 서버에 그 자리 층의 서버를 더한다).
// skip은 agent 정의가 통째로 끈 서버이고 연결하지 않는다. agent는 그 agent 정의 층이다: 정의가 가진 서버와, 아래
// 층(전역, project)에서 끈 서버 이름이다.
export type McpSourceOptions = {
  workspace?: AgentWorkspace | null;
  skip?: ReadonlySet<string>;
  only?: ReadonlySet<string>;
  agent?: {
    id: AgentId;
    servers: readonly McpServer[];
    off: readonly string[];
  };
};

export type McpToolkit = {
  // 등록된 서버 설정과 검증을 지난 tool 목록을 읽는다. 설정은 사람의 registry 출처다.
  source(
    session: string,
    options?: McpSourceOptions,
  ): Promise<Result<McpToolsSource>>;
  // 고른 MCP(서버+현재 tool 정확한 쌍)를 골라낸다.
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

// ToolContext에서 이 turn이 정하지 않는 칸들이다. 사람의 결정을 기다리는 Gate, 질문, 폴더 범위,
// skill 읽기는 조립이 session마다 끼운다.
export type ToolPorts = Pick<
  ToolContext,
  "gate" | "questions" | "scope" | "skills" | "fetch" | "spill"
>;

type PreparerDeps = {
  clock: Clock;
  // 날짜 notice의 IANA time zone. host의 time zone이다.
  timeZone: string;
  ids: IdSource;
  // model call·tool call span을 낸다. 없으면 span 없이 돈다.
  tracer?: Tracer;
  // machine 자격의 loopback.
  machine: CoreCall;
  // turn의 agent credential token으로 부르는 loopback.
  agentCall(token: string): CoreCall;
  // resolved agent의 model 선택을 검증해 model 묶음으로 만든다(catalog·계정·adapter).
  resolveModel(input: {
    model: ModelChoice;
    purpose?: "judgment" | "organizing";
  }): Promise<Result<ModelBinding>>;
  toolkit: Toolkit;
  // ToolContext의 바깥 연결. 끼우지 않으면 tool 호출은 닫힌 채 실패한다.
  // `core`는 이 turn의 agent 자격 loopback이고 `skills`는 resolved agent가 켠 skill 이름, `apps`는 그 agent에게 할당한 앱 slug다.
  toolPorts(
    session: WorkspaceSession,
    turn: {
      core: CoreCall;
      skills: readonly string[];
      apps: readonly string[];
    },
  ): ToolPorts;
  // agent event를 Bus로 보내는 길(감독 pipe).
  events: AgentEventSink;
  // 제품 고정 규칙을 포함한 workspace 종류 지침 글.
  workspacePrompt(kind: WorkspaceKind): Promise<Result<string>>;
  // prompt의 workspace 정보와 file tool이 닿는 폴더를 turn의 agent 자격 읽기로 모은다. workspace 종류 규칙은 workspace 층이 쥔다.
  workspaceData(
    call: CoreCall,
    resolved: ResolvedAgent,
    session: string,
  ): Promise<
    Result<{
      workspace: TurnPromptInput["workspace"];
      scope: {
        read: string[];
        write: string[];
        base?: string;
        results?: string;
      };
    }>
  >;
  // workspace 종류가 고정한 tool 이름 목록. 어느 종류가 어느 tool을 보는지는 workspace 층이 정한다.
  workspaceTools(kind: WorkspaceKind): readonly string[];
  instructions: InstructionDeps;
  // session 첫 turn에 prompt로 싣는 memory 글을 읽는다(global memory, workspace memory, agent memory). 없으면 memory block이 없다.
  memory?(
    agent: AgentId,
    workspace: AgentWorkspace | null,
  ): Promise<NonNullable<TurnPromptInput["memory"]>>;
  // session마다 그 session으로 지침 파일을 읽는 통로. 있으면 `instructions.files` 대신 쓴다(core가 session의
  // workspace로 어느 project인지 정한다).
  instructionFilesFor?(session: Id<"ses">): InstructionDeps["files"];
  // turn 근거·결과와 model·tool 기록의 본문을 blob으로 먼저 저장하는 통로.
  blobs: BlobPort;
  // 그 agent가 여는 자리에서 발견하는 skill이다: 전역 층에 그 자리 층을 더한다. 내장 skill은 그 workspace 종류에 선언된 것만이다.
  // `apps`는 그 agent 정의에 할당된 앱 slug이고, 그 앱들의 public skill이 공유 층으로 더해진다.
  skills?(
    workspace: AgentWorkspace | null,
    kind: WorkspaceKind,
    apps: readonly string[],
  ): Promise<readonly SkillEntry[]>;
  timezone?(): string | null;
  redact?: RedactText;
  // 도는 turn이 자기 session을 Compact한다(turn 안 Compact). 없으면 turn은 Compact하지 않고 오래된 tool 결과만 줄인다.
  compact?(input: {
    session: string;
    turn: string;
    history: readonly HistoryMessage[];
    signal: AbortSignal;
  }): ReturnType<NonNullable<TurnPorts["compact"]>>;
};

type PreparedTurn = {
  turn: string;
  session: string;
  begin: BeginTurnInput;
  startTurn(input: BeginTurnInput): Promise<Result<StartTurnResult>>;
  // StartTurn은 확정됐지만 loop를 이어 가지 못할 때(credential을 못 받음, 입력이 없어짐, loop가 던짐, 끝내는 기록이
  // 실패함) turn을 failed로 닫는다. loop_threw와 finish_failed는 internal, 나머지는 configuration_unavailable이다.
  // 이미 끝났으면 아무것도 하지 않는다. why는 result blob에 남는다.
  closeStarted(
    why: "credential" | "input_gone" | "loop_threw" | "finish_failed",
  ): Promise<void>;
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

type MemoryTexts = NonNullable<TurnPromptInput["memory"]>;

// memory 글을 session 첫 turn에 읽어 고정한다. 그 뒤 turn은 같은 글(같은 bytes)을 싣고, session 중에 쓴 memory는 다음
// session부터 보인다(prefix cache). daemon이 다시 뜨면 map이 비어 다시 읽고, Compact로 compaction 경계가 바뀌어도 다시 읽는다:
// 지금 고정값(tool 목록, seen)이 사라지는 때와 같다.
export function createFixedMemory() {
  const bySession = new Map<
    string,
    { compaction: string | null; texts: MemoryTexts }
  >();
  return {
    async get(
      session: string,
      compaction: string | null,
      read: () => Promise<MemoryTexts>,
    ): Promise<MemoryTexts> {
      const held = bySession.get(session);
      if (held !== undefined && held.compaction === compaction) {
        return held.texts;
      }
      const texts = await read();
      bySession.set(session, { compaction, texts });
      return texts;
    },
    forget(session: string) {
      bySession.delete(session);
    },
  };
}

// 지난 turn이 본 prompt의 판이다. compaction 경계(through_seq)를 같이 두어 Compact 뒤 첫 turn은 seen 없이 부른다.
type Seen = { basis: SeenBasis; compaction: string | null };

async function hashesOf(
  definitions: readonly ToolDefinition[],
): Promise<string[][]> {
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

// model에 보이는 tool 목록(session의 고정 목록이 될 재료)이다. lophn은 workspace 종류 목록 전부이고, custom은 `lophn` tool(그 종류의
// 명령 전부와 할당한 앱 command. lophn과 같다)과 목록 중 고른 내장 tool이다. 상한은 그대로다: 목록 밖 이름을 골라도 보이지 않는다.
// MCP와 extension tool은 resolve와 호출한 쪽이 이미 고른 것만 `external`에 넘긴다.
export function visibleTools(input: {
  kind: WorkspaceKind;
  agent: Pick<ResolvedAgent, "runtime" | "picks">;
  names: readonly string[];
  definitions: readonly ToolDefinition[];
  inputMedia: readonly string[];
  external: readonly ToolDefinition[];
}): ToolDefinition[] {
  const names =
    input.agent.runtime === "custom"
      ? input.names.filter(
          (name) =>
            name === LOPHN_TOOL_NAME || input.agent.picks.includes(name),
        )
      : input.names;
  return [
    ...selectTools(names, { input_media: input.inputMedia }, input.definitions),
    ...input.external,
  ].map((tool) =>
    tool.name === LOPHN_TOOL_NAME ? describeLophn(tool, input.kind) : tool,
  );
}

// session이 실행하는 tool의 정의(handler 붙이기 전)다. 고정 목록에 그 workspace 종류의 명령 정의를 더한다(custom도 같다). custom은
// 고정 목록 중 지금도 고른 것(`current`)만이라 고르지 않은 tool은 실행기가 "not available"로 거절한다.
export function runnableTools(input: {
  fixed: readonly ToolDefinition[];
  kind: WorkspaceKind;
  current: ReadonlySet<string> | null;
}): ToolDefinition[] {
  const { fixed, kind, current } = input;
  return [
    ...(current === null
      ? fixed
      : fixed.filter((tool) => current.has(tool.name))),
    ...commandTools(kind),
  ];
}

// 고정한 목록과 지금 목록이 다를 때 대화 끝에 붙는 notice 본문이다. 이 session은 고정한 목록만 실행하므로 더한 tool은 새 session부터다. 빠진 tool은 Gate가 call 때 지금 할당을 읽어 바로 막으므로 지금부터 못 쓴다.
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
    lines.push(`No longer available: ${removed.join(", ")}.`);
  }
  lines.push(
    "This session keeps the tool list above; added tools can be called from a new session.",
  );
  return lines.join("\n");
}

// 재시작으로 끊긴 turn의 batch는 이력에 없어 다음 turn은 그 call이 돌았는지 모른다. 바로 앞 turn이 restarted로 끝났으면
// 그 turn이 결과를 확정하지 못한 tool call(core가 uncertain으로 닫았다)을 알린다. 읽지 못하면 알리지 않고 turn을
// 시작한다. 글은 고정 문구와 tool 이름·id뿐이다.
// restarted는 이 process(agent runtime child)가 사라졌을 때만 생긴다(core가 켜질 때, child가 죽었을 때). 그래서 이
// process에서 session의 첫 turn만 보고, 마지막에 시작한 끝난 turn 하나만 읽는다. 그 뒤의 앞 turn은 이 process가 돌린 것이라
// restarted일 수 없다.
const NOTICE_MAX_PAGES = 400;

async function cutOffNotice(
  machine: CoreCall,
  session: string,
): Promise<string[]> {
  const listed = await readOf(machine, turnList, {
    session,
    state: "finished",
    order: "newest",
    limit: 1,
  });
  if (!listed.ok) return [];
  const previous = listed.value.turns[0];
  if (
    previous === undefined ||
    previous.outcome?.kind !== "interrupted" ||
    previous.outcome.reason !== "restarted"
  ) {
    return [];
  }
  const uncertain: string[] = [];
  let callCursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= NOTICE_MAX_PAGES) return [];
    const listed = await readOf(machine, toolCallList, {
      turn: previous.id,
      ...(callCursor === undefined ? {} : { cursor: callCursor }),
    });
    if (!listed.ok) return [];
    for (const call of listed.value.tool_calls) {
      if (call.outcome?.kind === "uncertain") {
        uncertain.push(`${call.tool} (${call.id})`);
      }
    }
    const next = listed.value.next_cursor;
    if (next === null || next === undefined) break;
    callCursor = next;
  }
  return uncertain.length === 0
    ? []
    : [
        `[machine] The previous turn was cut off before it finished. These tool calls may or may not have taken effect: ${uncertain.join(", ")}. Check their results before repeating them.`,
      ];
}

function noticeText(body: string): string {
  return partsText(
    inputParts({
      kind: "notice",
      from: { kind: "program" },
      call: null,
      reply_to: null,
      body: textBlocks(body),
      refs: [],
      delivery: "next_turn",
      message: null,
      reply: null,
      outcome: null,
      event: null,
      notice: "tools_changed",
      step: null,
    }),
  );
}

// prompt에 싣는 skill 목록이다. agent가 받는 이름만 켜진다(custom은 고른 이름만).
export function promptSkills(
  entries: readonly SkillEntry[],
  resolved: Pick<ResolvedAgent, "skills">,
) {
  return entries.map((entry) => ({
    name: entry.name,
    description: entry.description,
    enabled: entry.enabled && resolved.skills.includes(entry.name),
  }));
}

// 없는 층은 빈 글이다.
function instructionTexts(
  layers: readonly TurnInstructionLayer[],
): TurnPromptInput["instructions"] {
  const files: Partial<Record<TurnInstructionLayer["layer"], string>> = {};
  const texts = { ...noInstructions(), files };
  for (const layer of layers) {
    texts[layer.layer] = layer.text ?? "";
    if (layer.file !== null) files[layer.layer] = layer.file;
  }
  return texts;
}

export function createTurnPreparer(deps: PreparerDeps): TurnPreparer {
  const { machine, clock, ids } = deps;
  const fixedBySession = new Map<string, FixedTools>();
  const seenBySession = new Map<string, Seen>();
  // 끊긴 turn 알림을 이미 본 session(cutOffNotice).
  const cutOffChecked = new Set<string>();
  const fixedMemory = createFixedMemory();

  // 등록된 외부 MCP tool이다. 읽지 못하면 서버 자체가 없는 것과 같은 답이다(fails closed).
  async function loadMcp(session: string, options: McpSourceOptions = {}) {
    const kit = deps.toolkit.mcp?.(session);
    if (kit === undefined) return { kit, source: null };
    const source = await kit.source(session, options);
    return { kit, source: source.ok ? source.value : null };
  }
  type LoadedMcp = Awaited<ReturnType<typeof loadMcp>>;

  // session과 이번 turn의 resolved agent로 tool·model을 모은다.
  async function material(
    start: TurnStart,
    session: WorkspaceSession,
    agent: ResolvedAgent,
    mcp: LoadedMcp,
    turn: string,
    apps: readonly string[],
    extensions: readonly string[],
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
      });
      // 켠 MCP가 없으면 제공도 없다.
      if (selection !== null) {
        const built = await buildMcpTools(mcp.source, selection);
        // 남은 충돌은 등록을 거절한다. 그 server의 정의가 전부 빠진다.
        if (built.ok) external = built.value;
      }
    }

    // shell extension tool이다. 정의 `extensions`로 할당한 extension의 tool 전부이고, custom은 그 가운데 `tools`가 고른 것만이다.
    // catalog는 켜진 extension만이고 shell이 아직 올리지 않았으면 비어 있다(그 session은 tool 없이 시작하고 올린 뒤 notice로 받는다).
    const published = await readOf(machine, extensionToolsCatalog, {});
    const extensionTools = buildExtensionTools(
      published.ok ? published.value.extensions : [],
      extensions,
    ).filter(
      (tool) => agent.runtime !== "custom" || agent.picks.includes(tool.name),
    );

    const model = await deps.resolveModel({ model: agent.model });
    if (!model.ok) return model;

    const kind = workspaceKindOf(session.workspace);

    // workspace 종류가 고정한 목록에 이 turn이 닿는 tool과 외부 MCP tool을 더한다. 앱 command는 목록에 없다:
    // `lophn <앱 slug> <command>`를 부를 때 푼다.
    const current = visibleTools({
      kind,
      agent,
      names: deps.workspaceTools(kind),
      definitions: deps.toolkit.definitions,
      inputMedia: model.value.inputMedia,
      external: [...external.map((tool) => tool.definition), ...extensionTools],
    });
    const seat: TurnSeat = { turn, session: start.session };
    return ok({
      agent,
      current,
      external,
      model: model.value,
      seat,
      mcpKit,
      session,
      apps,
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
    instructions: TurnPromptInput["instructions"],
    mode: TurnMode,
  ) {
    const {
      seat,
      model,
      agent: resolved,
      external,
      session,
      apps: assigned,
    } = m;
    const toolkit = deps.toolkit;
    const externalByName = new Map(
      external.map((tool) => [tool.definition.name, tool]),
    );
    // 이 session의 고정 목록(첫 turn에 만든 것). 정의가 handler를 들지 않은 tool(외부 MCP)은 이 turn의
    // handler를 붙인다.
    const fixed = fixedBySession.get(seat.session)!;
    const legacy = new Map<string, ToolHandler>([
      ...toolkit.handlers(seat, agentCall),
      ...(m.mcpKit === undefined
        ? []
        : createMcpToolHandlers(external, m.mcpKit.call(seat.session))),
    ]);
    const reach = new Set<string>([
      ...external.map((tool) => tool.target),
      seat.turn,
      seat.session,
    ]);
    const operations = new Set(runOperations(fixed.definitions));
    // custom이 부를 수 있는 내장·외부 tool: 이 session의 고정 목록 ∩ 지금 정의가 고른 것. 정의를 고쳐 늘린 이름은 새 session부터다.
    const current = resolved.runtime === "custom" ? names(m.current) : null;
    // 지금 부를 수 있는 앱 command. 부를 때마다 읽는다: session을 시작할 때 고정하지 않고 바뀌어도 notice를 내지 않는다.
    const who = { agent: session.agent, workspace: session.workspace };
    const apps: AppCommandLookup = async () => {
      const loaded = await toolkit.appTool?.load(who);
      return loaded?.ok ? appCommandEntries(loaded.value) : [];
    };
    // `lophn` tool이 명령으로 풀리는 호출을 실행할 정의도 여기 든다. model에 보이는 tools[]에는 없고 이 session의 workspace 종류가
    // 부를 수 있는 명령만 있으므로, 목록 밖 명령은 지금 목록 밖 tool과 같이 거절된다.
    const base: ToolDefinition[] = runnableTools({
      fixed: fixed.definitions,
      kind: workspaceKindOf(session.workspace),
      current,
    }).map((tool) => {
      const handler = legacy.get(tool.name);
      if (tool.name === LOPHN_TOOL_NAME) return withApps(tool, apps);
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
    // 앱 command의 정의는 불린 것만 더한다. tool 표가 목록마다 한 번 만들어지므로 더할 때 목록을 새로 만든다.
    // 같은 command는 같은 정의를 쓴다(loop가 정의의 동일성으로 진입 기록을 붙인다).
    const called = new Map<
      string,
      { key: string; definition: ToolDefinition }
    >();
    let listed: readonly ToolDefinition[] = base;
    const dispatch = async (name: string, input: unknown) => {
      const target = dispatchTarget(name, input);
      if (target.name !== LOPHN_TOOL_NAME) return target;
      const hit = resolveAppCall(input, await apps());
      if (hit === undefined) return target;
      const definition = appCommandTool(hit.entry);
      const key = JSON.stringify([hit.entry.app, hit.entry.command]);
      if (called.get(definition.name)?.key !== key) {
        called.set(definition.name, { key, definition });
        listed = [
          ...base,
          ...[...called.values()].map((one) => one.definition),
        ];
      }
      return { name: hit.name, input: hit.input };
    };
    const workspace = session.workspace;
    const images = createImageReader(agentCall, seat.session);
    // file tool이 닿는 폴더. workspace 정보를 읽을 때 채운다(model call 전이라 tool보다 먼저다).
    const scope = {
      read: [] as string[],
      write: [] as string[],
      base: undefined as string | undefined,
      results: undefined as string | undefined,
      open(folder: string) {
        if (!scope.read.includes(folder)) scope.read.push(folder);
        if (!scope.write.includes(folder)) scope.write.push(folder);
      },
    };
    const ports = {
      ...deps.toolPorts(session, {
        core: agentCall,
        skills: resolved.skills,
        apps: assigned,
      }),
      scope,
    };
    const toolSetup: ToolSetup = {
      get listed() {
        return listed;
      },
      dispatch,
      context: (toolCall: Id<"tcl">): ToolContext => ({
        session: seat.session as Id<"ses">,
        turn: seat.turn as Id<"trn">,
        tool_call: toolCall,
        agent: session.agent,
        kind: workspaceKindOf(session.workspace),
        mode,
        workspace,
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
        return found === undefined
          ? null
          : {
              server_name: found.server,
              configuration_revision: 0,
              original_tool: found.original,
              canonical_name: found.definition.name,
            };
      },
    };
    // prompt 재료는 turn을 시작할 때 한 번만 읽고 call마다 같은 값을 쓴다. 이전 대화는 이 turn이 turn 안 Compact를 한
    // 때만 바뀌고 그때 다시 읽는다. seen은 이 turn이 시작할 때 본 지난 turn의 판이다.
    const seenAtStart = seenBySession.get(seat.session);
    type Built = Omit<TurnContext, "keep"> & { compaction: string | null };
    const compactionOf = (read: TurnContext["session"]) =>
      read.compaction === null ? null : String(read.compaction.through_seq);
    const readConversation = () =>
      readSessionConversation(machine, {
        session: seat.session,
        request: request.input.message,
        images,
        runtime: resolved.runtime,
      });
    // custom은 global·workspace memory를 받지 않는다(지침 층을 받지 않는 것과 같다). 자기 agent memory는 받는다.
    const memoryOf = async (compaction: string | null) => {
      const texts = await fixedMemory.get(
        seat.session,
        compaction,
        () =>
          deps.memory?.(session.agent, session.workspace) ??
          Promise.resolve({ global: "", workspace: "", agent: "" }),
      );
      return resolved.runtime === "custom"
        ? { ...texts, global: "", workspace: "" }
        : texts;
    };
    let built: Promise<Result<Built>> | undefined;
    const build = async (): Promise<Result<Built>> => {
      // custom은 workspace 종류 지침(제품 고정 규칙)을 싣지 않는다.
      const prompt =
        resolved.runtime === "custom"
          ? ok("")
          : await deps.workspacePrompt(workspaceKindOf(resolved.workspace));
      if (!prompt.ok) return prompt;
      const read = await readConversation();
      if (!read.ok) return read;
      const placed = await deps.workspaceData(
        agentCall,
        resolved,
        seat.session,
      );
      if (!placed.ok) return placed;
      scope.read.push(...placed.value.scope.read);
      scope.write.push(...placed.value.scope.write);
      scope.base = placed.value.scope.base;
      scope.results = placed.value.scope.results;
      const compaction = compactionOf(read.value);
      const memory = await memoryOf(compaction);
      const notices = [
        ...(m.current.length === 0 || (await keyOf(m.current)) === fixed.key
          ? []
          : [noticeText(toolsNotice(fixed.definitions, m.current))]),
        ...(cutOffChecked.has(seat.session)
          ? []
          : await cutOffNotice(machine, seat.session)),
      ];
      cutOffChecked.add(seat.session);
      return ok({
        prompt: {
          workspace_kind_prompt: prompt.value,
          // 정본 이름이다. model에는 wire 이름으로 간다.
          tools: fixed.definitions.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema ?? z.toJSONSchema(tool.input),
          })),
          instructions,
          memory,
          skills: promptSkills(
            (await deps.skills?.(
              resolved.workspace,
              workspaceKindOf(resolved.workspace),
              assigned,
            )) ?? [],
            resolved,
          ),
          ...(resolved.runtime === "custom"
            ? {
                custom: { system: instructions.agent },
              }
            : {}),
          workspace: placed.value.workspace,
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
      ...(deps.tracer === undefined ? {} : { tracer: deps.tracer }),
      machine,
      images,
      blobs: deps.blobs,
      redact: deps.instructions.redact,
      turnInputs: inputs,
      events: deps.events,
      wait: abortableWait,
      agentHash: resolved.hash,
      runtime: resolved.runtime,
      model,
      tools: toolSetup,
      context,
    });
    // turn 안 Compact 뒤에는 요약이 덮은 끝 뒤의 대화를 다시 읽는다. 이전 turn이 본 판(seen)은 요약이 대신한 대화의
    // 것이라 쓰지 않는다. 다시 읽지 못하면 이 turn은 Compact하지 않은 것으로 이어 간다.
    const compactInTurn = deps.compact;
    const turnPorts: TurnPorts =
      compactInTurn === undefined
        ? ports_
        : {
            ...ports_,
            async compact(history, signal) {
              const outcome = await compactInTurn({
                session: seat.session,
                turn: seat.turn,
                history,
                signal,
              });
              if (outcome !== "compacted") return outcome;
              const loaded = await built;
              const reread = await readConversation();
              if (loaded === undefined || !loaded.ok || !reread.ok) {
                return "failed";
              }
              const prompt = { ...loaded.value.prompt };
              delete prompt.seen;
              prompt.memory = await memoryOf(compactionOf(reread.value));
              built = Promise.resolve(
                ok({
                  ...loaded.value,
                  prompt,
                  session: reread.value,
                  compaction: compactionOf(reread.value),
                }),
              );
              return outcome;
            },
          };
    const loopDeps: LoopDeps = {
      clock,
      timeZone: deps.timeZone,
      wait: abortableWait,
      random: Math.random,
      ports: turnPorts,
    };
    return { loopDeps };
  }

  // 시작하지 못하는 turn을 이유와 함께 닫는다. 시작 기록(StartTurn)을 남기고 바로 failed로 끝내 session이
  // 입력을 계속 받게 한다. 끝내지 못하면 오류이고 입력은 queue에 남아 다음에 다시 시도한다.
  async function closeUnstarted(
    start: TurnStart,
    why: { reason: CannotStart["reason"]; why: string; detail?: string },
    limits: TurnLimits,
    mode: TurnMode,
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
        mode,
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
    const read = await readOf(machine, workspaceSessionRead, {
      session: start.session,
    });
    if (!read.ok) return read;
    const session = read.value.session;
    const kind = workspaceKindOf(session.workspace);
    const mode = turnModeOf(session, start.input);
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
    // 정의를 못 읽으면 할당이 없는 것이다. 정의 오류는 아래 resolveTurnAgent가 turn을 시작하지 않는 쪽으로 알린다.
    const defined = await readOf(machine, agentRead, { agent: session.agent });
    const apps = defined.ok ? (defined.value.definition?.apps ?? []) : [];
    const extensions = defined.ok
      ? (defined.value.definition?.extensions ?? [])
      : [];
    const skills = (await deps.skills?.(session.workspace, kind, apps)) ?? [];
    let mcp: LoadedMcp | undefined;
    const made = await resolveTurnAgent(machine, {
      session: start.session,
      workspaceTools: deps.workspaceTools,
      skills: skills.filter((entry) => entry.enabled),
      mcp: async (off, workspace, ownServers) => {
        mcp = await loadMcp(start.session, {
          workspace,
          skip: off,
          agent: {
            id: session.agent,
            servers: ownServers ?? [],
            off: [...off],
          },
        });
        return (mcp.source?.tools ?? []).map((tool) => ({
          server_name: tool.server,
          original_tool: tool.original,
        }));
      },
    });
    if (!made.ok) return made;
    if (made.value.kind === "cannot_start") {
      return await closeUnstarted(start, made.value, limits.value, mode);
    }
    const agent = made.value.agent;
    // harness runtime의 session은 core 안 extension host의 `harness` extension이 돌린다. 이 입력이 run-loop에 닿았으면 turn을 시작하지 않고 닫는다.
    if (isHarnessRuntime(agent.runtime)) {
      return await closeUnstarted(
        start,
        { reason: "target_unavailable", why: "harness_runtime" },
        limits.value,
        mode,
      );
    }

    // 사람 지침은 turn을 시작할 때 한 번 읽고 turn 끝까지 쓴다. 한 층이라도 읽지 못했으면 turn을 시작하지 않는다.
    // custom은 agent 층 밖의 지침을 싣지 않으므로 읽지도 않는다(그 파일이 깨져도 turn은 시작한다). agent 층이 정의 본문이다.
    const files =
      deps.instructionFilesFor?.(start.session) ?? deps.instructions.files;
    const instructions = await readTurnInstructions({
      ...deps.instructions,
      files:
        agent.runtime === "custom"
          ? {
              read: (layer) =>
                layer === "agent"
                  ? files.read(layer)
                  : Promise.resolve(ok(null)),
            }
          : files,
    });
    if (instructions.status === "blocked") {
      return await closeUnstarted(
        start,
        {
          reason: "configuration_unavailable",
          why: "instructions_blocked",
          detail: instructions.message,
        },
        limits.value,
        mode,
      );
    }
    const texts = instructionTexts(instructions.layers);

    const turn = ids.newId("trn");
    const found = await material(
      start,
      session,
      agent,
      mcp ?? (await loadMcp(start.session, { workspace: agent.workspace })),
      turn,
      apps,
      extensions,
    );
    if (!found.ok) {
      // model을 쓸 수 없으면 그 turn만 시작하지 않는다. 다른 일은 그대로다.
      return found.error.code === "unavailable" ||
        found.error.code === "not_found" ||
        found.error.code === "invalid_input"
        ? await closeUnstarted(
            start,
            { reason: "configuration_unavailable", why: "model_unusable" },
            limits.value,
            mode,
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
        workspace: session.workspace,
        limits: limits.value,
      },
    );
    if (!basis.ok) return basis;

    const begin: BeginTurnInput = {
      turn,
      session: start.session,
      kind,
      inputMessage: start.input.message,
      basis: basis.value.hash,
      basisSize: basis.value.size,
      resolved: stored.value.hash,
      resolvedSize: stored.value.size,
      limits: limits.value,
      mode,
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
              mode: input.mode,
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
        async closeStarted(why) {
          const current = await readOf(machine, turnRead, { turn });
          if (!current.ok || current.value.turn.state !== "running") return;
          const result = await storeValue(
            deps.blobs,
            deps.instructions.redact,
            TURN_BLOB_PURPOSES.turn_result,
            { turn, why },
          );
          if (!result.ok) return;
          await commandOf(
            machine,
            finishTurn,
            {
              turn,
              outcome: {
                kind: "failed",
                reason:
                  why === "loop_threw" || why === "finish_failed"
                    ? "internal"
                    : "configuration_unavailable",
              },
              result: result.value.hash,
              result_size: result.value.size,
            },
            { state_seq: current.value.turn.state_seq },
            `${turn}:finish:${why}`,
          );
        },
        loop(credential, inputs) {
          const built = loopFor(
            m,
            start,
            deps.agentCall(credential.token),
            inputs,
            texts,
            mode,
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
      fixedMemory.forget(session);
    },
  };
}
