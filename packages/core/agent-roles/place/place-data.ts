import { err, ok, type Result } from "../../../base/mod.ts";
import { agentGrantsGet, agentKey } from "../../../protocol/approvals/mod.ts";
import { appAppApi } from "../../../protocol/apps/blueprint/read.ts";
import { appGet, appList } from "../../../protocol/apps/mod.ts";
import {
  agentDefinitionList,
  type AgentRef,
  callSendable,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  contextContractRoute,
  contextGetRoute,
  glossaryListRoute,
  kindGet,
  projectApi,
} from "../../../protocol/projects/mod.ts";
import type { ContextText } from "../../../protocol/lophn-agent/context-text.ts";
import type { ResolvedAgent } from "../../lophn-agent/agents/mod.ts";
import {
  buildContextText,
  buildKindText,
  type FolderRead,
  type PlaceAgent,
  type PlaceKinds,
  type TurnPromptInput,
} from "../../lophn-agent/prompt-assembly/mod.ts";
import { type CoreCall, readOf } from "../../lophn-agent/run-loop/core-call.ts";
import { type PlaceData, placeInfo, type PlaceProject } from "./place-info.ts";
import { placeScope } from "./place-folders.ts";
import type { ArtifactEntry } from "./artifact-list.ts";

// artifacts 폴더를 data root에서 찾고 만드는 file system 접근이다. 조립(runtime entry)이 꽂는다.
export type PlaceFiles = {
  artifactsFolder(project: string): string | null;
  ensureDir(path: string): Promise<void>;
  listArtifacts(folder: string): Promise<readonly ArtifactEntry[]>;
};

// prompt의 place 정보 재료를 turn의 agent 자격으로 core 읽기에서 모은다. turn마다 한 번 읽는다.
// file tool이 닿는 폴더(scope)도 같은 읽기에서 나온다. 읽은 값만 모아 place-folders의 규칙(placeScope)에 넘긴다.

type PlaceRead = {
  place: PlaceData;
  scope: { read: string[]; write: string[] };
};

// place 정보의 kind 글 예산(글자 수). 고정값이라 session을 시작할 때 정한 것과 같다.
const KIND_TEXT_BUDGET = 12000;

// 부를 수 있는 agent 목록에 붙는 한 줄. agent 정의에 설명 칸이 없어 role마다 고정 문장이다.
const ROLE_LINE: Record<Role, string> = {
  lophn: "Plans work, registers apps, and hands work to others.",
  project_manager: "Looks after the project's folders and kinds.",
  app_engineer: "Builds and maintains the app.",
  operator: "Works with the kinds and tools it was granted.",
};

const MAX_PAGES = 50;

async function pages<T>(
  next: (cursor: string | undefined) => Promise<
    Result<{ items: T[]; next_cursor: string | null }>
  >,
): Promise<Result<T[]>> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const read = await next(cursor);
    if (!read.ok) return read;
    items.push(...read.value.items);
    if (read.value.next_cursor === null) return ok(items);
    cursor = read.value.next_cursor;
  }
  return err({ code: "unavailable", message: "the list is too long" });
}

type ProjectRecord = {
  id: string;
  name: string;
  purpose: string;
  folders: readonly {
    path: string;
    description: string;
    subfolders: readonly FolderRead[];
  }[];
};

function placeProject(project: ProjectRecord): PlaceProject {
  return {
    id: project.id,
    name: project.name,
    purpose: project.purpose,
    folders: project.folders.map((f) => ({
      path: f.path,
      description: f.description,
    })),
    subfolders: project.folders.flatMap((f) => f.subfolders),
  };
}

async function readPlaceData(
  call: CoreCall,
  agent: ResolvedAgent,
  files: PlaceFiles,
): Promise<Result<PlaceRead>> {
  const { role, place } = agent;
  const projects = new Map<string, ProjectRecord>();
  const projectOf = async (id: string): Promise<Result<ProjectRecord>> => {
    const known = projects.get(id);
    if (known !== undefined) return ok(known);
    const read = await readOf(call, projectApi.get, { project: id });
    if (!read.ok) return read;
    projects.set(id, read.value.project);
    return ok(read.value.project);
  };

  let project: PlaceProject | null = null;
  let app: PlaceData["app"] = null;
  let release: PlaceData["release"] = null;
  let projectFolders: string[] = [];
  let artifacts: string | null = null;
  let artifactItems: readonly ArtifactEntry[] = [];
  let kinds: PlaceKinds | null = null;
  let kindsFile: string | null = null;
  let appSource: string | null = null;
  const allProjectFolders: string[] = [];

  if (place?.kind === "project") {
    const read = await projectOf(place.id);
    if (!read.ok) return read;
    project = placeProject(read.value);
    projectFolders = read.value.folders.map((f) => f.path);
    if (role === "project_manager" || role === "operator") {
      // kind 글만 비우고 turn은 계속한다. PM은 파일이 없어도 경로를 안다(처음 쓸 자리다).
      const got = await readOf(call, kindGet, { project: place.id });
      if (got.ok) {
        const { status } = got.value;
        if (role === "project_manager") kindsFile = status.file;
        if (
          status.state !== "none" && got.value.kinds !== null &&
          status.applied_hash !== null
        ) {
          kinds = {
            hash: status.applied_hash,
            text: buildKindText({
              kinds: got.value.kinds,
              warning: status.state === "invalid",
            }),
          };
        }
      }
    }
    if (role === "project_manager" || role === "operator") {
      const folder = files.artifactsFolder(place.id);
      if (folder !== null) {
        // 첫 쓰기 전에 폴더가 있어야 한다. 없는 허용 폴더는 file scope가 건너뛴다. 만들지 못하면 범위에서 빠진 채 간다.
        try {
          await files.ensureDir(folder);
          artifacts = folder;
        } catch { /* 폴더가 없으면 범위에서 빠진다 */ }
        if (artifacts !== null) {
          artifactItems = await files.listArtifacts(artifacts).catch(() => []);
        }
      }
    }
  } else if (place?.kind === "app") {
    const read = await readOf(call, appGet, { app: place.id });
    if (!read.ok) return read;
    const found = read.value.app;
    const source = found.source_path;
    appSource = source;
    app = {
      id: found.id,
      name: found.name,
      purpose: found.description,
      source,
      blueprint: source === null ? "blueprint.ts" : `${source}/blueprint.ts`,
    };
    if (role === "app_engineer" && found.active_release !== null) {
      const apis = await readOf(call, appAppApi, { app: place.id });
      if (apis.ok) {
        release = {
          version: apis.value.release,
          api_names: apis.value.tools.map((tool) => tool.name),
        };
      }
    }
  }

  // lophn: 모든 project와 앱의 목록. 폴더는 읽기만 열린다.
  const projectList: { name: string; purpose: string }[] = [];
  const appItems: { name: string; purpose: string }[] = [];
  if (role === "lophn") {
    const listed = await pages(async (cursor) => {
      const read = await readOf(call, projectApi.list, {
        status: "active",
        ...(cursor === undefined ? {} : { cursor }),
      });
      return read.ok
        ? ok({
          items: read.value.projects,
          next_cursor: read.value.next_cursor,
        })
        : read;
    });
    if (!listed.ok) return listed;
    for (const record of listed.value) {
      projects.set(record.id, record);
      projectList.push({ name: record.name, purpose: record.purpose });
      allProjectFolders.push(...record.folders.map((f) => f.path));
    }
    const apps = await pages(async (cursor) => {
      const read = await readOf(call, appList, {
        status: "active",
        ...(cursor === undefined ? {} : { cursor }),
      });
      return read.ok
        ? ok({ items: read.value.apps, next_cursor: read.value.next_cursor })
        : read;
    });
    if (!apps.ok) return apps;
    appItems.push(...apps.value.map((a) => ({
      name: a.name,
      purpose: a.description,
    })));
  }

  // 부를 수 있는 agent. grant가 막은 상대는 core가 이미 뺐다.
  const sendable = await readOf(call, callSendable, {});
  if (!sendable.ok) return sendable;
  const labels = new Map<string, string | null>();
  const labelOf = async (
    at: { kind: "project" | "app"; id: string } | null,
  ): Promise<string | null> => {
    if (at === null) return null;
    const key = `${at.kind}:${at.id}`;
    if (labels.has(key)) return labels.get(key) ?? null;
    let name = at.id;
    if (at.kind === "project") {
      const read = await projectOf(at.id);
      if (read.ok) name = read.value.name;
    } else {
      const read = await readOf(call, appGet, { app: at.id });
      if (read.ok) name = read.value.app.name;
    }
    const label = `${at.kind} ${name}`;
    labels.set(key, label);
    return label;
  };
  const agents = new Map<string, PlaceAgent>();
  for (const session of sendable.value.sessions) {
    if (session.role === "coding_agent") continue;
    const label = await labelOf(session.place);
    const found: PlaceAgent = {
      role: session.role,
      name: session.name,
      place: label,
      line: ROLE_LINE[session.role],
    };
    if (
      found.role === role && found.name === agent.name &&
      found.place === (await labelOf(place))
    ) continue;
    agents.set(`${found.role}\0${found.name}\0${found.place}`, found);
  }

  // session이 아직 없는 상대도 부를 수 있다(call이 새 session을 연다). 후보를 모아 gate와 같은 기준으로 거른다:
  // 자기 grant에 excluded 줄이 있는 상대만 빠진다. grant를 못 읽으면 gate도 못 보이는 것으로 치므로 싣지 않는다.
  const grant = await readOf(call, agentGrantsGet, { agent: agent.agent });
  if (grant.ok) {
    const excluded = new Set(
      grant.value.grant.entries.flatMap((entry) =>
        entry.kind === "agent" && entry.setting === "excluded"
          ? [agentKey(entry.agent)]
          : []
      ),
    );
    const own = agentKey(agent.agent);
    const add = async (
      ref: AgentRef,
      name: string,
      at: { kind: "project" | "app"; id: string } | null,
    ) => {
      if (excluded.has(agentKey(ref)) || agentKey(ref) === own) return;
      const found: PlaceAgent = {
        role: ref.role,
        name,
        place: await labelOf(at),
        line: ROLE_LINE[ref.role],
      };
      const key = `${found.role}\0${found.name}\0${found.place}`;
      if (!agents.has(key)) agents.set(key, found);
    };
    await add({ role: "lophn" }, "lophn", null);
    const projectsRead = await pages(async (cursor) => {
      const read = await readOf(call, projectApi.list, {
        status: "active",
        ...(cursor === undefined ? {} : { cursor }),
      });
      return read.ok
        ? ok({
          items: read.value.projects,
          next_cursor: read.value.next_cursor,
        })
        : read;
    });
    for (const record of projectsRead.ok ? projectsRead.value : []) {
      projects.set(record.id, record);
      labels.set(`project:${record.id}`, `project ${record.name}`);
      await add(
        { role: "project_manager", project: record.id },
        record.name,
        { kind: "project", id: record.id },
      );
    }
    const appsRead = await pages(async (cursor) => {
      const read = await readOf(call, appList, {
        status: "active",
        ...(cursor === undefined ? {} : { cursor }),
      });
      return read.ok
        ? ok({ items: read.value.apps, next_cursor: read.value.next_cursor })
        : read;
    });
    for (const record of appsRead.ok ? appsRead.value : []) {
      labels.set(`app:${record.id}`, `app ${record.name}`);
      await add(
        { role: "app_engineer", app: record.id },
        record.name,
        { kind: "app", id: record.id },
      );
    }
    const defined = await readOf(call, agentDefinitionList, {});
    for (const row of defined.ok ? defined.value.agents : []) {
      if (row.kind !== "operator" || row.issues.length > 0) continue;
      await add(row.agent, row.name, row.place);
    }
  }

  const scope = placeScope({
    role,
    place,
    projectFolders,
    artifactsFolder: artifacts,
    kindsFile,
    appSource,
    allProjectFolders,
  });
  return ok({
    place: {
      self: { role, name: agent.name },
      project,
      app,
      agents: [...agents.values()],
      kinds,
      kindsFile,
      apps: appItems,
      projects: projectList,
      release,
      artifacts: artifacts === null
        ? null
        : { folder: artifacts, items: artifactItems },
    },
    scope,
  });
}

// prompt가 받는 place 값과 file 범위다. 글과 kind 글은 여기서 정해 harness는 role을 모른다.
export async function placeData(
  call: CoreCall,
  agent: ResolvedAgent,
  files: PlaceFiles,
): Promise<
  Result<{ place: TurnPromptInput["place"]; scope: PlaceRead["scope"] }>
> {
  const read = await readPlaceData(call, agent, files);
  if (!read.ok) return read;
  const { place, scope } = read.value;
  const { role } = agent;
  return ok({
    place: {
      text: placeInfo(role, place, KIND_TEXT_BUDGET),
      kinds: place.kinds,
      agents: place.agents,
    },
    scope,
  });
}

type LoadedContext = {
  name: string;
  version: string;
  text: ContextText | null;
};

// `context.get` tool이 쓰는 context 하나의 글. 지우는 날까지 prompt는 이 글을 쓰지 않는다.
// context 하나의 글. 읽지 못한 것은 글 없이 둔다(이름과 한 줄만 보인다). 목록도 못 읽으면 null이다.
export async function readContext(
  call: CoreCall,
  id: string,
  projectOf: (id: string) => Promise<Result<ProjectRecord>>,
): Promise<LoadedContext | null> {
  const got = await readOf(call, contextGetRoute, { context: id });
  if (!got.ok || got.value.applied === null) return null;
  const c = got.value.context;
  const number = got.value.applied.number;
  const base: LoadedContext = {
    name: c.title,
    version: `r${number}`,
    text: null,
  };
  const [contract, glossary, owner] = await Promise.all([
    readOf(call, contextContractRoute, { context: id }),
    readOf(call, glossaryListRoute, { context: id }),
    projectOf(c.project),
  ]);
  const content = contract.ok ? contract.value.content : null;
  if (content === null || !glossary.ok || !owner.ok) return base;
  const folders = placeProject(owner.value);
  return {
    ...base,
    text: buildContextText({
      name: c.title,
      version: number ?? 0,
      purpose: c.purpose,
      project: {
        name: folders.name,
        purpose: folders.purpose,
        folders: folders.folders,
        subfolders: folders.subfolders,
      },
      types: content.contract.types.map((type) => ({
        name: type.name,
        summary: type.summary,
        fields: type.fields.map((f) => ({ name: f.name })),
        relations: type.relations.map((r) => ({
          label: r.label,
          to: r.to,
          cardinality: r.cardinality,
        })),
      })),
      searches: content.searches.map((s) => ({
        name: s.name,
        title: s.title,
        inputs: s.inputs.map((i) => ({ name: i.name, required: i.required })),
      })),
      glossary: glossary.value.entries.map((e) => ({
        term: e.term,
        meaning: e.meaning,
      })),
    }),
  };
}
