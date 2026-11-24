// AgentsSource를 제품 core로 잇는다. token·port는 main에 있고 이 쪽은 route 이름과 입력만 보낸다. agent는 AgentId로
// 가리킨다. 저장 거절(invalid_input)은 details의 항목별 이유를 issues로 그대로 싣는다.
// 자리는 "home"이거나 project·앱 id다. Home·project·앱이 같은 층(지침, skill 끄기, MCP, model)과 memory를 갖는다.
// avatar 이미지는 byte route(upload·file)로 올리고 읽는다. 읽은 이미지는 blob URL로 기억하고, 목록과 상세를
// 읽을 때 미리 받아 두어 imageSrc는 기다리지 않고 답한다.
import { t } from "@lophn/i18n";

import type { HarnessCatalogView } from "../../../../protocol/acp/harness-catalog.ts";
import type { HarnessSettingsView } from "../../../../protocol/coding-agent/coding-agents.ts";
import {
  type AgentCard,
  type AgentRow,
  agentChange,
  agentCreate,
  agentDelete,
} from "../../../../protocol/lophn-agent/agent-definitions.ts";
import { LOPHN_AGENT_HANDLE } from "../../../../protocol/lophn-agent/agent-values.ts";
import type { McpServer } from "../../../../protocol/lophn-agent/mcp-settings.ts";
import type {
  CatalogEntry,
  ModelChoice,
} from "../../../../protocol/lophn-agent/models.ts";
import {
  changeShownModels,
  removeUserModelInfo,
  saveUserModelInfo,
  workspaceModelChange,
} from "../../../../protocol/lophn-agent/models.ts";
import type { ProviderRecord } from "../../../../protocol/lophn-agent/provider-values.ts";
import { refreshProviderModels } from "../../../../protocol/lophn-agent/providers.ts";
import { isLophn } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { FilesApi } from "../../../ipc/files.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
import type { MemoryApi } from "../../../ipc/memory.ts";
import type { OpenExternalApi } from "../../../ipc/open-external.ts";
import type { SecretInputOpenApi } from "../../../ipc/secret-input.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import {
  enterSecret,
  windowLinkOpener,
  windowSecretInputOpener,
} from "../../desktop/settings/core-call.ts";
import {
  codingFromValue,
  DEFAULT_QUICK_PREFS,
} from "../../desktop/settings/quick-launch/source.ts";
import { isAgentId, isAppWorkspace, kindOfWorkspace } from "./agent-key.ts";
import {
  cancelMcpSignIn,
  changeWorkspaceSettings,
  instructionsTargetOf,
  memoryOpenOf,
  readAgentServerLogins,
  readGlobalModel,
  readInstructions,
  readServers,
  readSkills,
  signInMcpServer,
  windowFiles,
  windowInstructions,
  windowMemory,
  workspaceOf,
  writeInstructions,
} from "./core-extensions.ts";
import { readGrants, saveGrants } from "./core-grants.ts";
import { createLink, issuesOf, type Link, unavailable } from "./core-link.ts";
import { providerChoiceOf } from "./model-picker-data.ts";
import type {
  AgentCardView,
  AgentDetail,
  AgentDraft,
  AgentGlance,
  AgentListRow,
  AgentsOverview,
  AgentsSource,
  ModelsView,
  ReadResult,
  SaveInput,
  SaveResult,
  ShownModel,
  UserModels,
  WorkspaceView,
} from "./source.ts";
import type {
  InstructionsFile,
  MemoryTarget,
  WorkspaceInstructionsView,
} from "./views.ts";

/** 목록을 끝까지 모을 때 page 상한. */
const PAGE_LIMIT = 20;
// catalog는 항목이 많아 page가 많다(page당 row 예산이 있다).
const CATALOG_PAGE_LIMIT = 60;

/** agent ID의 본문: 소문자 Crockford base32 26자, 첫 글자는 0~7이다. */
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

const DEFAULT_AVATAR = {
  kind: "character",
  shape: "arch",
  color: "sage",
} as const;

interface AgentsDeps {
  /** 지침 파일의 경로를 알려 주는 main 통로. 없으면 지침은 읽지도 쓰지도 못한다(unavailable). */
  instructions: InstructionsApi | undefined;
  /** memory 파일의 경로를 알려 주는 main 통로. 없으면 memory는 읽지도 쓰지도 못한다(unavailable). */
  memory: MemoryApi | undefined;
  /** 지침·memory 파일을 읽고 쓰는 main file 통로. 없으면 읽지도 쓰지도 못한다(unavailable). */
  files: Pick<FilesApi, "read" | "write"> | undefined;
  /** command key의 무작위 부분. 테스트가 고정한다. */
  random: () => string;
  /** 새 agent ID의 무작위 byte. 테스트가 고정한다. */
  bytes: () => Uint8Array;
  /** MCP credential을 받는 보호 입력 창. */
  openSecret: SecretInputOpenApi["open"] | undefined;
  /** OAuth 로그인의 authorize 주소를 OS browser로 여는 통로. */
  openLink: OpenExternalApi["openExternal"] | undefined;
}

function newAgentId(bytes: Uint8Array): string {
  const body = Array.from(
    bytes.slice(0, 26),
    (byte, index) => CROCKFORD[index === 0 ? byte % 8 : byte % 32],
  ).join("");
  return `agt_${body}`;
}

// 정의가 틀려 읽지 못한 agent는 handle을 알 수 없어 명함이 없다(없는 handle로 읽으면 not_found).
function handleOf(agent: string, definition: AgentDraft | null): string {
  return isLophn(agent) ? LOPHN_AGENT_HANDLE : (definition?.handle ?? agent);
}

// 영문 소문자·숫자만 남긴 handle 기본값. 비면 사람이 정해야 한다.
function handleFromName(name: string | undefined): string | undefined {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug === "" ? undefined : slug;
}

function toRow(row: AgentRow): AgentListRow {
  return {
    assignment: row.agent,
    handle: row.handle,
    workspace: row.workspace,
    name: row.name,
    avatar: row.avatar,
    ...(row.runtime === undefined ? {} : { runtime: row.runtime }),
    ...(row.description === undefined ? {} : { description: row.description }),
    model:
      row.model === null
        ? null
        : {
            provider: row.model.provider,
            model_name: row.model.model_name,
            source: row.model.source,
          },
    issues: row.issues,
    counts: row.counts,
    browserProfile: row.browser_profile,
  };
}

export function coreAgentsSource(
  core: CoreSource,
  deps: Partial<AgentsDeps> = {},
): AgentsSource {
  const instructions =
    "instructions" in deps ? deps.instructions : windowInstructions();
  const memory = "memory" in deps ? deps.memory : windowMemory();
  const files = "files" in deps ? deps.files : windowFiles();
  const random = deps.random ?? (() => crypto.randomUUID());
  const bytes =
    deps.bytes ?? (() => crypto.getRandomValues(new Uint8Array(26)));
  const openSecret =
    "openSecret" in deps ? deps.openSecret : windowSecretInputOpener();
  const openLink = "openLink" in deps ? deps.openLink : windowLinkOpener();
  const link: Link = createLink(core, random);

  // 읽은 avatar 이미지의 blob URL. 키는 `<agent id>/<이미지 이름>`이다. 이름은 `avatar.<ext>` 하나뿐이라
  // 다시 올리면 uploadImage가 새 값으로 바꾼다.
  const images = new Map<string, string>();
  const loadImage = async (agent: string, image: string) => {
    if (images.has(`${agent}/${image}`)) return;
    try {
      const reply = await core.call({
        kind: "file",
        resource: "avatar-images",
        method: "read",
        body: { agent },
      });
      if (!reply.ok) return;
      const file = reply.value as { bytes: Uint8Array; contentType: string };
      images.set(
        `${agent}/${image}`,
        URL.createObjectURL(
          new Blob([file.bytes.slice()], { type: file.contentType }),
        ),
      );
    } catch {
      // 못 읽은 이미지는 빈 주소로 둔다.
    }
  };

  // 놓인 곳의 이름(Home, project의 title, 앱의 name). 읽지 못하면 빈 글이다.
  const nameOf = async (workspace: string): Promise<string> => {
    if (workspace === "home") return t("agents.label.workspace-home");
    if (isAppWorkspace(workspace)) {
      const app = await appOf(workspace);
      return app?.name ?? "";
    }
    const project = await link.read<{ project: { title: string } }>(
      "projects",
      "get",
      { project: workspace },
    );
    return project.ok ? project.value.project.title : "";
  };

  // 앱의 이름과 source 폴더가 이어졌는지. 읽지 못하면 null이다.
  const appOf = async (
    app: string,
  ): Promise<{ name: string; hasSource: boolean } | null> => {
    const read = await link.read<{
      app: { name: string; source_path: string | null };
    }>("apps", "get", { app });
    return read.ok
      ? {
          name: read.value.app.name,
          hasSource: read.value.app.source_path !== null,
        }
      : null;
  };

  const providers = async () => {
    // manageProviders가 provider별 한도(Codex의 운영 window 등)를 셀 수 있게 목록 응답을 그대로 담는다.
    const rows: ProviderRecord[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < PAGE_LIMIT; page += 1) {
      const result = await link.read<{
        providers: typeof rows;
        next_cursor: string | null;
      }>("providers", "list", cursor === undefined ? {} : { cursor });
      if (!result.ok) return result;
      rows.push(...result.value.providers);
      if (result.value.next_cursor === null) break;
      cursor = result.value.next_cursor;
    }
    return { ok: true as const, value: rows };
  };

  const shownModels = async () => {
    const result = await link.read<{
      shown: { items: ShownModel[]; settings_seq: string };
    }>("shown-models", "read", {});
    return result.ok
      ? {
          ok: true as const,
          value: {
            items: result.value.shown.items.map((item) => ({
              provider: item.provider,
              model_name: item.model_name,
            })),
            seq: result.value.shown.settings_seq,
          },
        }
      : result;
  };

  // 사람이 적은 model 정보. 읽기 입력에 cursor가 없어 한 번에 읽는다.
  const userModels = async (): Promise<ReadResult<UserModels>> => {
    const result = await link.read<UserModels>("user-model-info", "read", {});
    return result.ok
      ? {
          ok: true,
          value: { seq: result.value.seq, items: result.value.items },
        }
      : result;
  };

  // core 입력의 workspace. Home과 Settings는 없다(handle이 lophn이면 Home lophn이 먼저 걸린다).
  const scopeInput = (workspace: string | null) => {
    const scope = workspace === null ? null : workspaceOf(workspace);
    return scope === null ? {} : { workspace: scope };
  };

  // 명함은 core가 계산한다. 틀린 정의 file은 만들지 못해 없는 채로 둔다. workspace는 handle이 lophn일 때 어느 lophn인지 고른다
  // (없거나 home이면 Home).
  const cardOf = async (
    handle: string,
    workspace: string | null,
    browserProfile: string | null,
  ): Promise<AgentCardView | undefined> => {
    const read = await link.read<{ card: AgentCard }>("agents", "card", {
      handle,
      ...scopeInput(workspace),
    });
    return read.ok ? { ...read.value.card, browserProfile } : undefined;
  };

  // 전역 agent와 화면을 연 자리 범위 agent, 그 자리의 lophn이다. home은 자리 id가 없어 core가 모든 lophn을 내므로
  // 전역 agent와 Home lophn만 남긴다.
  const list = async (
    workspace: string,
  ): Promise<ReadResult<AgentListRow[]>> => {
    const result = await link.read<{ agents: AgentRow[] }>(
      "agents",
      "list",
      scopeInput(workspace),
    );
    if (!result.ok) return result;
    const rows = result.value.agents
      .map(toRow)
      .filter(
        (row) => row.workspace === null || row.workspace.id === workspace,
      );
    await Promise.all(
      rows.map((row) =>
        row.avatar.kind === "image"
          ? loadImage(row.assignment, row.avatar.image)
          : undefined,
      ),
    );
    return { ok: true, value: rows };
  };

  // 이번 저장에서 새로 생긴 bearer·api_key·oauth2 server의 값을 보호 입력으로 받는다. 값은 이 파일을 지나지 않는다.
  // 저장은 이미 끝났다. 창을 열지 못하거나 취소해도 되돌리지 않는다(전역 server 추가와 같다).
  const enterNewCredentials = async (
    servers: readonly McpServer[],
    before: readonly McpServer[],
  ) => {
    for (const server of servers) {
      if (server.transport !== "http") continue;
      if (before.some((one) => one.name === server.name)) continue;
      const auth = server.http.auth;
      const secret =
        auth.kind === "bearer" || auth.kind === "api_key"
          ? auth.credential.secret
          : auth.kind === "oauth2"
            ? auth.client_credential?.secret
            : undefined;
      if (secret === undefined) continue;
      await enterSecret(openSecret, {
        name: secret,
        purpose: "mcp",
        subject: server.name,
      });
    }
  };

  // 이 agent가 model을 고르지 않을 때 따르는 값. 위 층이 준 값이면 그대로, 아니면 전역 기본이다.
  const inheritedOf = async (
    effective: {
      value: ModelChoice;
      source: "global" | "project" | "agent" | "session";
    } | null,
  ) => {
    if (effective !== null && effective.source !== "agent") return effective;
    const global = await readGlobalModel(link);
    return global.ok && global.value !== null
      ? { value: global.value, source: "global" as const }
      : null;
  };

  const viewOf = async (workspace: string | null): Promise<WorkspaceView> => {
    if (workspace === null) return { kind: "none", id: null, name: "" };
    const kind = kindOfWorkspace(workspace);
    return {
      kind,
      id: kind === "home" ? null : workspace,
      name: await nameOf(workspace),
    };
  };

  // Home의 Agents 탭: 전역과 Home lophn에 모든 workspace의 범위 agent를 더한다(다른 workspace의 lophn은 뺀다).
  // 범위 agent는 줄마다 그 workspace의 이름을 달아 어느 범위인지 보인다.
  const listEverything = async (): Promise<ReadResult<AgentListRow[]>> => {
    const result = await link.read<{ agents: AgentRow[] }>(
      "agents",
      "list",
      {},
    );
    if (!result.ok) return result;
    const rows = await Promise.all(
      result.value.agents
        .map(toRow)
        .filter((row) => !isLophn(row.assignment) || row.workspace === null)
        .map(async (row) =>
          row.workspace === null
            ? row
            : { ...row, workspaceName: await nameOf(row.workspace.id) },
        ),
    );
    await Promise.all(
      rows.map((row) =>
        row.avatar.kind === "image"
          ? loadImage(row.assignment, row.avatar.image)
          : undefined,
      ),
    );
    return { ok: true, value: rows };
  };

  const detailOf = async (
    workspace: string | null,
    agent: string,
  ): Promise<ReadResult<AgentDetail>> => {
    if (!isAgentId(agent)) return { ok: false, message: "not_found" };
    const read = await link.read<{
      definition: AgentDraft | null;
      hash: string | null;
      effective: {
        name: {
          value: string;
          source: "global" | "project" | "agent" | "session";
        };
        avatar: {
          value: AgentListRow["avatar"];
          source: "global" | "project" | "agent" | "session";
        };
        model: {
          value: ModelChoice;
          source: "global" | "project" | "agent" | "session";
        } | null;
      };
      issues: AgentDetail["issues"];
    }>("agents", "read", {
      agent,
      ...scopeInput(workspace),
    });
    if (!read.ok) return read;
    const value = read.value;
    const workspaceView = await viewOf(workspace);
    const skills = await readSkills(link, workspace);
    if (!skills.ok) return skills;
    const servers = await readServers(link, workspace);
    if (!servers.ok) return servers;
    const text = workspace === null ? null : await instructionsOf(workspace);
    const saved = value.definition ?? { body: "" };
    // lophn은 따로 agent memory가 없다(workspace memory를 쓴다).
    const memory = isLophn(agent)
      ? null
      : await readMemoryFile({ kind: "agent", agent });
    const card = await cardOf(
      handleOf(agent, value.definition),
      workspace,
      saved.browser_profile ?? null,
    );
    if (value.effective.avatar.value.kind === "image") {
      await loadImage(agent, value.effective.avatar.value.image);
    }
    return {
      ok: true,
      value: {
        assignment: agent,
        draftId: null,
        workspace: workspaceView,
        definition: saved,
        hash: value.hash,
        effective: {
          name: value.effective.name,
          avatar: value.effective.avatar,
        },
        inheritedModel: await inheritedOf(value.effective.model),
        issues: value.issues,
        ...(card === undefined ? {} : { card }),
        skills: skills.value,
        mcpServers: servers.value,
        agentMcpLogins: await readAgentServerLogins(
          link,
          agent,
          saved.mcp_servers ?? [],
        ),
        instructions: text,
        memory,
      },
    };
  };

  // 카드 앞면의 요약은 정의 file에서 센다(effort, 지침 유무, 할당 앱 수). 틀린 정의 file이나 읽지 못한 agent는 없다.
  const glanceOf = async (
    agent: string,
    workspace: string,
    global: ModelChoice | null,
  ): Promise<AgentGlance | undefined> => {
    const read = await link.read<{
      definition:
        | (AgentDraft & {
            apps?: readonly string[];
            remote_apps?: readonly unknown[];
          })
        | null;
      effective: { model: { value: ModelChoice } | null };
      issues: readonly unknown[];
    }>("agents", "read", { agent, ...scopeInput(workspace) });
    if (!read.ok || read.value.issues.length > 0) return undefined;
    const definition = read.value.definition ?? { body: "" };
    return {
      model: read.value.effective.model?.value ?? global,
      ...(definition.harness_config === undefined
        ? {}
        : { harnessConfig: definition.harness_config }),
      instructions: definition.body.trim() !== "",
      apps: definition.apps?.length ?? 0,
      remoteApps: definition.remote_apps?.length ?? 0,
      tools: definition.tools ?? [],
      skip: definition.skip === true,
    };
  };

  // workspace 지침. project와 Home은 LOPHN.md, 앱은 source 폴더의 AGENTS.md다. 읽지 못하면 빈 글이다.
  // source를 잇지 않은 앱은 파일이 놓일 곳이 없어 빈 글이고 고치지 못한다.
  const instructionsOf = async (
    workspace: string,
  ): Promise<WorkspaceInstructionsView> => {
    const app = isAppWorkspace(workspace) ? await appOf(workspace) : null;
    const file = isAppWorkspace(workspace) ? "AGENTS.md" : "LOPHN.md";
    const name = await nameOf(workspace);
    if (app !== null && !app.hasSource) {
      return { text: "", hash: null, workspace: name, file, editable: false };
    }
    const read = await readInstructions(
      instructions,
      files,
      instructionsTargetOf(workspace),
    );
    return {
      ...(read.ok ? read.value : { text: "", hash: null }),
      workspace: name,
      file,
      editable: true,
    };
  };

  // memory는 파일이 없거나 읽지 못하면 빈 글이다. 화면은 읽지 못했다고 따로 알리지 않는다.
  const readMemoryFile = async (
    target: MemoryTarget,
  ): Promise<InstructionsFile> => {
    const read = await readInstructions(memory, files, memoryOpenOf(target));
    return read.ok ? read.value : { text: "", hash: null };
  };

  return {
    list,

    // workspace 없이 부르면 core가 모든 lophn을 낸다(`list`는 이 중 한 workspace의 것만 남긴다).
    async lophnNames() {
      const result = await link.read<{ agents: AgentRow[] }>(
        "agents",
        "list",
        {},
      );
      if (!result.ok) return result;
      return {
        ok: true,
        value: Object.fromEntries(
          result.value.agents
            .filter((row) => isLophn(row.agent))
            .map((row) => [row.agent, row.name]),
        ),
      };
    },

    async overview(workspace) {
      const agents =
        workspace === "home" ? await listEverything() : await list(workspace);
      if (!agents.ok) return agents;
      const skills = await readSkills(link, workspace);
      if (!skills.ok) return skills;
      const servers = await readServers(link, workspace);
      if (!servers.ok) return servers;
      const global = await readGlobalModel(link);
      const chosen = await link.read<{ model: ModelChoice | null }>(
        "workspace-model",
        "read",
        { workspace },
      );
      const view: AgentsOverview = {
        agents: await Promise.all(
          agents.value.map(async (row) => {
            const card = await cardOf(
              row.handle,
              row.workspace?.id ?? workspace,
              row.browserProfile,
            );
            const glance = await glanceOf(
              row.assignment,
              row.workspace?.id ?? workspace,
              global.ok ? global.value : null,
            );
            return {
              ...row,
              ...(card === undefined ? {} : { card }),
              ...(glance === undefined ? {} : { glance }),
            };
          }),
        ),
        instructions: await instructionsOf(workspace),
        workspaceModel: {
          chosen: chosen.ok ? chosen.value.model : null,
          inherited: global.ok ? global.value : null,
        },
        skills: skills.value,
        mcpServers: servers.value,
        memory: await readMemoryFile({ kind: "workspace", workspace }),
      };
      return { ok: true, value: view };
    },

    async models() {
      const registered = await providers();
      if (!registered.ok) return registered;
      // custom provider인지는 내장 정의 목록이 정한다. catalog의 model 유무로 보면 사람이 적은 override가 내장 provider를 custom으로 만든다.
      const definitions = await link.read<{
        definitions: { key: string }[];
      }>("providers", "definitions", {});
      if (!definitions.ok) return definitions;
      const builtin: Record<string, true> = {};
      for (const definition of definitions.value.definitions) {
        builtin[definition.key] = true;
      }
      // 사람이 적은 한도는 그 model의 저장된 정보에만 있다. 못 읽으면 한도 표시만 provider·catalog 기본값을 따른다.
      const stored = await userModels();
      const userItems = stored.ok ? stored.value.items : [];
      // catalog는 한 응답 한도를 넘어 cursor로 이어 읽는다.
      const entries: CatalogEntry[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < CATALOG_PAGE_LIMIT; page += 1) {
        const catalog = await link.read<{
          entries: CatalogEntry[];
          next_cursor: string | null;
        }>(
          "agent-model-catalog",
          "read",
          cursor === undefined ? {} : { cursor },
        );
        if (!catalog.ok) return catalog;
        entries.push(...catalog.value.entries);
        if (catalog.value.next_cursor === null) break;
        cursor = catalog.value.next_cursor;
      }
      const shown = await shownModels();
      if (!shown.ok) return shown;
      const view: ModelsView = {
        providers: registered.value.map((provider) =>
          providerChoiceOf(provider, entries, builtin, userItems),
        ),
        catalog: entries,
        shown: shown.value.items,
      };
      return { ok: true, value: view };
    },

    async refreshModels(provider) {
      const refreshed = await link.command(refreshProviderModels, {
        input: { provider },
        compare: {},
      });
      return refreshed.ok;
    },

    async setShown(items) {
      const current = await shownModels();
      if (!current.ok) return current;
      const changed = await link.command(changeShownModels, {
        input: { items },
        compare: { settings_seq: current.value.seq },
      });
      return changed.ok
        ? { ok: true, value: changed.value.shown.items }
        : { ok: false, message: changed.code };
    },

    async userModels() {
      return await userModels();
    },

    async saveModelInfo(item, seq) {
      const saved = await link.command(saveUserModelInfo, {
        input: item,
        compare: { seq },
      });
      return saved.ok
        ? { ok: true, value: saved.value }
        : { ok: false, message: saved.code };
    },

    async removeModelInfo(key, seq) {
      const removed = await link.command(removeUserModelInfo, {
        input: key,
        compare: { seq },
      });
      return removed.ok
        ? { ok: true, value: removed.value }
        : { ok: false, message: removed.code };
    },

    readAgent: (project, agent) => detailOf(project, agent),

    async newAgent(workspace) {
      const current = await viewOf(workspace);
      const scope = workspace === null ? null : workspaceOf(workspace);
      const draftId = newAgentId(bytes());
      const skills = await readSkills(link, workspace);
      if (!skills.ok) return skills;
      const servers = await readServers(link, workspace);
      if (!servers.ok) return servers;
      const text = workspace === null ? null : await instructionsOf(workspace);
      const global = await readGlobalModel(link);
      const detail: AgentDetail = {
        assignment: null,
        draftId,
        workspace: current,
        // 새 agent의 범위는 화면을 연 자리가 기본이다(Home과 Settings는 전역뿐). 편집기에서 전역으로 바꿀 수 있다.
        definition:
          scope === null ? { body: "" } : { body: "", workspace: scope },
        hash: null,
        effective: {
          name: { value: "", source: "global" },
          avatar: { value: DEFAULT_AVATAR, source: "global" },
        },
        inheritedModel:
          global.ok && global.value !== null
            ? { value: global.value, source: "global" }
            : null,
        issues: [],
        skills: skills.value,
        mcpServers: servers.value,
        agentMcpLogins: {},
        instructions: text,
        memory: null,
      };
      return { ok: true, value: detail };
    },

    async saveAgent(_project, input: SaveInput): Promise<SaveResult> {
      const failed = (reply: { code: string; error: unknown }): SaveResult => ({
        ok: false,
        message: reply.code,
        issues: reply.code === "invalid_input" ? issuesOf(reply.error) : [],
      });
      const draft = input.definition;
      if (input.assignment === null) {
        const id = input.draftId ?? newAgentId(bytes());
        const handle = draft.handle ?? handleFromName(draft.name);
        const created = await link.command(agentCreate, {
          input: {
            id,
            definition: {
              ...draft,
              ...(handle === undefined ? {} : { handle }),
            },
          },
          compare: {},
        });
        if (!created.ok) return failed(created);
        await enterNewCredentials(draft.mcp_servers ?? [], []);
        return {
          ok: true,
          value: {
            assignment: created.value.agent,
            hash: created.value.hash,
          },
        };
      }
      if (!isAgentId(input.assignment)) {
        return { ok: false, message: "not_found", issues: [] };
      }
      // 이번 저장에서 새로 생긴 server를 가리려고, 그리고 lophn의 잠긴 handle·avatar를 그대로 보내려고 읽는다.
      const before = await link.read<{
        definition: AgentDraft | null;
        effective: {
          name: { value: string };
          avatar: { value: AgentListRow["avatar"] };
        };
      }>("agents", "read", { agent: input.assignment });
      if (!before.ok) {
        return { ok: false, message: before.message, issues: [] };
      }
      const stored = before.value.definition;
      const definition: AgentDraft = isLophn(input.assignment)
        ? {
            ...draft,
            handle: LOPHN_AGENT_HANDLE,
            name: draft.name ?? before.value.effective.name.value,
            avatar: stored?.avatar ?? before.value.effective.avatar.value,
          }
        : draft;
      const saved = await link.command(agentChange, {
        input: { agent: input.assignment, definition },
        compare: { hash: input.hash },
      });
      if (!saved.ok) return failed(saved);
      await enterNewCredentials(
        definition.mcp_servers ?? [],
        stored?.mcp_servers ?? [],
      );
      return {
        ok: true,
        value: { assignment: input.assignment, hash: saved.value.hash },
      };
    },

    async deleteAgent(_project, agent, hash, cleanUp) {
      const deleted = await link.command(agentDelete, {
        input: {
          agent,
          ...(cleanUp === undefined ? {} : { clean_up: cleanUp }),
        },
        compare: { hash },
      });
      return deleted.ok
        ? {
            ok: true,
            value: {
              handoff_session: deleted.value.handoff_session ?? null,
            },
          }
        : { ok: false, message: deleted.code };
    },

    async uploadImage(_project, agent, file) {
      if (!isAgentId(agent)) return { ok: false, message: "not_found" };
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        return unavailable;
      }
      const uploaded = await core.call({
        kind: "upload",
        resource: "avatar-images",
        method: "upload",
        body: { agent, content_type: file.type, bytes: bytes.byteLength },
        bytes,
      });
      if (!uploaded.ok) {
        return { ok: false, message: uploaded.error?.code ?? "internal" };
      }
      const image = (uploaded.value as { avatar: { image: string } }).avatar
        .image;
      images.set(`${agent}/${image}`, URL.createObjectURL(file));
      return { ok: true, value: { image } };
    },

    imageSrc: (_workspace, agent, image) =>
      images.get(`${agent}/${image}`) ?? "",

    async setWorkspaceModel(workspace, choice) {
      const changed = await link.command(workspaceModelChange, {
        input: { workspace, model: choice },
        compare: {},
      });
      return changed.ok
        ? { ok: true, value: null }
        : { ok: false, message: changed.code };
    },

    // workspace 층에서 skill을 켜고 끈다. 끈 이름은 workspace 설정 파일의 skills_off에 둔다(agent 정의의 skills_off와 다른 층이다).
    setSkill(workspace, name, on) {
      return changeWorkspaceSettings(link, workspace, (current) => ({
        ...current,
        skillsOff: on
          ? current.skillsOff.filter((one) => one !== name)
          : [...new Set([...current.skillsOff, name])],
      }));
    },

    // workspace 층 server는 enabled를 바꾸고, 전역 server는 이 workspace에서 끈 이름(mcp_off)에 넣고 뺀다.
    setMcp(workspace, name, on) {
      return changeWorkspaceSettings(link, workspace, (current) => {
        if (current.servers.some((server) => server.name === name)) {
          return {
            ...current,
            servers: current.servers.map((server) =>
              server.name === name ? { ...server, enabled: on } : server,
            ),
          };
        }
        return {
          ...current,
          mcpOff: on
            ? current.mcpOff.filter((one) => one !== name)
            : [...new Set([...current.mcpOff, name])],
        };
      });
    },

    signInMcp: (name, login) =>
      signInMcpServer(link, openLink, { name, login }),

    cancelMcpSignIn: (name, login) => cancelMcpSignIn(link, { name, login }),

    enterMcpSecret: async (name, server) => {
      await enterSecret(openSecret, { name, purpose: "mcp", subject: server });
    },

    grants: (project, agent) => readGrants(link, project, agent),

    setGrants: (project, agent, entries, revision) =>
      saveGrants(link, project, agent, entries, revision),

    readInstructions: (workspace) =>
      readInstructions(instructions, files, instructionsTargetOf(workspace)),

    writeInstructions: (workspace, text, hash) =>
      writeInstructions(
        instructions,
        files,
        instructionsTargetOf(workspace),
        text,
        hash,
      ),

    readMemory: (target) =>
      readInstructions(memory, files, memoryOpenOf(target)),

    writeMemory: (target, text, hash) =>
      writeInstructions(memory, files, memoryOpenOf(target), text, hash),

    async harnessCatalog(harness, probe, workspace = null) {
      return (await link.read("harness_catalog", "read", {
        harness,
        ...scopeInput(workspace),
        ...(probe === undefined ? {} : { probe }),
      })) as ReadResult<HarnessCatalogView>;
    },

    async refreshHarnessCatalog(harness, workspace = null) {
      return (await link.memory("harness_catalog", "refresh", {
        harness,
        ...scopeInput(workspace),
      })) as ReadResult<HarnessCatalogView>;
    },

    async codingChoices() {
      type SettingsListOut = {
        settings: { key: string; default?: unknown; chosen?: unknown }[];
      };
      type CodingAgentsListOut = { harnesses: HarnessSettingsView[] };
      const [settings, harnesses] = await Promise.all([
        link.memory("settings", "list", {
          keys: ["shell.coding_agents"],
        }) as Promise<ReadResult<SettingsListOut>>,
        link.read("coding_agents", "list", {}) as Promise<
          ReadResult<CodingAgentsListOut>
        >,
      ]);
      const entry = settings.ok
        ? settings.value.settings.find(
            (one) => one.key === "shell.coding_agents",
          )
        : undefined;
      const favorites =
        entry === undefined
          ? DEFAULT_QUICK_PREFS.coding.favorites
          : codingFromValue(entry.chosen ?? entry.default).favorites;
      const detected = harnesses.ok
        ? harnesses.value.harnesses
            .filter((one) => one.discovery === "detected")
            .map((one) => one.harness_id)
        : [];
      return { ok: true, value: { favorites, detected } };
    },
  };
}
