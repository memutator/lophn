// AgentsSource의 메모리 구현. dev mock 작업대와 gallery가 쓴다. phroner project에 Project Manager · Operator 둘이,
// 앱 Budget tracker에 App Engineer가 있는 상태에서 시작하고, 저장·삭제·model·켬·끔·grant가 메모리에서 이어지며 쓰는 명령을
// 순서대로 calls에 남긴다. 실제 core의 거절(항목별 이유·conflict)은 failNext…로 세운다.
import type { AgentDefinitionIssue } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import {
  type CatalogEntry,
  effortAxisOf,
  type ModelChoice,
  type UserModelItem,
  type UserModelRecord,
} from "../../../../protocol/lophn-agent/models.ts";
import type { AgentGrantEntry } from "../../../../protocol/approvals/grants.ts";
import type { ReadResult } from "../source.ts";
import {
  ANTHROPIC,
  APP_ID,
  APP_NAME,
  AVATAR_SRC,
  BUILT_IN_SKILLS,
  CATALOG,
  FAKE_AGENTS,
  FAKE_GRANTS,
  type FakeAgent,
  GLOBAL_MCP,
  GLOBAL_MODEL,
  GLOBAL_SKILLS,
  GRANT_CATALOG,
  LOPHN_MD,
  PROJECT_ID as PROJECT,
  PROJECT_MCP,
  PROJECT_NAME,
  PROJECT_SKILLS,
} from "./fake-data.ts";
import { isAppPlace, keyOf } from "./agent-key.ts";
import type {
  AgentDetail,
  AgentDraft,
  AgentListRow,
  AgentsOverview,
  AgentsSource,
  GrantsView,
  HiddenModel,
  ModelsView,
  SaveInput,
  SaveResult,
  UserModelKey,
  UserModels,
} from "./source.ts";
import type { McpRow, SkillRow } from "./views.ts";

export {
  ANTHROPIC,
  APP_ID,
  APP_NAME,
  EVAL_ANALYST_ID,
  FAKE_AGENTS,
  FAKE_GRANTS,
  GLOBAL_LOPHN_MD,
  GLOBAL_MCP,
  GLOBAL_MODEL,
  GLOBAL_SKILLS,
  PROJECT_CONTEXTS,
  PROJECT_ID,
  PROJECT_NAME,
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
  | { method: "setProjectModel"; choice: ModelChoice | null }
  | { method: "setSkill"; name: string; on: boolean }
  | { method: "setMcp"; name: string; on: boolean }
  | {
    method: "setGrants";
    assignment: string;
    entries: readonly AgentGrantEntry[];
  }
  | { method: "setHidden"; items: readonly HiddenModel[] }
  | { method: "refreshModels"; provider: string }
  | { method: "saveModelInfo"; item: UserModelItem; seq: string }
  | { method: "removeModelInfo"; key: UserModelKey; seq: string };

interface FakeAgentsSource extends AgentsSource {
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
  readonly role: FakeAgent["role"];
  readonly place: FakeAgent["place"];
  readonly name: string;
  readonly summary: string;
  readonly definition: AgentDraft;
  readonly hash: string;
}

const DEFAULT_PROFILE = { kind: "icon", icon: "roles" } as const;
const BUILT_IN_ICON: Record<string, string> = {
  lophn: "dock",
  project_manager: "contexts",
  app_engineer: "apps",
};

const ok = <T>(value: T): ReadResult<T> => ({ ok: true, value });

/** gallery가 provider와 project 층 model의 상태를 정하는 설정. 기본은 내장 provider 하나와 project 층 model 없음이다. */
export interface FakeAgentsOptions {
  /** none은 연결된 provider가 없다. several은 내장 provider 셋(Anthropic, OpenAI, xAI)이다. custom은 Anthropic에 custom provider 하나를 더한다. */
  readonly providers?: "none" | "built_in" | "several" | "custom";
  /** custom provider의 model 목록을 읽어 둔 상태인가. 기본은 읽어 둔 상태다. */
  readonly customListed?: boolean;
  /** project 층에 처음부터 고른 model. */
  readonly projectModel?: ModelChoice;
  /** 처음부터 끈 model. */
  readonly hidden?: readonly HiddenModel[];
  /** [Refresh models]가 늘 실패한다(앞 목록은 그대로다). */
  readonly refreshFails?: boolean;
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
function userEntryOf(record: UserModelRecord): CatalogEntry {
  const { info } = record;
  return {
    provider_definition: record.provider_definition,
    model_name: record.model_name,
    context_limit: info.context_limit,
    input_limit: info.input_limit,
    output_limit: info.output_limit,
    supports_tools: info.supports_tools,
    input_media: info.input_media,
    output_media: info.output_media,
    options: info.effort === null ? [] : [effortAxisOf(info.effort)],
    preview: null,
    deprecated: null,
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
  let version = 0;
  const nextHash = () => String(++version).padStart(64, "0");
  let created = 0;

  const stored = new Map<string, Stored>(
    FAKE_AGENTS.map((agent) => [agent.key, {
      role: agent.role,
      place: agent.place,
      name: agent.name,
      summary: agent.summary,
      definition: agent.definition,
      hash: nextHash(),
    }]),
  );
  const grants = new Map<string, readonly AgentGrantEntry[]>(
    Object.entries(FAKE_GRANTS),
  );
  let projectModel: ModelChoice | null = options.projectModel ?? null;
  let customListed = options.customListed ?? true;
  // 층에서 끈 skill(project 층)과 끈 MCP server(project 층).
  const projectSkillOff = new Set(
    PROJECT_SKILLS.filter((row) => !row.on).map((row) => row.name),
  );
  const projectMcpOff = new Set(
    PROJECT_MCP.filter((row) => !row.on).map((row) => row.name),
  );
  let hidden: readonly HiddenModel[] = options.hidden ?? [];
  // 사람이 적은 custom provider model 정보. custom provider를 붙인 상태에서만 처음부터 하나가 있다.
  let userModels: UserModels = {
    seq: "1",
    items: options.providers === "custom" ? [CUSTOM_INFO] : [],
  };
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

  let saveFailure:
    | { issues: readonly AgentDefinitionIssue[]; code: string }
    | null = null;
  let changeFailure: string | null = null;
  let overviewFailure: string | null = null;

  const takeChangeFailure = (): { ok: false; message: string } | null => {
    if (changeFailure === null) return null;
    const message = changeFailure;
    changeFailure = null;
    return { ok: false, message };
  };

  const skillsFor = (item: Stored, atProject: boolean): SkillRow[] => [
    ...(item.role === "project_manager" ? BUILT_IN_SKILLS : []),
    ...GLOBAL_SKILLS,
    ...(atProject
      ? PROJECT_SKILLS.map((row) => ({
        ...row,
        on: !projectSkillOff.has(row.name),
      }))
      : []),
  ];
  const mcpFor = (atProject: boolean): McpRow[] => [
    ...GLOBAL_MCP,
    ...(atProject
      ? PROJECT_MCP.map((row) => ({ ...row, on: !projectMcpOff.has(row.name) }))
      : []),
  ];

  const inheritedModel = (item: Stored) =>
    item.place === "project" && projectModel !== null
      ? { value: projectModel, source: "project" as const }
      : { value: GLOBAL_MODEL, source: "global" as const };

  const rowOf = (key: string, item: Stored): AgentListRow => {
    const definition = item.definition;
    const atProject = item.place === "project";
    const skillsOff = definition.skills_off ?? [];
    const mcpOff = (definition.mcp_off ?? []).map((entry) => entry.server_name);
    const skills =
      skillsFor(item, atProject).filter((row) =>
        row.on && !skillsOff.includes(row.name)
      ).length;
    const own =
      (definition.mcp_servers ?? []).filter((server) => server.enabled)
        .length;
    const mcp =
      mcpFor(atProject).filter((row) => row.on && !mcpOff.includes(row.name))
        .length + own;
    const builtIn = item.role !== "operator";
    const model = definition.model ?? inheritedModel(item).value;
    return {
      assignment: key,
      role: item.role,
      kind: builtIn ? "built_in" : "operator",
      name: item.name,
      profile: definition.profile ??
        (builtIn
          ? { kind: "icon", icon: BUILT_IN_ICON[item.role] }
          : DEFAULT_PROFILE),
      model: {
        provider: model.provider,
        model_name: model.model_name,
        source: definition.model === undefined
          ? inheritedModel(item).source
          : "agent",
      },
      issues: [],
      counts: {
        contexts: builtIn ? null : (definition.contexts ?? []).length,
        skills,
        mcp,
      },
    };
  };

  const placeOf = (item: Stored) =>
    item.place === "none"
      ? { kind: "none" as const, id: null, name: "All of lophn" }
      : item.place === "app"
      ? { kind: "app" as const, id: APP_ID, name: APP_NAME }
      : { kind: "project" as const, id: PROJECT, name: PROJECT_NAME };

  const detailOf = (key: string): AgentDetail => {
    const item = stored.get(key)!;
    const row = rowOf(key, item);
    const atProject = item.place === "project";
    const model = inheritedModel(item);
    return {
      assignment: key,
      draftId: null,
      role: item.role,
      kind: row.kind,
      place: placeOf(item),
      definition: item.definition,
      hash: item.hash,
      effective: {
        name: { value: item.name, source: "agent" },
        profile: { value: row.profile, source: "agent" },
      },
      inheritedModel: model,
      issues: [],
      skills: skillsFor(item, atProject),
      mcpServers: mcpFor(atProject),
      instructions: item.role === "lophn"
        ? null
        : { text: LOPHN_MD, project: PROJECT_NAME },
      places: [],
    };
  };

  const here = (project: string) => {
    const app = isAppPlace(project);
    return [...stored].filter(([, item]) =>
      item.place === "none" ||
      item.place === (app ? "app" : "project")
    );
  };

  return {
    calls,
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

    list(project) {
      return Promise.resolve(
        ok(here(project).map(([key, item]) => rowOf(key, item))),
      );
    },

    overview(project): Promise<ReadResult<AgentsOverview>> {
      if (overviewFailure !== null) {
        const message = overviewFailure;
        overviewFailure = null;
        return Promise.resolve({ ok: false, message });
      }
      const atProject = !isAppPlace(project);
      return Promise.resolve(ok({
        agents: here(project).filter(([, item]) => item.place !== "none")
          .map(([key, item]) => rowOf(key, item)),
        instructions: { text: LOPHN_MD, project: PROJECT_NAME },
        projectModel: { chosen: projectModel, inherited: GLOBAL_MODEL },
        skills: skillsFor({ role: "operator" } as Stored, atProject),
        mcpServers: mcpFor(atProject),
      }));
    },

    models(): Promise<ReadResult<ModelsView>> {
      const kind = options.providers ?? "built_in";
      const builtIn = (id: string, name: string, definition: string) => ({
        id,
        name,
        definition,
        kind: "api_key",
        reportedModels: null,
        refreshable: false,
      });
      return Promise.resolve(ok({
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
            ? [{
              id: CUSTOM_PROVIDER,
              name: "Local server",
              definition: CUSTOM_DEFINITION,
              kind: "api_key",
              reportedModels: customListed
                ? ["llama-3.3-70b", "qwen-3-coder"]
                : null,
              refreshable: true,
            }]
            : []),
        ],
        catalog: [
          ...CATALOG,
          ...OTHER_CATALOG,
          ...userModels.items.map(userEntryOf),
        ],
        hidden,
      }));
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

    setHidden(items) {
      calls.push({ method: "setHidden", items });
      hidden = items;
      return Promise.resolve(ok(items));
    },

    userModels() {
      return Promise.resolve(ok(userModels));
    },

    saveModelInfo(item, seq) {
      calls.push({ method: "saveModelInfo", item, seq });
      const record: UserModelRecord = { ...item, saved_at: SAVED_AT };
      return Promise.resolve(changeUserModels(seq, [
        ...userModels.items.filter((one) => !sameKey(one, item)),
        record,
      ]));
    },

    removeModelInfo(key, seq) {
      calls.push({ method: "removeModelInfo", key, seq });
      return Promise.resolve(changeUserModels(
        seq,
        userModels.items.filter((one) => !sameKey(one, key)),
      ));
    },

    readAgent(_project, key) {
      return Promise.resolve(
        stored.has(key)
          ? ok(detailOf(key))
          : { ok: false, message: "not_found" },
      );
    },

    newOperator(project) {
      const inherited = projectModel ?? GLOBAL_MODEL;
      const app = isAppPlace(project);
      return Promise.resolve(ok(
        {
          assignment: null,
          draftId: `agt_${`nw${created + 1}`.padStart(26, "0")}`,
          role: "operator",
          kind: "operator",
          place: app
            ? { kind: "app", id: project, name: APP_NAME }
            : { kind: "project", id: project, name: PROJECT_NAME },
          definition: { body: "" },
          hash: null,
          effective: {
            name: { value: "", source: "global" },
            profile: { value: DEFAULT_PROFILE, source: "global" },
          },
          inheritedModel: {
            value: inherited,
            source: projectModel === null ? "global" : "project",
          },
          issues: [],
          skills: skillsFor({ role: "operator" } as Stored, !app),
          mcpServers: mcpFor(!app),
          instructions: { text: LOPHN_MD, project: PROJECT_NAME },
          places: [
            { kind: "project", id: PROJECT, name: PROJECT_NAME },
            { kind: "app", id: APP_ID, name: APP_NAME },
          ],
        } satisfies AgentDetail,
      ));
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
      const existing = input.assignment === null
        ? undefined
        : stored.get(input.assignment);
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
      const key = input.assignment ?? input.draftId ??
        `agt_${`nw${created}`.padStart(26, "0")}`;
      const hash = nextHash();
      stored.set(key, {
        role: existing?.role ?? "operator",
        place: existing?.place ??
          (input.place !== null && isAppPlace(input.place) ? "app" : "project"),
        name: input.definition.name ?? existing?.name ?? "",
        summary: existing?.summary ?? "",
        definition: input.definition,
        hash,
      });
      return Promise.resolve({ ok: true, value: { assignment: key, hash } });
    },

    deleteAgent(_project, key, hash) {
      calls.push({ method: "deleteAgent", assignment: key, hash });
      const existing = stored.get(key);
      if (existing === undefined) {
        return Promise.resolve({ ok: false, message: "not_found" });
      }
      if (existing.hash !== hash) {
        return Promise.resolve({ ok: false, message: "conflict" });
      }
      stored.delete(key);
      return Promise.resolve(ok(null));
    },

    uploadImage(_project, key, file) {
      calls.push({ method: "uploadImage", assignment: key, name: file.name });
      return Promise.resolve(ok({ image: "avatar.png" }));
    },

    imageSrc: () => AVATAR_SRC,

    setProjectModel(_project, choice) {
      calls.push({ method: "setProjectModel", choice });
      const failed = takeChangeFailure();
      if (failed !== null) return Promise.resolve(failed);
      projectModel = choice;
      return Promise.resolve(ok(null));
    },

    setSkill(_project, name, on) {
      calls.push({ method: "setSkill", name, on });
      const failed = takeChangeFailure();
      if (failed !== null) return Promise.resolve(failed);
      if (on) projectSkillOff.delete(name);
      else projectSkillOff.add(name);
      return Promise.resolve(ok(null));
    },

    setMcp(_project, name, on) {
      calls.push({ method: "setMcp", name, on });
      const failed = takeChangeFailure();
      if (failed !== null) return Promise.resolve(failed);
      if (on) projectMcpOff.delete(name);
      else projectMcpOff.add(name);
      return Promise.resolve(ok(null));
    },

    grants(_project, key): Promise<ReadResult<GrantsView>> {
      return Promise.resolve(ok({
        entries: grants.get(key) ?? [],
        catalog: {
          ...GRANT_CATALOG,
          // 자기 자신은 부를 대상이 아니다.
          agents: GRANT_CATALOG.agents.filter((target) =>
            target.agent.role === "coding_agent" ||
            keyOf(target.agent) !== key
          ),
        },
      }));
    },

    setGrants(_project, key, entries) {
      calls.push({ method: "setGrants", assignment: key, entries });
      const failed = takeChangeFailure();
      if (failed !== null) return Promise.resolve(failed);
      grants.set(key, entries);
      return Promise.resolve(ok(null));
    },
  };
}
