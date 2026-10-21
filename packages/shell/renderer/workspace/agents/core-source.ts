// AgentsSource를 제품 core로 잇는다. token·port는 main에 있고 이 쪽은 route 이름과 입력만 보낸다. agent는 AgentRef로
// 가리키고 화면에는 key(agent-key.ts)로 나간다. 저장 거절(invalid_input)은 details의 항목별 이유를 issues로 그대로 싣는다.
// 앱 자리에는 project 층이 없어 project 층 model 고르기, skill 켬·끔, server 켬·끔은 unavailable로 답한다.
// profile 이미지는 byte route(upload·file)로 올리고 읽는다. 읽은 이미지는 blob URL로 기억하고, 목록과 상세를
// 읽을 때 미리 받아 두어 imageSrc는 기다리지 않고 답한다.
import type {
  AgentDefinitionRow,
} from "../../../../protocol/lophn-agent/agent-definitions.ts";
import {
  builtinAgentChange,
  operatorChange,
  operatorCreate,
  operatorDelete,
} from "../../../../protocol/lophn-agent/agent-definitions.ts";
import {
  changeHiddenModels,
  projectModelChange,
  removeUserModelInfo,
  saveUserModelInfo,
} from "../../../../protocol/lophn-agent/models.ts";
import { refreshProviderModels } from "../../../../protocol/lophn-agent/providers.ts";
import type { CatalogEntry } from "../../../../protocol/lophn-agent/models.ts";
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import type { McpServer } from "../../../../protocol/lophn-agent/mcp-settings.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
import type { SecretInputOpenApi } from "../../../ipc/secret-input.ts";
import {
  enterSecret,
  windowSecretInputOpener,
} from "../../desktop/settings/core-call.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import { isAppPlace, keyOf, OPERATOR_ID, refOf } from "./agent-key.ts";
import { readGrants, saveGrants } from "./core-grants.ts";
import {
  changeProjectSettings,
  readGlobalModel,
  readInstructions,
  readServers,
  readSkills,
} from "./core-extensions.ts";
import { providerChoiceOf } from "./model-picker-data.ts";
import { createLink, issuesOf, type Link, unavailable } from "./core-link.ts";
import type { DomainView } from "../source.ts";
import type {
  AgentDetail,
  AgentDraft,
  AgentListRow,
  AgentsOverview,
  AgentsSource,
  HiddenModel,
  ModelsView,
  PlaceChoice,
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

/** Operator ID의 본문: 소문자 Crockford base32 26자, 첫 글자는 0~7이다. */
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

const DEFAULT_PROFILE = { kind: "icon", icon: "roles" } as const;

interface AgentsDeps {
  /** project의 LOPHN.md를 여는 main 통로. 없으면 지침 미리보기는 빈 글이다. */
  instructions: InstructionsApi | undefined;
  /** command key의 무작위 부분. 테스트가 고정한다. */
  random: () => string;
  /** 새 Operator ID의 무작위 byte. 테스트가 고정한다. */
  bytes: () => Uint8Array;
  /** MCP credential을 받는 보호 입력 창. */
  openSecret: SecretInputOpenApi["open"] | undefined;
}

function windowInstructions(): InstructionsApi | undefined {
  const bridge = (globalThis as { lophnInstructions?: InstructionsApi })
    .lophnInstructions;
  return bridge && typeof bridge.open === "function" ? bridge : undefined;
}

function newOperatorId(bytes: Uint8Array): string {
  const body = Array.from(
    bytes.slice(0, 26),
    (byte, index) => CROCKFORD[index === 0 ? byte % 8 : byte % 32],
  ).join("");
  return `agt_${body}`;
}

const placeOf = (place: string) => ({
  kind: isAppPlace(place) ? "app" as const : "project" as const,
  id: place,
});

// 정의 파일의 칸 가운데 이 role이 가질 수 있는 것만 보낸다: 내장 role은 model·받을 skill·MCP 끄기와 지침뿐이다.
function builtInDefinition(draft: AgentDraft) {
  return {
    ...(draft.model === undefined ? {} : { model: draft.model }),
    ...(draft.skills === undefined ? {} : { skills: draft.skills }),
    ...(draft.mcp_off === undefined ? {} : { mcp_off: draft.mcp_off }),
    body: draft.body,
  };
}

function toRow(row: AgentDefinitionRow): AgentListRow {
  return {
    assignment: keyOf(row.agent),
    role: row.agent.role,
    kind: row.kind,
    name: row.name,
    profile: row.profile,
    model: row.model === null ? null : {
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
  const instructions = "instructions" in deps
    ? deps.instructions
    : windowInstructions();
  const random = deps.random ?? (() => crypto.randomUUID());
  const bytes = deps.bytes ??
    (() => crypto.getRandomValues(new Uint8Array(26)));
  const openSecret = "openSecret" in deps
    ? deps.openSecret
    : windowSecretInputOpener();
  const link: Link = createLink(core, random);

  // 읽은 profile 이미지의 blob URL. 키는 `<agent key>/<이미지 이름>`이다. 이름은 `avatar.<ext>` 하나뿐이라
  // 다시 올리면 uploadImage가 새 값으로 바꾼다.
  const images = new Map<string, string>();
  const loadImage = async (
    project: string | null,
    key: string,
    image: string,
  ) => {
    const ref = refOf(project, key);
    if (ref === null || images.has(`${key}/${image}`)) return;
    try {
      const reply = await core.call({
        kind: "file",
        resource: "profile-images",
        method: "read",
        body: { agent: ref },
      });
      if (!reply.ok) return;
      const file = reply.value as { bytes: Uint8Array; contentType: string };
      images.set(
        `${key}/${image}`,
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
      const result = await link.read<
        { domains: DomainView[]; next_cursor: string | null }
      >("domains", "list", {
        owner: placeOf(place),
        status: "active",
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!result.ok) return result;
      found.push(...result.value.domains.map((one) => ({
        id: one.id,
        name: one.name,
        title: one.title,
        purpose: one.purpose,
        status: one.status,
      })));
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
      const result = await link.read<
        { providers: typeof rows; next_cursor: string | null }
      >("providers", "list", cursor === undefined ? {} : { cursor });
      if (!result.ok) return result;
      rows.push(...result.value.providers);
      if (result.value.next_cursor === null) break;
      cursor = result.value.next_cursor;
    }
    return { ok: true as const, value: rows };
  };

  const hiddenModels = async () => {
    const result = await link.read<
      { hidden: { items: HiddenModel[]; settings_seq: string } }
    >("hidden-models", "read", {});
    return result.ok
      ? {
        ok: true as const,
        value: {
          items: result.value.hidden.items.map((item) => ({
            provider: item.provider,
            model_name: item.model_name,
          })),
          seq: result.value.hidden.settings_seq,
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

  const list = async (
    place: string,
  ): Promise<ReadResult<AgentListRow[]>> => {
    const result = await link.read<{ agents: AgentDefinitionRow[] }>(
      "agent-definitions",
      "list",
      { place: placeOf(place) },
    );
    if (!result.ok) return result;
    const rows = result.value.agents.map(toRow);
    await Promise.all(
      rows.map((row) =>
        row.profile.kind === "image"
          ? loadImage(place, row.assignment, row.profile.image)
          : undefined
      ),
    );
    return { ok: true, value: rows };
  };

  // 이번 저장에서 새로 생긴 bearer·api_key server의 값을 보호 입력으로 받는다. 값은 이 파일을 지나지 않는다.
  // 저장은 이미 끝났다. 창을 열지 못하거나 취소해도 되돌리지 않는다(전역 server 추가와 같다).
  const enterNewCredentials = async (
    servers: readonly McpServer[],
    before: readonly McpServer[],
  ) => {
    for (const server of servers) {
      if (server.transport !== "http") continue;
      if (before.some((one) => one.name === server.name)) continue;
      const auth = server.http.auth;
      if (auth.kind !== "bearer" && auth.kind !== "api_key") continue;
      await enterSecret(openSecret, {
        name: auth.credential.secret,
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
    key: string,
  ): Promise<ReadResult<AgentDetail>> => {
    const ref = refOf(place, key);
    if (ref === null) return { ok: false, message: "not_found" };
    const read = await link.read<{
      role: AgentDetail["role"];
      place: { kind: "project" | "app"; id: string } | null;
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
      };
      issues: AgentDetail["issues"];
    }>("agent-definitions", "read", { agent: ref });
    if (!read.ok) return read;
    const value = read.value;
    const where = value.place;
    const placeView: PlaceView = where === null
      ? { kind: "none", id: null, name: "" }
      : { kind: where.kind, id: where.id, name: await nameOf(where.id) };
    const skills = await readSkills(link, where?.id ?? null, value.role);
    if (!skills.ok) return skills;
    const servers = await readServers(link, where?.id ?? null);
    if (!servers.ok) return servers;
    const text = where === null ? null : await instructionsOf(where.id);
    if (value.effective.profile.value.kind === "image") {
      await loadImage(place, key, value.effective.profile.value.image);
    }
    return {
      ok: true,
      value: {
        assignment: key,
        draftId: null,
        role: value.role,
        kind: value.role === "operator" ? "operator" : "built_in",
        place: placeView,
        definition: value.definition ?? { body: "" },
        hash: value.hash,
        effective: {
          name: value.effective.name,
          profile: value.effective.profile,
        },
        inheritedModel: await inheritedOf(value.effective.model),
        issues: value.issues,
        skills: skills.value,
        mcpServers: servers.value,
        instructions: text,
        places: [],
      },
    };
  };

  // project 지침. 그 project 폴더의 LOPHN.md다. 앱 자리에는 project 지침이 없다.
  const instructionsOf = async (
    place: string,
  ): Promise<{ text: string; project: string } | null> =>
    isAppPlace(place) ? null : {
      text: await readInstructions(link, instructions, place),
      project: await nameOf(place),
    };

  return {
    list,

    domains,

    async overview(project) {
      const agents = await list(project);
      if (!agents.ok) return agents;
      const skills = await readSkills(link, project, null);
      if (!skills.ok) return skills;
      const servers = await readServers(link, project);
      if (!servers.ok) return servers;
      const global = await readGlobalModel(link);
      const chosen = isAppPlace(project) ? null : await link.read<
        { model: ModelChoice | null }
      >("project-model", "read", { project });
      const text = await instructionsOf(project);
      const view: AgentsOverview = {
        agents: agents.value.filter((row) => row.role !== "lophn"),
        instructions: text ?? { text: "", project: null },
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
        const catalog = await link.read<
          { entries: CatalogEntry[]; next_cursor: string | null }
        >(
          "agent-model-catalog",
          "read",
          cursor === undefined ? {} : { cursor },
        );
        if (!catalog.ok) return catalog;
        entries.push(...catalog.value.entries);
        if (catalog.value.next_cursor === null) break;
        cursor = catalog.value.next_cursor;
      }
      const hidden = await hiddenModels();
      if (!hidden.ok) return hidden;
      const view: ModelsView = {
        providers: registered.value.map((provider) =>
          providerChoiceOf(provider, entries)
        ),
        catalog: entries,
        hidden: hidden.value.items,
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

    async setHidden(items) {
      const current = await hiddenModels();
      if (!current.ok) return current;
      const changed = await link.command(changeHiddenModels, {
        input: { items },
        compare: { settings_seq: current.value.seq },
      });
      return changed.ok
        ? { ok: true, value: changed.value.hidden.items }
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

    readAgent: (project, key) => detailOf(project, key),

    async newOperator(project) {
      const current: PlaceChoice = {
        ...placeOf(project),
        name: await nameOf(project),
      };
      const projects = await link.read<
        { projects: { id: string; title: string }[] }
      >("projects", "list", {});
      const apps = await link.read<
        { apps: { id: string; name: string; status: string }[] }
      >(
        "apps",
        "list",
        {},
      );
      const others: PlaceChoice[] = [
        ...(projects.ok
          ? projects.value.projects.map((one): PlaceChoice => ({
            kind: "project",
            id: one.id,
            name: one.title,
          }))
          : []),
        ...(apps.ok
          ? apps.value.apps.filter((one) => one.status === "active").map((
            one,
          ): PlaceChoice => ({ kind: "app", id: one.id, name: one.name }))
          : []),
      ].filter((one) => one.id !== project);
      const skills = await readSkills(link, project, "operator");
      if (!skills.ok) return skills;
      const servers = await readServers(link, project);
      if (!servers.ok) return servers;
      const text = await instructionsOf(project);
      const global = await readGlobalModel(link);
      const detail: AgentDetail = {
        assignment: null,
        draftId: newOperatorId(bytes()),
        role: "operator",
        kind: "operator",
        place: current,
        definition: { body: "" },
        hash: null,
        effective: {
          name: { value: "", source: "global" },
          profile: { value: DEFAULT_PROFILE, source: "global" },
        },
        inheritedModel: global.ok && global.value !== null
          ? { value: global.value, source: "global" }
          : null,
        issues: [],
        skills: skills.value,
        mcpServers: servers.value,
        instructions: text,
        places: [current, ...others],
      };
      return { ok: true, value: detail };
    },

    async saveAgent(project, input: SaveInput): Promise<SaveResult> {
      const failed = (
        reply: { code: string; error: unknown },
      ): SaveResult => ({
        ok: false,
        message: reply.code,
        issues: reply.code === "invalid_input" ? issuesOf(reply.error) : [],
      });
      const draft = input.definition;
      if (input.assignment === null) {
        const id = input.draftId ?? newOperatorId(bytes());
        const created = await link.command(operatorCreate, {
          input: {
            id,
            place: placeOf(input.place ?? project ?? ""),
            definition: draft,
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
      const operator = OPERATOR_ID.test(input.assignment);
      const ref = refOf(project, input.assignment);
      if (ref === null) return { ok: false, message: "not_found", issues: [] };
      // 이번 저장에서 새로 생긴 server를 가리려고 저장 전 정의의 server 이름을 읽는다.
      const before = operator && (draft.mcp_servers ?? []).length > 0
        ? await link.read<{ definition: AgentDraft | null }>(
          "agent-definitions",
          "read",
          { agent: ref },
        )
        : null;
      const compare = { hash: input.hash };
      const saved = operator
        ? await link.command(operatorChange, {
          input: { agent: input.assignment, definition: draft },
          compare,
        })
        : await link.command(builtinAgentChange, {
          input: { agent: ref, definition: builtInDefinition(draft) },
          compare,
        });
      if (!saved.ok) return failed(saved);
      // 저장 전 정의를 읽지 못했으면 어느 server가 새 것인지 몰라 값을 묻지 않는다.
      if (before === null || before.ok) {
        await enterNewCredentials(
          draft.mcp_servers ?? [],
          before?.ok ? before.value.definition?.mcp_servers ?? [] : [],
        );
      }
      return {
        ok: true,
        value: { assignment: input.assignment, hash: saved.value.hash },
      };
    },

    async deleteAgent(_project, key, hash) {
      const deleted = await link.command(operatorDelete, {
        input: { agent: key },
        compare: { hash },
      });
      return deleted.ok
        ? { ok: true, value: null }
        : { ok: false, message: deleted.code };
    },

    async uploadImage(project, key, file) {
      const ref = refOf(project, key);
      if (ref === null) return { ok: false, message: "not_found" };
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
        body: { agent: ref, content_type: file.type, bytes: bytes.byteLength },
        bytes,
      });
      if (!uploaded.ok) {
        return { ok: false, message: uploaded.error?.code ?? "internal" };
      }
      const image =
        (uploaded.value as { profile: { image: string } }).profile.image;
      images.set(`${key}/${image}`, URL.createObjectURL(file));
      return { ok: true, value: { image } };
    },

    imageSrc: (_project, key, image) => images.get(`${key}/${image}`) ?? "",

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

    // project 층에서 skill을 켜고 끈다. 끈 이름은 project 설정 파일의 skills_off에 둔다(agent 정의의 skills와 다른 층이다).
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
              server.name === name ? { ...server, enabled: on } : server
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

    grants: (project, key) => readGrants(link, project, key, domains),

    setGrants: (project, key, entries, revision) =>
      saveGrants(link, project, key, entries, revision),
  };
}
