// AgentsSource의 메모리 구현. dev mock 작업대와 gallery가 쓴다. lophn과 사람이 만든 agent 셋이 있는 상태에서 시작하고,
// 화면을 연 자리가 skill·MCP·지침·model 층을 정한다. 저장·삭제·model·켬·끔·grant가 메모리에서 이어지며 쓰는 명령을
// 순서대로 calls에 남긴다. 실제 core의 거절(항목별 이유·conflict)은 failNext…로 세운다.

import type { AssignmentEntry } from "../../../../protocol/approvals/assignment.ts";
import type { AgentDefinitionIssue } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import { isHarnessRuntime } from "../../../../protocol/lophn-agent/agent-values.ts";
import type { McpOwnerWorkspace } from "../../../../protocol/lophn-agent/mcp-settings.ts";
import {
  type CatalogEntry,
  effortAxisOf,
  type ModelChoice,
  type UserModelItem,
  type UserModelRecord,
} from "../../../../protocol/lophn-agent/models.ts";
import {
  isLophn,
  lophnIdOf,
  type Workspace,
  workspaceOfLophn,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import type { ReadResult } from "../source.ts";
import { isAppWorkspace, kindOfWorkspace } from "./agent-key.ts";
import { appsFor } from "./editor/grants-model.ts";
import {
  AGENT_MEMORY,
  ANTHROPIC,
  APP_AGENTS_MD,
  APP_MCP,
  APP_MEMORY,
  APP_NAME,
  APP_SKILLS,
  AVATAR_SRC,
  BROKEN_AGENT_ID,
  BUILT_IN_SKILLS,
  CATALOG,
  EVAL_ANALYST_ID,
  FAKE_AGENTS,
  FAKE_GRANTS,
  GLOBAL_MCP,
  GLOBAL_MODEL,
  GLOBAL_SKILLS,
  GRANT_CATALOG,
  HOME_LOPHN_MD,
  HOME_MCP,
  HOME_MEMORY,
  HOME_SKILLS,
  LOPHN_MD,
  PROJECT_LOPHN_ID,
  PROJECT_MCP,
  PROJECT_MEMORY,
  PROJECT_NAME,
  PROJECT_SKILLS,
} from "./fake-data.ts";
import type {
  AgentCardView,
  AgentDetail,
  AgentDraft,
  AgentListRow,
  AgentsOverview,
  AgentsSource,
  GrantsView,
  ModelsView,
  SaveInput,
  SaveResult,
  ShownModel,
  UserModelKey,
  UserModels,
  WorkspaceView,
} from "./source.ts";
import type {
  InstructionsFile,
  McpRow,
  MemoryTarget,
  SkillRow,
  WorkspaceInstructionsView,
} from "./views.ts";

export {
  ANTHROPIC,
  APP_ID,
  APP_NAME,
  BROKEN_AGENT_ID,
  BUDGET_REVIEWER_ID,
  CODEX_RUNNER_ID,
  EVAL_ANALYST_ID,
  EXPERIMENT_PLANNER_ID,
  FAKE_AGENTS,
  FAKE_GRANTS,
  GLOBAL_LOPHN_MD,
  GLOBAL_MCP,
  GLOBAL_MODEL,
  GLOBAL_SKILLS,
  HOME_LOPHN_ID,
  PROJECT_ID,
  PROJECT_LOPHN_ID,
  PROJECT_NAME,
  QUEUE_WATCHER_ID,
} from "./fake-data.ts";

type FakeCall =
  | {
      method: "saveAgent";
      assignment: string | null;
      hash: string | null;
      definition: AgentDraft;
    }
  | { method: "deleteAgent"; assignment: string; hash: string }
  | { method: "uploadImage"; assignment: string; name: string }
  | { method: "setWorkspaceModel"; choice: ModelChoice | null }
  | { method: "setSkill"; name: string; on: boolean }
  | { method: "setMcp"; name: string; on: boolean }
  | {
      method: "signInMcp";
      name: string;
      workspace: McpOwnerWorkspace | null;
      agent: string | null;
    }
  | { method: "enterMcpSecret"; name: string; server: string }
  | {
      method: "cancelMcpSignIn";
      name: string;
      workspace: McpOwnerWorkspace | null;
      agent: string | null;
    }
  | {
      method: "setGrants";
      assignment: string;
      entries: readonly AssignmentEntry[];
      revision: number;
    }
  | { method: "setShown"; items: readonly ShownModel[] }
  | { method: "refreshModels"; provider: string }
  | { method: "saveModelInfo"; item: UserModelItem; seq: string }
  | { method: "removeModelInfo"; key: UserModelKey; seq: string }
  | { method: "writeInstructions"; text: string; hash: string | null }
  | {
      method: "writeMemory";
      target: MemoryTarget;
      text: string;
      hash: string | null;
    };

export interface FakeAgentsSource extends AgentsSource {
  changed(listener: () => void): () => void;
  /** 보낸 명령을 순서대로. */
  readonly calls: readonly FakeCall[];
  /** agent 파일의 지금 hash. */
  hashOf(assignment: string): string;
  /** 다음 saveAgent를 거절한다. issues가 비면 code만 있는 실패다. */
  failNextSave(issues: readonly AgentDefinitionIssue[], code?: string): void;
  /** 다음 설정 변경(model·skill·MCP·grant) 하나를 실패시킨다. */
  failNextChange(code: string): void;
  /** 다음 overview를 실패시킨다. */
  failNextOverview(code: string): void;
}

interface Stored {
  readonly name: string;
  readonly summary: string;
  readonly definition: AgentDraft;
  readonly hash: string;
}

const DEFAULT_AVATAR = {
  kind: "character",
  shape: "arch",
  color: "sage",
} as const;
const BUILT_IN_AVATAR = {
  lophn: { kind: "character", shape: "square", color: "coral" },
} as const;

const BROKEN_ISSUES: readonly AgentDefinitionIssue[] = [
  { field: "frontmatter", code: "malformed" },
];

const ok = <T>(value: T): ReadResult<T> => ({ ok: true, value });

/** gallery가 provider와 workspace 층 model의 상태를 정하는 설정. 기본은 내장 provider 하나와 workspace 층 model 없음이다. */
export interface FakeAgentsOptions {
  /** none은 연결된 provider가 없다. several은 내장 provider 셋(Anthropic, OpenAI, xAI)이다. custom은 Anthropic에 custom provider 하나를 더한다. */
  readonly providers?: "none" | "built_in" | "several" | "custom";
  /** custom provider의 model 목록을 읽어 둔 상태인가. 기본은 읽어 둔 상태다. */
  readonly customListed?: boolean;
  /** project 층에 처음부터 고른 model. */
  readonly workspaceModel?: ModelChoice;
  /** false면 앱에 source 폴더가 없다: 앱의 AGENTS.md 칸이 빈 채 잠긴다. 기본은 source가 있다. */
  readonly appHasSource?: boolean;
  /** 처음부터 켠 model. 없으면 꺼져 있다. */
  readonly shown?: readonly ShownModel[];
  /** [Refresh models]가 늘 실패한다(앞 목록은 그대로다). */
  readonly refreshFails?: boolean;
  /** 첫 저장을 이 이유로 거절한다. issues가 비면 code(기본 invalid_input)만 있는 실패다. */
  readonly saveFails?: {
    readonly issues: readonly AgentDefinitionIssue[];
    readonly code?: string;
  };
  /** 첫 지우기를 이 code로 거절한다. */
  readonly deleteFails?: string;
  /** 이미지 올리기가 늘 거절된다. */
  readonly uploadFails?: boolean;
  /** 정의 file이 틀린 agent(Broken notes)가 목록에 하나 더 있다. */
  readonly brokenAgent?: boolean;
  /** 사람이 정보를 읽은 뒤 다른 창이 판을 바꾼 상태다. 읽은 판으로 보내는 첫 저장·지우기는 conflict가 된다. */
  readonly infoGoesStale?: boolean;
}

export const OPENAI = "pvd_01arz3ndektsv4rrffq69g5fa2";
export const XAI = "pvd_01arz3ndektsv4rrffq69g5fa3";
export const CUSTOM_PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fa4";
const CUSTOM_DEFINITION = "custom_openai";
/** custom provider에서 사람이 정보를 적은 model. provider가 알려 준 목록에는 없다. */
export const CUSTOM_INFO_MODEL = "deepseek-v4.1-flash";

const SAVED_AT = "2026-10-18T09:00:00.000Z";

const CUSTOM_INFO: UserModelRecord = {
  provider_definition: CUSTOM_DEFINITION,
  model_name: CUSTOM_INFO_MODEL,
  info: {
    context_limit: 1_000_000,
    input_limit: null,
    output_limit: 32_000,
    supports_tools: true,
    input_media: ["text", "image"],
    output_media: ["text"],
    effort: {
      values: ["low", "medium", "high", "maximum"],
      default_value: "high",
    },
    price: {
      input: "0.14",
      output: "0.28",
      cache_read: "0.014",
      cache_write: null,
    },
  },
  saved_at: SAVED_AT,
};

// core가 user 정보로 만드는 catalog 항목 중 화면이 읽는 칸만 같은 모양으로 채운다.
function userEntryOf(
  record: UserModelRecord,
  base?: CatalogEntry,
): CatalogEntry {
  const { info } = record;
  return {
    provider_definition: record.provider_definition,
    model_name: record.model_name,
    protocol: base?.protocol ?? null,
    context_limit: info.context_limit ?? base?.context_limit ?? null,
    input_limit: info.input_limit ?? base?.input_limit ?? null,
    output_limit: info.output_limit ?? base?.output_limit ?? null,
    supports_tools: info.supports_tools ?? base?.supports_tools ?? null,
    input_media:
      info.input_media ?? (base === undefined ? ["text"] : base.input_media),
    output_media:
      info.output_media ?? (base === undefined ? ["text"] : base.output_media),
    options:
      info.effort === null
        ? base === undefined
          ? []
          : base.options
        : [effortAxisOf(info.effort)],
    preview: base?.preview ?? null,
    deprecated: base?.deprecated ?? null,
    source: "user",
    source_revision: SAVED_AT,
    checked_at: null,
    received_at: SAVED_AT,
    price_basis: null,
  };
}

// catalog는 Anthropic 셋뿐이라 OpenAI와 xAI의 model은 같은 모양의 항목을 이름과 정의만 바꿔 더한다.
const OTHER_CATALOG: readonly CatalogEntry[] = [
  ["openai", "GPT-6.1 Sol"],
  ["openai", "GPT-6.1 Mini"],
  ["xai", "Grok 4.7"],
].map(([definition, name]) => ({
  ...CATALOG[2],
  provider_definition: definition,
  model_name: name,
}));

const sameKey = (first: UserModelKey, second: UserModelKey) =>
  first.provider_definition === second.provider_definition &&
  first.model_name === second.model_name;

export function createFakeAgentsSource(
  options: FakeAgentsOptions = {},
): FakeAgentsSource {
  const calls: FakeCall[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  let version = 0;
  const nextHash = () => String(++version).padStart(64, "0");
  let created = 0;

  const stored = new Map<string, Stored>(
    FAKE_AGENTS.map((agent) => [
      agent.key,
      {
        name: agent.name,
        summary: agent.summary,
        definition: agent.definition,
        hash: nextHash(),
      },
    ]),
  );
  if (options.brokenAgent) {
    stored.set(BROKEN_AGENT_ID, {
      name: "Broken notes",
      summary: "",
      definition: { name: "Broken notes", body: "" },
      hash: nextHash(),
    });
  }
  const grants = new Map<string, readonly AssignmentEntry[]>(
    Object.entries(FAKE_GRANTS),
  );
  const grantRevisions = new Map<string, number>();
  // workspace마다 lophn이 하나 있다. project의 것은 처음부터 있고 나머지는 그 정의를 본떠 처음 볼 때 만든다.
  const ensureLophn = (key: string) => {
    if (stored.has(key)) return;
    const model = stored.get(PROJECT_LOPHN_ID)!;
    stored.set(key, { ...model, hash: nextHash() });
    grants.set(key, grants.get(PROJECT_LOPHN_ID) ?? []);
  };
  let customListed = options.customListed ?? true;
  // workspace마다 같은 층을 갖는다: 지침 파일(쓸 때마다 hash가 바뀌어 옛 hash로 쓰면 conflict다), model, 끈 skill, 끈 MCP server, memory.
  // 지침이 null이면 파일이 놓일 곳이 없다(source 없는 앱).
  interface Layer {
    instructions: InstructionsFile | null;
    model: ModelChoice | null;
    skillOff: Set<string>;
    mcpOff: Set<string>;
    memory: InstructionsFile;
  }
  const layers = new Map<string, Layer>();
  const layerOf = (workspace: string): Layer => {
    const found = layers.get(workspace);
    if (found !== undefined) return found;
    const kind = kindOfWorkspace(workspace);
    const rows = {
      home: { skills: HOME_SKILLS, mcp: HOME_MCP },
      project: { skills: PROJECT_SKILLS, mcp: PROJECT_MCP },
      app: { skills: APP_SKILLS, mcp: APP_MCP },
    }[kind];
    const made: Layer = {
      instructions:
        kind === "app" && options.appHasSource === false
          ? null
          : {
              text:
                kind === "home"
                  ? HOME_LOPHN_MD
                  : kind === "app"
                    ? APP_AGENTS_MD
                    : LOPHN_MD,
              hash: nextHash(),
            },
      model: kind === "project" ? (options.workspaceModel ?? null) : null,
      skillOff: new Set(
        rows.skills.filter((row) => !row.on).map((row) => row.name),
      ),
      mcpOff: new Set(rows.mcp.filter((row) => !row.on).map((row) => row.name)),
      memory: {
        text: { home: HOME_MEMORY, project: PROJECT_MEMORY, app: APP_MEMORY }[
          kind
        ],
        hash: nextHash(),
      },
    };
    layers.set(workspace, made);
    return made;
  };
  // 사람이 만든 agent의 memory. 처음에는 Eval analyst만 적어 둔 것이 있다.
  const agentMemories = new Map<string, InstructionsFile>([
    [EVAL_ANALYST_ID, { text: AGENT_MEMORY, hash: nextHash() }],
  ]);
  const agentMemoryOf = (key: string): InstructionsFile => {
    const found = agentMemories.get(key) ?? { text: "", hash: null };
    agentMemories.set(key, found);
    return found;
  };
  let shown: readonly ShownModel[] = options.shown ?? [];
  // 사람이 적은 custom provider model 정보. custom provider를 붙인 상태에서만 처음부터 하나가 있다.
  let userModels: UserModels = {
    seq: "1",
    items: options.providers === "custom" ? [CUSTOM_INFO] : [],
  };
  let wentStale = false;
  const changeUserModels = (
    seq: string,
    items: readonly UserModelRecord[],
  ): ReadResult<UserModels> => {
    const failure = takeChangeFailure();
    if (failure !== null) return failure;
    if (seq !== userModels.seq) return { ok: false, message: "conflict" };
    userModels = { seq: String(Number(seq) + 1), items };
    return ok(userModels);
  };

  let saveFailure: {
    issues: readonly AgentDefinitionIssue[];
    code: string;
  } | null = options.saveFails
    ? {
        issues: options.saveFails.issues,
        code: options.saveFails.code ?? "invalid_input",
      }
    : null;
  let deleteFailure: string | null = options.deleteFails ?? null;
  let changeFailure: string | null = null;
  let overviewFailure: string | null = null;

  const takeChangeFailure = (): { ok: false; message: string } | null => {
    if (changeFailure === null) return null;
    const message = changeFailure;
    changeFailure = null;
    return { ok: false, message };
  };

  type WorkspaceKind = "none" | "home" | "project" | "app";
  const workspaceKind = (workspace: string | null): WorkspaceKind =>
    workspace === null ? "none" : kindOfWorkspace(workspace);
  const nameOfWorkspace = (workspace: string): string =>
    ({ home: "Home", project: PROJECT_NAME, app: APP_NAME })[
      kindOfWorkspace(workspace)
    ];
  const workspaceView = (workspace: string | null): WorkspaceView =>
    workspace === null
      ? { kind: "none", id: null, name: "" }
      : {
          kind: kindOfWorkspace(workspace),
          id: workspace === "home" ? null : workspace,
          name: nameOfWorkspace(workspace),
        };

  const skillsFor = (workspace: string | null): SkillRow[] => {
    if (workspace === null) return [...GLOBAL_SKILLS];
    const kind = kindOfWorkspace(workspace);
    const off = layerOf(workspace).skillOff;
    const own = {
      home: HOME_SKILLS,
      project: PROJECT_SKILLS,
      app: APP_SKILLS,
    }[kind];
    return [
      ...BUILT_IN_SKILLS[kind],
      ...GLOBAL_SKILLS,
      ...own.map((row) => ({ ...row, on: !off.has(row.name) })),
    ];
  };
  const mcpFor = (workspace: string | null): McpRow[] => {
    if (workspace === null) return [...GLOBAL_MCP];
    const off = layerOf(workspace).mcpOff;
    const own = { home: HOME_MCP, project: PROJECT_MCP, app: APP_MCP }[
      kindOfWorkspace(workspace)
    ];
    return [
      ...GLOBAL_MCP,
      ...own.map((row) => ({ ...row, on: !off.has(row.name) })),
    ];
  };

  const inheritedModel = (workspace: string | null) => {
    const chosen = workspace === null ? null : layerOf(workspace).model;
    return chosen !== null
      ? { value: chosen, source: "project" as const }
      : { value: GLOBAL_MODEL, source: "global" as const };
  };

  const instructionsOf = (workspace: string): WorkspaceInstructionsView => {
    const file = layerOf(workspace).instructions;
    return {
      text: file?.text ?? "",
      hash: file?.hash ?? null,
      workspace: nameOfWorkspace(workspace),
      file: kindOfWorkspace(workspace) === "app" ? "AGENTS.md" : "LOPHN.md",
      editable: file !== null,
    };
  };

  const avatarOf = (key: string, item: Stored) =>
    item.definition.avatar ??
    (isLophn(key) ? BUILT_IN_AVATAR.lophn : DEFAULT_AVATAR);

  // 그 자리의 lophn(첫 줄), 전역 agent, 그 자리 범위 agent만 보인다. home("home")은 Home lophn과 전역만 남는다.
  const visible = (workspace: string) => {
    const lophn = lophnIdOf(
      workspace === "home"
        ? null
        : {
            kind: isAppWorkspace(workspace) ? "app" : "project",
            id: workspace,
          },
    );
    ensureLophn(lophn);
    return [
      ...[...stored].filter(([key]) => key === lophn),
      ...[...stored].filter(
        ([key, item]) =>
          !isLophn(key) &&
          (item.definition.workspace === undefined ||
            item.definition.workspace.id === workspace),
      ),
    ];
  };

  // Home의 Agents 탭: Home lophn, 전역, 모든 workspace의 범위 agent.
  const visibleEverything = () => {
    ensureLophn(lophnIdOf(null));
    return [
      ...[...stored].filter(([key]) => key === lophnIdOf(null)),
      ...[...stored].filter(([key]) => !isLophn(key)),
    ];
  };

  const ALL_MODALITIES = ["text", "image", "file"] as const;

  // lophn의 범위는 정의 file이 아니라 id가 말한다.
  const scopeOf = (key: string, item: Stored) =>
    isLophn(key) ? workspaceOfLophn(key) : (item.definition.workspace ?? null);

  // core의 cardOf를 줄인 것: 차이는 skill·MCP 이름만 세고, model은 정의나 전역 값이다(가격은 anthropic 것만 안다).
  const cardOf = (key: string, item: Stored): AgentCardView => {
    const definition = item.definition;
    const custom = definition.runtime === "custom";
    const chosen = definition.model ?? GLOBAL_MODEL;
    const harness = isHarnessRuntime(definition.runtime ?? "lophn");
    return {
      handle: isLophn(key) ? "lophn" : (definition.handle ?? item.name),
      name: item.name,
      browserProfile: definition.browser_profile ?? null,
      workspace: scopeOf(key, item),
      ...(definition.description === undefined
        ? {}
        : { description: definition.description }),
      runtime: definition.runtime ?? "lophn",
      ...(harness
        ? {}
        : {
            model: {
              provider:
                chosen.provider === ANTHROPIC
                  ? "Anthropic"
                  : chosen.provider === OPENAI
                    ? "OpenAI"
                    : chosen.provider === XAI
                      ? "xAI"
                      : "Local server",
              model_name: chosen.model_name,
              price:
                chosen.provider === ANTHROPIC
                  ? { input: "3", output: "15" }
                  : null,
            },
          }),
      modality: {
        input: [...(definition.modality?.input ?? ALL_MODALITIES)],
        output: [...(definition.modality?.output ?? ALL_MODALITIES)],
      },
      replies: ["none", "result", "conversation"],
      diff: custom
        ? {
            plus: [
              ...(definition.tools ?? []),
              ...(definition.skills ?? []).map((n) => `skill: ${n}`),
            ],
            minus: ["lophn built-ins"],
          }
        : {
            plus: (definition.mcp_servers ?? []).map(
              (server) => `mcp: ${server.name}`,
            ),
            minus: (definition.skills_off ?? []).map((n) => `skill: ${n}`),
          },
      notes: [],
    };
  };

  const rowOf = (
    key: string,
    item: Stored,
    workspace: string | null,
  ): AgentListRow => {
    if (key === BROKEN_AGENT_ID) {
      return {
        assignment: key,
        handle: "broken-notes",
        workspace: null,
        name: item.name,
        avatar: DEFAULT_AVATAR,
        model: null,
        issues: BROKEN_ISSUES,
        counts: { skills: null, mcp: null },
        browserProfile: null,
      };
    }
    const definition = item.definition;
    const off = definition.skills_off ?? [];
    const mcpOff = (definition.mcp_off ?? []).map((entry) => entry.server_name);
    const skills =
      definition.runtime === "custom"
        ? (definition.skills?.length ?? 0)
        : skillsFor(workspace).filter(
            (row) => row.on && (row.builtIn || !off.includes(row.name)),
          ).length;
    const own = (definition.mcp_servers ?? []).filter(
      (server) => server.enabled,
    ).length;
    const mcp =
      mcpFor(workspace).filter((row) => row.on && !mcpOff.includes(row.name))
        .length + own;
    const model = definition.model ?? inheritedModel(workspace).value;
    return {
      assignment: key,
      handle: isLophn(key) ? "lophn" : (item.definition.handle ?? key),
      workspace: scopeOf(key, item),
      name: item.name,
      avatar: avatarOf(key, item),
      ...(definition.description === undefined
        ? {}
        : { description: definition.description }),
      model: {
        provider: model.provider,
        model_name: model.model_name,
        source:
          definition.model === undefined
            ? inheritedModel(workspace).source
            : "agent",
      },
      issues: [],
      counts: {
        skills,
        mcp,
      },
      browserProfile: definition.browser_profile ?? null,
      card: cardOf(key, item),
      glance: {
        model,
        instructions: definition.body.trim() !== "",
        apps: (grants.get(key) ?? []).filter((one) => one.machine === undefined)
          .length,
        remoteApps: (grants.get(key) ?? []).filter(
          (one) => one.machine !== undefined,
        ).length,
        tools: definition.tools ?? [],
        skip: definition.skip === true,
      },
    };
  };

  // core의 정의 file처럼 할당을 정의의 apps·remote_apps 칸으로도 보인다(복제가 이 칸을 그대로 옮긴다).
  const withGrantsOf = (key: string, definition: AgentDraft): AgentDraft => {
    const entries = grants.get(key) ?? [];
    const local = entries.filter((one) => one.machine === undefined);
    const remote = entries.filter((one) => one.machine !== undefined);
    return {
      ...definition,
      ...(local.length === 0 ? {} : { apps: local.map((one) => one.app) }),
      ...(remote.length === 0
        ? {}
        : {
            remote_apps: remote.map((one) => ({
              machine: one.machine,
              app: one.app,
              name: one.name,
              removed: one.removed_tools,
            })),
          }),
    } as AgentDraft;
  };

  const detailOf = (key: string, workspace: string | null): AgentDetail => {
    const item = stored.get(key)!;
    const row = rowOf(key, item, workspace);
    return {
      assignment: key,
      draftId: null,
      workspace: workspaceView(workspace),
      definition: withGrantsOf(key, item.definition),
      hash: item.hash,
      effective: {
        name: { value: item.name, source: "agent" },
        avatar: { value: row.avatar, source: "agent" },
      },
      inheritedModel: inheritedModel(workspace),
      issues: key === BROKEN_AGENT_ID ? BROKEN_ISSUES : [],
      ...(key === BROKEN_AGENT_ID ? {} : { card: cardOf(key, item) }),
      skills: skillsFor(workspace),
      mcpServers: mcpFor(workspace),
      // 저장된 정의의 OAuth server는 로그인 전이다. 화면은 그 줄에 [Sign in]을 그린다.
      agentMcpLogins: Object.fromEntries(
        (item.definition.mcp_servers ?? []).flatMap((server) =>
          server.transport === "http" && server.http.auth.kind === "oauth2"
            ? [
                [
                  server.name,
                  {
                    workspace: null,
                    agent: key,
                    client_id: server.http.auth.client_id,
                    scopes: server.http.auth.scopes,
                    state: "none" as const,
                    reason: null,
                  },
                ],
              ]
            : [],
        ),
      ),
      instructions: workspace === null ? null : instructionsOf(workspace),
      memory: isLophn(key) ? null : agentMemoryOf(key),
    };
  };

  return {
    calls,
    changed(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hashOf: (key) => stored.get(key)!.hash,
    failNextSave(issues, code = "invalid_input") {
      saveFailure = { issues, code };
    },
    failNextChange(code) {
      changeFailure = code;
    },
    failNextOverview(code) {
      overviewFailure = code;
    },

    list(workspace) {
      return Promise.resolve(
        ok(
          visible(workspace).map(([key, item]) => rowOf(key, item, workspace)),
        ),
      );
    },

    lophnNames() {
      return Promise.resolve(
        ok(
          Object.fromEntries(
            [...stored]
              .filter(([key]) => isLophn(key))
              .map(([key, item]) => [key, item.name]),
          ),
        ),
      );
    },

    overview(workspace): Promise<ReadResult<AgentsOverview>> {
      if (overviewFailure !== null) {
        const message = overviewFailure;
        overviewFailure = null;
        return Promise.resolve({ ok: false, message });
      }
      return Promise.resolve(
        ok({
          agents: (workspace === "home"
            ? visibleEverything()
            : visible(workspace)
          ).map(([key, item]) => {
            const row = rowOf(key, item, workspace);
            return row.workspace === null
              ? row
              : {
                  ...row,
                  workspaceName: nameOfWorkspace(row.workspace.id),
                };
          }),
          instructions: instructionsOf(workspace),
          workspaceModel: {
            chosen: layerOf(workspace).model,
            inherited: GLOBAL_MODEL,
          },
          skills: skillsFor(workspace),
          mcpServers: mcpFor(workspace),
          memory: layerOf(workspace).memory,
        }),
      );
    },

    models(): Promise<ReadResult<ModelsView>> {
      const kind = options.providers ?? "built_in";
      const base = [...CATALOG, ...OTHER_CATALOG];
      const typed = userModels.items.map((record) =>
        userEntryOf(
          record,
          base.find(
            (entry) =>
              entry.provider_definition === record.provider_definition &&
              entry.model_name === record.model_name,
          ),
        ),
      );
      const builtIn = (id: string, name: string, definition: string) => ({
        id,
        name,
        definition,
        kind: "api_key",
        reportedModels: null,
        refreshable: false,
        custom: false,
        limits: {},
      });
      return Promise.resolve(
        ok({
          providers: [
            ...(kind === "none"
              ? []
              : [builtIn(ANTHROPIC, "Anthropic", "anthropic")]),
            ...(kind === "several"
              ? [
                  builtIn(OPENAI, "OpenAI", "openai"),
                  builtIn(XAI, "xAI", "xai"),
                ]
              : []),
            ...(kind === "custom"
              ? [
                  {
                    id: CUSTOM_PROVIDER,
                    name: "Local server",
                    definition: CUSTOM_DEFINITION,
                    kind: "api_key",
                    reportedModels: customListed
                      ? ["llama-3.3-70b", "qwen-3-coder"]
                      : null,
                    refreshable: true,
                    custom: true,
                    limits: {},
                  },
                ]
              : []),
          ],
          catalog: [
            ...base.filter(
              (entry) =>
                !typed.some(
                  (override) =>
                    override.provider_definition ===
                      entry.provider_definition &&
                    override.model_name === entry.model_name,
                ),
            ),
            ...typed,
          ],
          shown,
        }),
      );
    },

    refreshModels(provider) {
      calls.push({ method: "refreshModels", provider });
      if (options.refreshFails || takeChangeFailure() !== null) {
        return Promise.resolve(false);
      }
      if (provider === CUSTOM_PROVIDER) {
        customListed = true;
      }
      return Promise.resolve(true);
    },

    setShown(items) {
      calls.push({ method: "setShown", items });
      shown = items;
      return Promise.resolve(ok(items));
    },

    userModels() {
      const read = userModels;
      if (options.infoGoesStale && !wentStale) {
        wentStale = true;
        userModels = { ...userModels, seq: String(Number(read.seq) + 1) };
      }
      return Promise.resolve(ok(read));
    },

    saveModelInfo(item, seq) {
      calls.push({ method: "saveModelInfo", item, seq });
      const record: UserModelRecord = { ...item, saved_at: SAVED_AT };
      return Promise.resolve(
        changeUserModels(seq, [
          ...userModels.items.filter((one) => !sameKey(one, item)),
          record,
        ]),
      );
    },

    removeModelInfo(key, seq) {
      calls.push({ method: "removeModelInfo", key, seq });
      return Promise.resolve(
        changeUserModels(
          seq,
          userModels.items.filter((one) => !sameKey(one, key)),
        ),
      );
    },

    readAgent(_project, key) {
      if (isLophn(key)) ensureLophn(key);
      return Promise.resolve(
        stored.has(key)
          ? ok(detailOf(key, _project))
          : { ok: false, message: "not_found" },
      );
    },

    newAgent(workspace) {
      const at = workspaceKind(workspace);
      const draftId = `agt_${`nw${created + 1}`.padStart(26, "0")}`;
      return Promise.resolve(
        ok({
          assignment: null,
          draftId,
          workspace: workspaceView(workspace),
          // Home과 Settings는 전역 agent만 만든다.
          definition:
            workspace === null || at === "none" || at === "home"
              ? { body: "" }
              : { body: "", workspace: { kind: at, id: workspace } },
          hash: null,
          effective: {
            name: { value: "", source: "global" },
            avatar: { value: DEFAULT_AVATAR, source: "global" },
          },
          inheritedModel: inheritedModel(workspace),
          issues: [],
          skills: skillsFor(workspace),
          mcpServers: mcpFor(workspace),
          agentMcpLogins: {},
          instructions: workspace === null ? null : instructionsOf(workspace),
          memory: null,
        } satisfies AgentDetail),
      );
    },

    saveAgent(_project, input: SaveInput): Promise<SaveResult> {
      calls.push({
        method: "saveAgent",
        assignment: input.assignment,
        hash: input.hash,
        definition: input.definition,
      });
      if (saveFailure !== null) {
        const { issues, code } = saveFailure;
        saveFailure = null;
        return Promise.resolve({ ok: false, message: code, issues });
      }
      const existing =
        input.assignment === null ? undefined : stored.get(input.assignment);
      if (input.assignment !== null) {
        if (existing === undefined) {
          return Promise.resolve({
            ok: false,
            message: "not_found",
            issues: [],
          });
        }
        if (existing.hash !== input.hash) {
          return Promise.resolve({
            ok: false,
            message: "conflict",
            issues: [],
          });
        }
      }
      created += 1;
      const key =
        input.assignment ??
        input.draftId ??
        `agt_${`nw${created}`.padStart(26, "0")}`;
      const hash = nextHash();
      stored.set(key, {
        name: input.definition.name ?? existing?.name ?? "",
        summary: existing?.summary ?? "",
        definition: input.definition,
        hash,
      });
      // 복제는 할당 칸을 들고 만든다. core처럼 만든 agent의 할당이 된다.
      if (input.assignment === null) {
        const copied = input.definition as AgentDraft & {
          apps?: readonly `app_${string}`[];
          remote_apps?: readonly {
            machine: `mch_${string}`;
            app: `app_${string}`;
            name: string;
            removed: readonly string[];
          }[];
        };
        grants.set(key, [
          ...(copied.apps ?? []).map((app) => ({ app, removed_tools: [] })),
          ...(copied.remote_apps ?? []).map((one) => ({
            app: one.app,
            machine: one.machine,
            name: one.name,
            removed_tools: [...one.removed],
          })),
        ]);
      }
      notify();
      return Promise.resolve({ ok: true, value: { assignment: key, hash } });
    },

    deleteAgent(_project, key, hash) {
      calls.push({ method: "deleteAgent", assignment: key, hash });
      if (deleteFailure !== null) {
        const message = deleteFailure;
        deleteFailure = null;
        return Promise.resolve({ ok: false, message });
      }
      const existing = stored.get(key);
      if (existing === undefined) {
        return Promise.resolve({ ok: false, message: "not_found" });
      }
      if (existing.hash !== hash) {
        return Promise.resolve({ ok: false, message: "conflict" });
      }
      stored.delete(key);
      notify();
      return Promise.resolve(ok(null));
    },

    uploadImage(_project, key, file) {
      calls.push({ method: "uploadImage", assignment: key, name: file.name });
      if (options.uploadFails) {
        return Promise.resolve({ ok: false, message: "invalid_input" });
      }
      return Promise.resolve(ok({ image: "avatar.png" }));
    },

    imageSrc: () => AVATAR_SRC,

    setWorkspaceModel(workspace, choice) {
      calls.push({ method: "setWorkspaceModel", choice });
      const failed = takeChangeFailure();
      if (failed !== null) return Promise.resolve(failed);
      layerOf(workspace).model = choice;
      return Promise.resolve(ok(null));
    },

    setSkill(workspace, name, on) {
      calls.push({ method: "setSkill", name, on });
      const failed = takeChangeFailure();
      if (failed !== null) return Promise.resolve(failed);
      if (on) layerOf(workspace).skillOff.delete(name);
      else layerOf(workspace).skillOff.add(name);
      return Promise.resolve(ok(null));
    },

    signInMcp(name, login) {
      calls.push({
        method: "signInMcp",
        name,
        workspace: login.workspace,
        agent: login.agent,
      });
      return Promise.resolve(ok(null));
    },

    cancelMcpSignIn(name, login) {
      calls.push({
        method: "cancelMcpSignIn",
        name,
        workspace: login.workspace,
        agent: login.agent,
      });
      return Promise.resolve(ok(null));
    },

    enterMcpSecret(name, server) {
      calls.push({ method: "enterMcpSecret", name, server });
      return Promise.resolve();
    },

    setMcp(workspace, name, on) {
      calls.push({ method: "setMcp", name, on });
      const failed = takeChangeFailure();
      if (failed !== null) return Promise.resolve(failed);
      if (on) layerOf(workspace).mcpOff.delete(name);
      else layerOf(workspace).mcpOff.add(name);
      return Promise.resolve(ok(null));
    },

    grants(_project, key): Promise<ReadResult<GrantsView>> {
      if (isLophn(key)) ensureLophn(key);
      return Promise.resolve(
        ok({
          entries: grants.get(key) ?? [],
          catalog: { apps: appsFor(GRANT_CATALOG.apps, _project) },
          revision: grantRevisions.get(key) ?? 0,
        }),
      );
    },

    setGrants(_project, key, entries, revision) {
      calls.push({ method: "setGrants", assignment: key, entries, revision });
      const failed = takeChangeFailure();
      if (failed !== null) return Promise.resolve(failed);
      grants.set(key, entries);
      grantRevisions.set(key, revision + 1);
      notify();
      return Promise.resolve(ok({ revision: revision + 1 }));
    },

    readInstructions(workspace) {
      const file = layerOf(workspace).instructions;
      return Promise.resolve(
        file === null ? { ok: false, message: "unavailable" } : ok(file),
      );
    },

    writeInstructions(workspace, text, hash) {
      calls.push({ method: "writeInstructions", text, hash });
      const layer = layerOf(workspace);
      if (layer.instructions === null) {
        return Promise.resolve({ ok: false, message: "unavailable" });
      }
      const failed = takeChangeFailure();
      if (failed !== null) return Promise.resolve(failed);
      if (hash !== layer.instructions.hash) {
        return Promise.resolve({ ok: false, message: "conflict" });
      }
      layer.instructions = { text, hash: nextHash() };
      return Promise.resolve(ok(layer.instructions));
    },

    readMemory(target) {
      return Promise.resolve(
        ok(
          target.kind === "agent"
            ? agentMemoryOf(target.agent)
            : layerOf(target.workspace).memory,
        ),
      );
    },

    writeMemory(target, text, hash) {
      calls.push({ method: "writeMemory", target, text, hash });
      const failed = takeChangeFailure();
      if (failed !== null) return Promise.resolve(failed);
      const current =
        target.kind === "agent"
          ? agentMemoryOf(target.agent)
          : layerOf(target.workspace).memory;
      if (hash !== current.hash) {
        return Promise.resolve({ ok: false, message: "conflict" });
      }
      const next = { text, hash: nextHash() };
      if (target.kind === "agent") agentMemories.set(target.agent, next);
      else layerOf(target.workspace).memory = next;
      return Promise.resolve(ok(next));
    },
  };
}
