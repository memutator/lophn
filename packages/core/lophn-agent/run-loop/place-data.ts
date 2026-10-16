import { err, ok, type Result } from "../../../base/mod.ts";
import { appAppApi } from "../../../protocol/apps/blueprint/read.ts";
import { appGet, appList } from "../../../protocol/apps/mod.ts";
import { callSendable, type Role } from "../../../protocol/lophn-agent/mod.ts";
import {
  contextContractRoute,
  contextGetRoute,
  contextListRoute,
  glossaryListRoute,
  projectApi,
} from "../../../protocol/projects/mod.ts";
import type { ResolvedAgent } from "../agents/mod.ts";
import {
  buildContextText,
  type FolderRead,
  type PlaceAgent,
  type PlaceContext,
  type PlaceData,
  type PlaceProject,
} from "../prompt-assembly/mod.ts";
import { type CoreCall, readOf } from "./core-call.ts";

// prompt의 place 정보 재료를 turn의 agent 자격으로 core 읽기에서 모은다. turn마다 한 번 읽는다.
// file tool이 닿는 폴더(scope)도 같은 읽기에서 나온다: lophn은 모든 project 폴더를 읽기만 하고, Project
// Manager와 project place의 Operator는 그 project 폴더를, App Engineer는 앱 source 폴더를 읽고 쓴다.

export type PlaceRead = {
  place: PlaceData;
  scope: { read: string[]; write: string[] };
};

// 부를 수 있는 agent 목록에 붙는 한 줄. agent 정의에 설명 칸이 없어 role마다 고정 문장이다.
const ROLE_LINE: Record<Role, string> = {
  lophn: "Plans work, registers projects and apps, and hands work to others.",
  project_manager: "Looks after the project's folders and contexts.",
  app_engineer: "Builds and maintains the app.",
  operator: "Works with the contexts and tools it was granted.",
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

export async function readPlaceData(
  call: CoreCall,
  agent: ResolvedAgent,
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
  const scope: PlaceRead["scope"] = { read: [], write: [] };

  if (place?.kind === "project") {
    const read = await projectOf(place.id);
    if (!read.ok) return read;
    project = placeProject(read.value);
    const folders = read.value.folders.map((f) => f.path);
    scope.read.push(...folders);
    scope.write.push(...folders);
  } else if (place?.kind === "app") {
    const read = await readOf(call, appGet, { app: place.id });
    if (!read.ok) return read;
    const found = read.value.app;
    const source = found.source_path;
    app = {
      id: found.id,
      name: found.name,
      purpose: found.description,
      source,
      blueprint: source === null ? "blueprint.ts" : `${source}/blueprint.ts`,
    };
    if (source !== null && role === "app_engineer") {
      scope.read.push(source);
      scope.write.push(source);
    }
    if (role === "app_engineer" && found.active_release !== null) {
      const apis = await readOf(call, appAppApi, { app: place.id });
      if (apis.ok) {
        release = {
          version: apis.value.release,
          api_names: apis.value.app_api.map((api) => api.key),
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
      scope.read.push(...record.folders.map((f) => f.path));
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

  // context 글은 읽는 role만 싣는다. lophn은 목록(이름과 한 줄)만 쓰므로 글 없이 둔다.
  const contexts: PlaceContext[] = [];
  if (role === "lophn") {
    for (const record of projects.values()) {
      const listed = await pages(async (cursor) => {
        const read = await readOf(call, contextListRoute, {
          project: record.id,
          status: "active",
          ...(cursor === undefined ? {} : { cursor }),
        });
        return read.ok
          ? ok({
            items: read.value.contexts,
            next_cursor: read.value.next_cursor,
          })
          : read;
      });
      if (!listed.ok) return listed;
      for (const c of listed.value) {
        contexts.push({
          name: c.title,
          project: c.project,
          attached: true,
          purpose: c.purpose,
          version: c.applied_number === null ? "r0" : `r${c.applied_number}`,
          text: null,
        });
      }
    }
  } else if (role === "project_manager" || role === "operator") {
    for (const id of agent.contexts) {
      const loaded = await readContext(call, id, projectOf);
      if (loaded !== null) contexts.push(loaded);
    }
  }

  return ok({
    place: {
      self: { role, name: agent.name },
      project,
      app,
      agents: [...agents.values()],
      contexts,
      apps: appItems,
      projects: projectList,
      release,
    },
    scope,
  });
}

// context 하나의 글. 읽지 못한 것은 글 없이 둔다(이름과 한 줄만 보인다). 목록도 못 읽으면 null이다.
export async function readContext(
  call: CoreCall,
  id: string,
  projectOf: (id: string) => Promise<Result<ProjectRecord>>,
): Promise<PlaceContext | null> {
  const got = await readOf(call, contextGetRoute, { context: id });
  if (!got.ok || got.value.applied === null) return null;
  const c = got.value.context;
  const number = got.value.applied.number;
  const base: PlaceContext = {
    name: c.title,
    project: c.project,
    attached: true,
    purpose: c.purpose,
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
