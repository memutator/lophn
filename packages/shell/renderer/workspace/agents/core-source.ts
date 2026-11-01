// AgentsSource를 제품 core로 잇는다. token·port는 main에 있고 이 쪽은 route 이름과 입력만 보낸다. agent는 AgentId로
// 가리킨다. 저장 거절(invalid_input)은 details의 항목별 이유를 issues로 그대로 싣는다.
// 앱 자리에는 project 층이 없어 project 층 model 고르기, skill 켬·끔, server 켬·끔은 unavailable로 답한다.
// profile 이미지는 byte route(upload·file)로 올리고 읽는다. 읽은 이미지는 blob URL로 기억하고, 목록과 상세를
// 읽을 때 미리 받아 두어 imageSrc는 기다리지 않고 답한다.
import {
  agentChange,
  agentCreate,
  agentDelete,
  type AgentRow,
} from "../../../../protocol/lophn-agent/agent-definitions.ts";
import type { McpServer } from "../../../../protocol/lophn-agent/mcp-settings.ts";
import type {
  CatalogEntry,
  ModelChoice,
} from "../../../../protocol/lophn-agent/models.ts";
import {
  changeShownModels,
  projectModelChange,
  removeUserModelInfo,
  saveUserModelInfo,
} from "../../../../protocol/lophn-agent/models.ts";
import { refreshProviderModels } from "../../../../protocol/lophn-agent/providers.ts";
import { LOPHN_AGENT_ID } from "../../../../protocol/lophn-agent/places.ts";
import type { FilesApi } from "../../../ipc/files.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
import type { OpenExternalApi } from "../../../ipc/open-external.ts";
import type { SecretInputOpenApi } from "../../../ipc/secret-input.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import {
  enterSecret,
  windowLinkOpener,
  windowSecretInputOpener,
} from "../../desktop/settings/core-call.ts";
import type { DomainView } from "../source.ts";
import { isAgentId, isAppPlace } from "./agent-key.ts";
import {
  cancelMcpSignIn,
  changeProjectSettings,
  placeOf,
  readGlobalModel,
  readAgentServerLogins,
  readInstructions,
  windowFiles,
  windowInstructions,
  writeInstructions,
  readServers,
  readSkills,
  signInMcpServer,
} from "./core-extensions.ts";
import { readGrants, saveGrants } from "./core-grants.ts";
import { createLink, issuesOf, type Link, unavailable } from "./core-link.ts";
import { providerChoiceOf } from "./model-picker-data.ts";
import type {
  AgentDetail,
  AgentDraft,
  AgentListRow,
  AgentsOverview,
  AgentsSource,
  ShownModel,
  ModelsView,
  PlaceView,
  ReadResult,
  SaveInput,
  SaveResult,
  UserModels,
} from "./source.ts";

/** 목록을 끝까지 모을 때 page 상한. */
const PAGE_LIMIT = 20;
// catalog는 항목이 많아 page가 많다(page당 row 예산이 있다).
const CATALOG_PAGE_LIMIT = 60;

/** agent ID의 본문: 소문자 Crockford base32 26자, 첫 글자는 0~7이다. */
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

const DEFAULT_PROFILE = {
  kind: "character",
  shape: "arch",
  color: "sage",
} as const;

interface AgentsDeps {
  /** 지침 파일의 경로를 알려 주는 main 통로. 없으면 지침은 읽지도 쓰지도 못한다(unavailable). */
  instructions: InstructionsApi | undefined;
  /** 지침 파일을 읽고 쓰는 main file 통로. 없으면 지침은 읽지도 쓰지도 못한다(unavailable). */
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

function toRow(row: AgentRow): AgentListRow {
  return {
    assignment: row.agent,
    name: row.name,
    profile: row.profile,
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
  };
}

export function coreAgentsSource(
  core: CoreSource,
  deps: Partial<AgentsDeps> = {},
): AgentsSource {
  const instructions =
    "instructions" in deps ? deps.instructions : windowInstructions();
  const files = "files" in deps ? deps.files : windowFiles();
  const random = deps.random ?? (() => crypto.randomUUID());
  const bytes =
    deps.bytes ?? (() => crypto.getRandomValues(new Uint8Array(26)));
  const openSecret =
    "openSecret" in deps ? deps.openSecret : windowSecretInputOpener();
  const openLink = "openLink" in deps ? deps.openLink : windowLinkOpener();
  const link: Link = createLink(core, random);

  // 읽은 profile 이미지의 blob URL. 키는 `<agent id>/<이미지 이름>`이다. 이름은 `avatar.<ext>` 하나뿐이라
  // 다시 올리면 uploadImage가 새 값으로 바꾼다.
  const images = new Map<string, string>();
  const loadImage = async (agent: string, image: string) => {
    if (images.has(`${agent}/${image}`)) return;
    try {
      const reply = await core.call({
        kind: "file",
        resource: "profile-images",
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

  // 놓인 곳의 이름(project의 title, 앱의 name). 읽지 못하면 빈 글이다.
  const nameOf = async (place: string): Promise<string> => {
    if (isAppPlace(place)) {
      const app = await link.read<{ app: { name: string } }>("apps", "get", {
        app: place,
      });
      return app.ok ? app.value.app.name : "";
    }
    const project = await link.read<{ project: { title: string } }>(
      "projects",
      "get",
      { project: place },
    );
    return project.ok ? project.value.project.title : "";
  };

  // 이 자리 그릇의 active domain. 한 page가 넘으면 cursor로 이어 읽는다.
  const domains = async (
    place: string,
  ): Promise<ReadResult<readonly DomainView[]>> => {
    const found: DomainView[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < PAGE_LIMIT; page += 1) {
      const result = await link.read<{
        domains: DomainView[];
        next_cursor: string | null;
      }>("domains", "list", {
        owner: placeOf(place),
        status: "active",
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!result.ok) return result;
      found.push(
        ...result.value.domains.map((one) => ({
          id: one.id,
          name: one.name,
          title: one.title,
          purpose: one.purpose,
          status: one.status,
        })),
      );
      if (result.value.next_cursor === null) break;
      cursor = result.value.next_cursor;
    }
    return { ok: true, value: found };
  };

  const providers = async () => {
    const rows: {
      id: string;
      name: string;
      definition: { key: string };
      credential: { kind: string; reported_models: string[] | null };
    }[] = [];
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

  // 전역 목록이다. 첫 인자는 화면을 연 자리지만 목록은 자리에 속하지 않아 쓰지 않는다.
  const list = async (_place: string): Promise<ReadResult<AgentListRow[]>> => {
    const result = await link.read<{ agents: AgentRow[] }>(
      "agents",
      "list",
      {},
    );
    if (!result.ok) return result;
    const rows = result.value.agents.map(toRow);
    await Promise.all(
      rows.map((row) =>
        row.profile.kind === "image"
          ? loadImage(row.assignment, row.profile.image)
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

  const detailOf = async (
    place: string | null,
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
        profile: {
          value: AgentListRow["profile"];
          source: "global" | "project" | "agent" | "session";
        };
        model: {
          value: ModelChoice;
          source: "global" | "project" | "agent" | "session";
        } | null;
        domains: string[];
      };
      issues: AgentDetail["issues"];
    }>("agents", "read", {
      agent,
      ...(place === null ? {} : { place: placeOf(place) }),
    });
    if (!read.ok) return read;
    const value = read.value;
    const placeView: PlaceView =
      place === null
        ? { kind: "none", id: null, name: "" }
        : { kind: placeOf(place).kind, id: place, name: await nameOf(place) };
    const skills = await readSkills(link, place);
    if (!skills.ok) return skills;
    const servers = await readServers(link, place);
    if (!servers.ok) return servers;
    const text = place === null ? null : await instructionsOf(place);
    const saved = value.definition ?? { body: "" };
    if (value.effective.profile.value.kind === "image") {
      await loadImage(agent, value.effective.profile.value.image);
    }
    return {
      ok: true,
      value: {
        assignment: agent,
        draftId: null,
        place: placeView,
        definition: saved,
        hash: value.hash,
        effective: {
          name: value.effective.name,
          profile: value.effective.profile,
        },
        inheritedModel: await inheritedOf(value.effective.model),
        issues: value.issues,
        skills: skills.value,
        mcpServers: servers.value,
        agentMcpLogins: await readAgentServerLogins(
          link,
          agent,
          saved.mcp_servers ?? [],
        ),
        instructions: text,
      },
    };
  };

  // project 지침. 그 project 폴더의 LOPHN.md다. 앱 자리에는 project 지침이 없다. 읽지 못하면 빈 글이다.
  const instructionsOf = async (place: string) => {
    if (isAppPlace(place)) return null;
    const read = await readInstructions(instructions, files, {
      layer: "project",
      place,
    });
    return {
      ...(read.ok ? read.value : { text: "", hash: null }),
      project: await nameOf(place),
    };
  };

  return {
    list,

    domains,

    async overview(project) {
      const agents = await list(project);
      if (!agents.ok) return agents;
      const skills = await readSkills(link, project);
      if (!skills.ok) return skills;
      const servers = await readServers(link, project);
      if (!servers.ok) return servers;
      const global = await readGlobalModel(link);
      const chosen = isAppPlace(project)
        ? null
        : await link.read<{ model: ModelChoice | null }>(
            "project-model",
            "read",
            { project },
          );
      const text = await instructionsOf(project);
      const view: AgentsOverview = {
        agents: agents.value,
        instructions: text,
        projectModel: {
          chosen: chosen?.ok ? chosen.value.model : null,
          inherited: global.ok ? global.value : null,
        },
        skills: skills.value,
        mcpServers: servers.value,
      };
      return { ok: true, value: view };
    },

    async models() {
      const registered = await providers();
      if (!registered.ok) return registered;
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
          providerChoiceOf(provider, entries),
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

    async newAgent(project) {
      const current: PlaceView = {
        ...placeOf(project),
        name: await nameOf(project),
      };
      const draftId = newAgentId(bytes());
      const skills = await readSkills(link, project);
      if (!skills.ok) return skills;
      const servers = await readServers(link, project);
      if (!servers.ok) return servers;
      const text = await instructionsOf(project);
      const global = await readGlobalModel(link);
      const detail: AgentDetail = {
        assignment: null,
        draftId,
        place: current,
        definition: { body: "" },
        hash: null,
        effective: {
          name: { value: "", source: "global" },
          profile: { value: DEFAULT_PROFILE, source: "global" },
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
        const created = await link.command(agentCreate, {
          input: { id, definition: draft },
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
      // 이번 저장에서 새로 생긴 server를 가리려고, 그리고 lophn의 잠긴 name·profile을 그대로 보내려고 읽는다.
      const before = await link.read<{
        definition: AgentDraft | null;
        effective: {
          name: { value: string };
          profile: { value: AgentListRow["profile"] };
        };
      }>("agents", "read", { agent: input.assignment });
      if (!before.ok) {
        return { ok: false, message: before.message, issues: [] };
      }
      const stored = before.value.definition;
      const definition: AgentDraft =
        input.assignment === LOPHN_AGENT_ID
          ? {
              ...draft,
              name: stored?.name ?? before.value.effective.name.value,
              profile: stored?.profile ?? before.value.effective.profile.value,
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

    async deleteAgent(_project, agent, hash) {
      const deleted = await link.command(agentDelete, {
        input: { agent },
        compare: { hash },
      });
      return deleted.ok
        ? { ok: true, value: null }
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
        resource: "profile-images",
        method: "upload",
        body: { agent, content_type: file.type, bytes: bytes.byteLength },
        bytes,
      });
      if (!uploaded.ok) {
        return { ok: false, message: uploaded.error?.code ?? "internal" };
      }
      const image = (uploaded.value as { profile: { image: string } }).profile
        .image;
      images.set(`${agent}/${image}`, URL.createObjectURL(file));
      return { ok: true, value: { image } };
    },

    imageSrc: (_project, agent, image) => images.get(`${agent}/${image}`) ?? "",

    async setProjectModel(project, choice) {
      if (isAppPlace(project)) return unavailable;
      const changed = await link.command(projectModelChange, {
        input: { project, model: choice },
        compare: {},
      });
      return changed.ok
        ? { ok: true, value: null }
        : { ok: false, message: changed.code };
    },

    // project 층에서 skill을 켜고 끈다. 끈 이름은 project 설정 파일의 skills_off에 둔다(agent 정의의 skills_off와 다른 층이다).
    setSkill(project, name, on) {
      if (isAppPlace(project)) return Promise.resolve(unavailable);
      return changeProjectSettings(link, project, (current) => ({
        ...current,
        skillsOff: on
          ? current.skillsOff.filter((one) => one !== name)
          : [...new Set([...current.skillsOff, name])],
      }));
    },

    // project 층 server는 enabled를 바꾸고, 전역 server는 이 project에서 끈 이름(mcp_off)에 넣고 뺀다.
    setMcp(project, name, on) {
      if (isAppPlace(project)) return Promise.resolve(unavailable);
      return changeProjectSettings(link, project, (current) => {
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

    grants: (project, agent) => readGrants(link, project, agent, domains),

    setGrants: (project, agent, entries, revision) =>
      saveGrants(link, project, agent, entries, revision),

    readInstructions: (project) =>
      isAppPlace(project)
        ? Promise.resolve(unavailable)
        : readInstructions(instructions, files, {
            layer: "project",
            place: project,
          }),

    writeInstructions: (project, text, hash) =>
      isAppPlace(project)
        ? Promise.resolve(unavailable)
        : writeInstructions(
            instructions,
            files,
            { layer: "project", place: project },
            text,
            hash,
          ),
  };
}
