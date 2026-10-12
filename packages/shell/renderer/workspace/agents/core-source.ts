// AgentsSource를 제품 core로 잇는다(shell/workspace#R36~R44). token·port는 main에 있고 이 쪽은 route 이름과
// 입력만 보낸다. 응답은 main의 contract client가 route output schema로 이미 검사했으므로 화면이 읽는 field만
// 골라 source 모양으로 옮긴다. 실패는 core의 오류 code(`not_found`, `conflict`, `unavailable`…)를 message로
// 돌려주고, 저장 거절(invalid_input)은 details의 항목별 이유(R24)를 issues로 그대로 싣는다.
//
// 자리 설정과 자리의 MCP server 목록은 파일 전체를 덮어쓰는 route(`ChangePlaceAgentSettings`·
// `ChangePlaceExtensionSettings`)라서 하나를 바꿀 때 그 자리에서 읽은 값 위에 그 칸만 바꿔 읽을 때의 hash로 보낸다.
// 아래는 route가 없어 unavailable로 답하는 것이다.
// - project 단위 skill 켬·끔: skill을 끄는 route는 전역(`skills_off`)과 agent 정의뿐이다.
// - profile 이미지 올리기·읽기: 이미지 바이트 route(upload·file)는 renderer가 부를 수 있는 통로(CoreCall)에 없다.
import type {
  AgentDefinition,
  AgentIssue,
  AgentListRow,
  ValueSource,
} from "../../../../protocol/lophn-agent/agent-values.ts";
import type {
  CatalogEntry,
  ModelChoice,
} from "../../../../protocol/lophn-agent/models.ts";
import type { AgentRole } from "../../../../protocol/lophn-agent/scope.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import type { ReadResult } from "../source.ts";
import type {
  AgentDetail,
  AgentsOverview,
  AgentsSource,
  EffectiveModel,
  ModelFavorite,
  ModelsView,
  SaveInput,
  SaveResult,
} from "./source.ts";
import type { AgentEffective, PermissionRow, ToggleRow } from "./views.ts";

/** 목록을 끝까지 모을 때 page 상한. */
const PAGE_LIMIT = 20;

/** 새 Operator가 보이는 얼굴: 정의에 profile이 없으면 모르는 id로 기본 icon을 그린다. */
const DEFAULT_PROFILE = { kind: "icon", icon: "default" } as const;
const DEFAULT_SOURCE: ValueSource = { layer: "default", place: null };

interface PlaceSettingsValue {
  settings: {
    models?: Partial<Record<AgentRole, ModelChoice>>;
    permissions?: { tools: string[] };
  };
  hash: string | null;
  effective_models: Partial<Record<AgentRole, EffectiveModel>>;
}

interface McpServerValue {
  name: string;
  enabled: boolean;
}

interface ExtensionsValue {
  settings: { mcp_servers: McpServerValue[] };
  hash: string | null;
  skills: { name: string }[];
}

interface AgentValue {
  assignment: string;
  role: AgentRole;
  kind: "built_in" | "operator";
  definition: AgentDefinition | null;
  hash: string | null;
  effective: AgentEffective;
  issues: AgentIssue[];
}

interface ProviderValue {
  id: string;
  name: string;
  definition: { key: string };
}

export interface AgentsDeps {
  /** project의 LOPHN.md를 여는 main 통로. 없으면 지침 미리보기는 빈 글이다. */
  instructions: InstructionsApi | undefined;
  /** command key의 무작위 부분. 테스트가 고정한다. */
  random: () => string;
}

function windowInstructions(): InstructionsApi | undefined {
  const bridge = (globalThis as { lophnInstructions?: InstructionsApi })
    .lophnInstructions;
  return bridge && typeof bridge.open === "function" ? bridge : undefined;
}

// 자리는 id 접두사가 정한다(`app_…`는 앱 자리, 그 밖은 project). 앱 공간의 관리 화면이 같은 source를 쓴다.
const isApp = (place: string) => place.startsWith("app_");
const placeOf = (place: string) => ({
  kind: isApp(place) ? "app" : "project",
  id: place,
});

/** 오류의 details가 항목별 이유 목록이면 그대로, 아니면 빈 목록이다(이유를 꾸며 내지 않는다). */
function issuesOf(error: unknown): AgentIssue[] {
  const details = (error as { details?: { issues?: unknown } } | undefined)
    ?.details;
  const issues = details?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue) =>
    typeof issue?.field === "string" && typeof issue?.code === "string"
      ? [{ field: issue.field, code: issue.code } as AgentIssue]
      : []
  );
}

function withoutRole<T>(
  record: Partial<Record<AgentRole, T>> | undefined,
  role: AgentRole,
): Partial<Record<AgentRole, T>> {
  const { [role]: _removed, ...rest } = record ?? {};
  return rest;
}

export function coreAgentsSource(
  core: CoreSource,
  deps: Partial<AgentsDeps> = {},
): AgentsSource {
  const instructions = "instructions" in deps
    ? deps.instructions
    : windowInstructions();
  const random = deps.random ?? (() => crypto.randomUUID());

  const call = async (
    kind: "read" | "command" | "worker",
    resource: string,
    method: string,
    body: unknown,
  ): Promise<
    | { ok: true; value: unknown }
    | { ok: false; code: string; error: unknown }
  > => {
    try {
      const reply = await core.call({ kind, resource, method, body });
      return reply.ok ? { ok: true, value: reply.value } : {
        ok: false,
        code: reply.error?.code ?? "internal",
        error: reply.error,
      };
    } catch {
      return { ok: false, code: "unavailable", error: undefined };
    }
  };

  const read = async <V>(
    resource: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<ReadResult<V>> => {
    const reply = await call("read", resource, method, body);
    return reply.ok
      ? { ok: true, value: reply.value as V }
      : { ok: false, message: reply.code };
  };

  const command = async <V>(
    resource: string,
    method: string,
    input: unknown,
    compare: Record<string, unknown>,
  ) =>
    await call("command", resource, method, {
      input,
      idempotency_key: `${resource}-${method}-${random()}`,
      compare,
      prepared: [],
    }) as
      | { ok: true; value: V }
      | { ok: false; code: string; error: unknown };

  const unavailable: ReadResult<never> = {
    ok: false,
    message: "unavailable",
  };

  // 여러 칸을 한 파일에 쓰는 자리 설정을 읽고, 바꾼 값을 읽을 때의 hash로 보낸다.
  const changeSettings = async (
    project: string,
    change: (
      settings: PlaceSettingsValue["settings"],
    ) => PlaceSettingsValue["settings"],
  ): Promise<ReadResult<null>> => {
    const place = placeOf(project);
    const current = await read<PlaceSettingsValue>(
      "place-agent-settings",
      "read",
      { place },
    );
    if (!current.ok) return current;
    const changed = await command(
      "place-agent-settings",
      "change",
      { place, settings: change(current.value.settings) },
      { hash: current.value.hash },
    );
    return changed.ok
      ? { ok: true, value: null }
      : { ok: false, message: changed.code };
  };

  const projectInstructions = async (project: string): Promise<string> => {
    if (instructions === undefined) return "";
    try {
      const opened = await instructions.open({
        target: { layer: isApp(project) ? "app" : "project", place: project },
      });
      if (
        !opened.ok || opened.value.document === null ||
        opened.value.version === null
      ) {
        return "";
      }
      const page = await call("worker", "documents", "read", {
        reference: {
          document: opened.value.document,
          version: opened.value.version,
          section: null,
        },
      });
      return page.ok ? (page.value as { text: string | null }).text ?? "" : "";
    } catch {
      return "";
    }
  };

  const providers = async (): Promise<ReadResult<ProviderValue[]>> => {
    const rows: ProviderValue[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < PAGE_LIMIT; page += 1) {
      const result = await read<
        { providers: ProviderValue[]; next_cursor: string | null }
      >("providers", "list", cursor === undefined ? {} : { cursor });
      if (!result.ok) return result;
      rows.push(...result.value.providers);
      if (result.value.next_cursor === null) break;
      cursor = result.value.next_cursor;
    }
    return { ok: true, value: rows };
  };

  const favorites = async () => {
    const result = await read<
      { favorites: { items: ModelFavorite[]; settings_seq: string } }
    >("model-favorites", "read", {});
    return result.ok
      ? {
        ok: true as const,
        value: {
          items: result.value.favorites.items.map((item) => ({
            provider: item.provider,
            model_name: item.model_name,
          })),
          seq: result.value.favorites.settings_seq,
        },
      }
      : result;
  };

  const list = async (
    project: string,
  ): Promise<ReadResult<AgentListRow[]>> => {
    const result = await read<{ agents: AgentListRow[] }>("agents", "list", {
      place: placeOf(project),
    });
    return result.ok ? { ok: true, value: result.value.agents } : result;
  };

  return {
    list,

    async overview(project) {
      // core reader는 한 사람의 동시 읽기 수를 제한하므로 하나씩 읽는다.
      const place = placeOf(project);
      const agents = await list(project);
      if (!agents.ok) return agents;
      const settings = await read<PlaceSettingsValue>(
        "place-agent-settings",
        "read",
        { place },
      );
      if (!settings.ok) return settings;
      // 확장 설정을 못 읽으면 skill·MCP 칸만 비운다.
      const extensions = await read<ExtensionsValue>(
        "place-extension-settings",
        "read",
        { place },
      );
      const off = extensions.ok
        ? await read<{ skills_off: string[] }>("global-skills", "read", {})
        : null;
      const skillsOff = off?.ok ? off.value.skills_off : [];
      const skills: ToggleRow[] = extensions.ok
        ? extensions.value.skills.map((skill) => ({
          name: skill.name,
          on: !skillsOff.includes(skill.name),
        }))
        : [];
      const mcpServers: ToggleRow[] = extensions.ok
        ? extensions.value.settings.mcp_servers.map((server) => ({
          name: server.name,
          on: server.enabled,
        }))
        : [];
      const permissions: PermissionRow[] =
        (settings.value.settings.permissions?.tools ?? []).map((tool) => ({
          tool,
          label: tool,
          on: true,
        }));
      const view: AgentsOverview = {
        agents: agents.value,
        instructions: { text: await projectInstructions(project) },
        chosenModels: settings.value.settings.models ?? {},
        effectiveModels: settings.value.effective_models,
        skills,
        mcpServers,
        permissions,
      };
      return { ok: true, value: view };
    },

    async models() {
      const registered = await providers();
      if (!registered.ok) return registered;
      const catalog = await read<{ entries: CatalogEntry[] }>(
        "agent-model-catalog",
        "read",
        {},
      );
      if (!catalog.ok) return catalog;
      const starred = await favorites();
      if (!starred.ok) return starred;
      const view: ModelsView = {
        providers: registered.value.map((provider) => ({
          id: provider.id,
          name: provider.name,
          definition: provider.definition.key,
        })),
        catalog: catalog.value.entries,
        favorites: starred.value.items,
      };
      return { ok: true, value: view };
    },

    async setFavorites(items) {
      const current = await favorites();
      if (!current.ok) return current;
      const changed = await command<
        { favorites: { items: ModelFavorite[] } }
      >(
        "model-favorites",
        "change",
        { items },
        { settings_seq: current.value.seq },
      );
      return changed.ok
        ? { ok: true, value: changed.value.favorites.items }
        : { ok: false, message: changed.code };
    },

    async readAgent(project, assignment) {
      const result = await read<AgentValue>("agents", "read", {
        place: placeOf(project),
        assignment,
      });
      if (!result.ok) return result;
      const value = result.value;
      const detail: AgentDetail = {
        assignment: value.assignment,
        role: value.role,
        kind: value.kind,
        definition: value.definition ?? { body: "" },
        hash: value.hash,
        effective: value.effective,
        issues: value.issues,
      };
      return { ok: true, value: detail };
    },

    async newOperator(project) {
      const settings = await read<PlaceSettingsValue>(
        "place-agent-settings",
        "read",
        { place: placeOf(project) },
      );
      if (!settings.ok) return settings;
      const model = settings.value.effective_models.operator ?? null;
      const detail: AgentDetail = {
        assignment: null,
        role: "operator",
        kind: "operator",
        definition: { body: "" },
        hash: null,
        effective: {
          name: { value: "", source: DEFAULT_SOURCE },
          profile: { value: DEFAULT_PROFILE, source: DEFAULT_SOURCE },
          model,
          permissions: {
            value: {
              tools: settings.value.settings.permissions?.tools ?? [],
            },
            source: DEFAULT_SOURCE,
          },
        },
        issues: [],
      };
      return { ok: true, value: detail };
    },

    async saveAgent(project, input: SaveInput): Promise<SaveResult> {
      const saved = await command<
        { assignment: string; role: AgentRole; hash: string }
      >(
        "agents",
        "save",
        {
          place: placeOf(project),
          ...(input.assignment === null
            ? {}
            : { assignment: input.assignment }),
          definition: input.definition,
        },
        { hash: input.hash },
      );
      return saved.ok ? { ok: true, value: saved.value } : {
        ok: false,
        message: saved.code,
        issues: saved.code === "invalid_input" ? issuesOf(saved.error) : [],
      };
    },

    async deleteAgent(_project, assignment, hash) {
      const deleted = await command(
        "agents",
        "delete",
        { assignment },
        { hash },
      );
      return deleted.ok
        ? { ok: true, value: null }
        : { ok: false, message: deleted.code };
    },

    uploadImage: () => Promise.resolve(unavailable),

    imageSrc: () => "",

    changeRoleModel: (project, role, choice) =>
      changeSettings(project, (settings) => {
        const models = choice === null
          ? withoutRole(settings.models, role)
          : { ...settings.models, [role]: choice };
        const { models: _old, ...rest } = settings;
        return Object.keys(models).length === 0 ? rest : { models, ...rest };
      }),

    setSkill: () => Promise.resolve(unavailable),

    async setMcp(project, name, on) {
      const place = placeOf(project);
      const current = await read<
        {
          settings: { mcp_servers: McpServerValue[] };
          hash: string | null;
        }
      >("place-extension-settings", "read", { place });
      if (!current.ok) return current;
      const servers = current.value.settings.mcp_servers;
      if (!servers.some((server) => server.name === name)) {
        return { ok: false, message: "not_found" };
      }
      const changed = await command(
        "place-extension-settings",
        "change",
        {
          place,
          mcp_servers: servers.map((server) =>
            server.name === name ? { ...server, enabled: on } : server
          ),
        },
        { hash: current.value.hash },
      );
      return changed.ok
        ? { ok: true, value: null }
        : { ok: false, message: changed.code };
    },

    setPermission: (project, tool, on) =>
      changeSettings(project, (settings) => {
        const tools = settings.permissions?.tools ?? [];
        const next = on
          ? (tools.includes(tool) ? tools : [...tools, tool])
          : tools.filter((each) => each !== tool);
        return { ...settings, permissions: { tools: next } };
      }),
  };
}
