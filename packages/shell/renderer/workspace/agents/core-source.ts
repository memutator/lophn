// AgentsSource를 제품 core로 잇는다. token·port는 main에 있고 이 쪽은 route 이름과 입력만 보낸다. agent는 AgentRef로
// 가리키고 화면에는 key(agent-key.ts)로 나간다. 저장 거절(invalid_input)은 details의 항목별 이유를 issues로 그대로 싣는다.
// 아래는 route가 없어 unavailable로 답하는 것이다.
// - project 층 model 고르기
// - project 층 skill 켬·끔, 전역 server를 project 층에서 켬·끔
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
  changeModelFavorites,
  projectModelChange,
} from "../../../../protocol/lophn-agent/models.ts";
import type { CatalogEntry } from "../../../../protocol/lophn-agent/models.ts";
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
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
import { createLink, issuesOf, type Link, unavailable } from "./core-link.ts";
import type {
  AgentDetail,
  AgentDraft,
  AgentListRow,
  AgentsOverview,
  AgentsSource,
  ModelFavorite,
  ModelsView,
  PlaceChoice,
  PlaceView,
  ReadResult,
  SaveInput,
  SaveResult,
} from "./source.ts";

/** 목록을 끝까지 모을 때 page 상한. */
const PAGE_LIMIT = 20;

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

// 정의 파일의 칸 가운데 이 role이 가질 수 있는 것만 보낸다: 내장 role은 model·skill·MCP 끄기와 지침뿐이다.
function builtInDefinition(draft: AgentDraft) {
  return {
    ...(draft.model === undefined ? {} : { model: draft.model }),
    ...(draft.skills_off === undefined ? {} : { skills_off: draft.skills_off }),
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

  const providers = async () => {
    const rows: { id: string; name: string; definition: { key: string } }[] =
      [];
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

  const favorites = async () => {
    const result = await link.read<
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
    const text = where === null
      ? null
      : await instructionsOf(value.role, where.id);
    if (value.effective.profile.value.kind === "image") {
      await loadImage(place, key, value.effective.profile.value.image);
    }
    return {
      ok: true,
      value: {
        assignment: key,
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
        instructions: where === null
          ? null
          : { text: text?.text ?? "", project: text?.project ?? null },
        places: [],
      },
    };
  };

  // project 지침. project 자리는 그 project의 것이고, 앱의 App Engineer는 앱 source가 속한 등록 project의 것이다.
  // 앱 Operator는 쓸 project 폴더가 없어 project 지침이 없다.
  const instructionsOf = async (
    role: AgentDetail["role"],
    place: string,
  ): Promise<{ text: string; project: string | null } | null> => {
    if (!isAppPlace(place)) {
      return {
        text: await readInstructions(link, instructions, "project", place),
        project: await nameOf(place),
      };
    }
    if (role !== "app_engineer") return { text: "", project: null };
    const app = await link.read<{ app: { source_path: string | null } }>(
      "apps",
      "get",
      { app: place },
    );
    const path = app.ok ? app.value.app.source_path : null;
    if (path === null) return { text: "", project: null };
    const owner = await link.read<{ project: { id: string; title: string } }>(
      "projects",
      "resolve",
      { path },
    );
    return owner.ok
      ? {
        text: await readInstructions(
          link,
          instructions,
          "project",
          owner.value.project.id,
        ),
        project: owner.value.project.title,
      }
      : { text: "", project: null };
  };

  return {
    list,

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
      const text = await instructionsOf(
        isAppPlace(project) ? "app_engineer" : "project_manager",
        project,
      );
      const view: AgentsOverview = {
        agents: agents.value.filter((row) => row.role !== "lophn"),
        instructions: {
          text: text?.text ?? "",
          project: text?.project ?? null,
        },
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
      const catalog = await link.read<{ entries: CatalogEntry[] }>(
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
      const changed = await link.command(changeModelFavorites, {
        input: { items },
        compare: { settings_seq: current.value.seq },
      });
      return changed.ok
        ? { ok: true, value: changed.value.favorites.items }
        : { ok: false, message: changed.code };
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
      const text = await instructionsOf("operator", project);
      const global = await readGlobalModel(link);
      const detail: AgentDetail = {
        assignment: null,
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
        instructions: {
          text: text?.text ?? "",
          project: text?.project ?? null,
        },
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
        const created = await link.command(operatorCreate, {
          input: {
            id: newOperatorId(bytes()),
            place: placeOf(input.place ?? project ?? ""),
            definition: draft,
          },
          compare: {},
        });
        return created.ok
          ? {
            ok: true,
            value: {
              assignment: created.value.agent,
              hash: created.value.hash,
            },
          }
          : failed(created);
      }
      const operator = OPERATOR_ID.test(input.assignment);
      const ref = refOf(project, input.assignment);
      if (ref === null) return { ok: false, message: "not_found", issues: [] };
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
      return saved.ok
        ? {
          ok: true,
          value: { assignment: input.assignment, hash: saved.value.hash },
        }
        : failed(saved);
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

    // project 층에서 skill을 켜고 끈다. 끈 이름은 project 설정 파일의 skills_off에 둔다.
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

    grants: (project, key) => readGrants(link, project, key),

    setGrants: (project, key, entries) =>
      saveGrants(link, project, key, entries),
  };
}
