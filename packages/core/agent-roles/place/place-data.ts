import { err, ok, type Result } from "../../../base/mod.ts";
import { agentGrantsGet, agentKey } from "../../../protocol/approvals/mod.ts";
import {
  appAppApi,
  appAppApiIndex,
} from "../../../protocol/apps/blueprint/read.ts";
import {
  appList,
  appUsage,
  packagesList,
  packagesUsage,
} from "../../../protocol/apps/mod.ts";
import {
  agentDefinitionList,
  type AgentRef,
  callSendable,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";
import { kindGet, projectApi } from "../../../protocol/projects/mod.ts";
import type { ResolvedAgent } from "../../lophn-agent/agents/mod.ts";
import {
  buildKindText,
  type FolderRead,
  type PlaceAgent,
  type PlaceKinds,
  type TurnPromptInput,
} from "../../lophn-agent/prompt-assembly/mod.ts";
import { type CoreCall, readOf } from "../../lophn-agent/run-loop/core-call.ts";
import {
  type MapProject,
  type PlaceData,
  placeInfo,
  type PlaceProject,
} from "./place-info.ts";
import { placeScope } from "./place-folders.ts";
import type { ArtifactEntry } from "./artifact-list.ts";

// artifacts 폴더를 data root에서 찾고 만드는 file system 접근이다. 조립(runtime entry)이 꽂는다.
export type PlaceFiles = {
  artifactsFolder(project: string): string | null;
  // project 층 skill 폴더와 project의 data 폴더. 폴더 자체는 core가 PM을 만들 때 이미 만든다.
  skillsFolder(project: string): string | null;
  dataFolder(project: string): string | null;
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
  project_manager:
    "Looks after the project's folders, its kinds, its app and its skills.",
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
    if (role === "project_manager") {
      // project 하나에 앱 하나다. 읽지 못하면 앱이 없는 것으로 둔다(자격이 아직 읽기를 안 열었을 때도 session은 떠야 한다).
      const listed = await readOf(call, appList, { status: "active" });
      const found = listed.ok
        ? listed.value.apps.find((a) => a.project === place.id)
        : undefined;
      if (found !== undefined) {
        const source = found.source_path;
        app = {
          id: found.id,
          name: found.name,
          purpose: found.description,
          source,
          blueprint: source === null
            ? "blueprint.ts"
            : `${source}/blueprint.ts`,
        };
        if (found.active_release !== null) {
          const apis = await readOf(call, appAppApi, { app: found.id });
          if (apis.ok) {
            release = {
              version: apis.value.release,
              api_names: apis.value.tools.map((tool) => tool.name),
            };
          }
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
  }

  // lophn: 모든 project와 앱의 목록. 폴더는 읽기만 열린다.
  const projectList: MapProject[] = [];
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
    // 지도 재료. 읽기 오류는 그 덩어리만 비우고 간다.
    const index = await readOf(call, appAppApiIndex, {});
    const toolsOf = new Map(
      (index.ok ? index.value.apps : []).map((a) => [a.app, a.tools]),
    );
    const usage = await readOf(call, appUsage, {});
    const catalog = await pages(async (cursor) => {
      const read = await readOf(call, packagesList, {
        limit: 200,
        ...(cursor === undefined ? {} : { cursor }),
      });
      return read.ok
        ? ok({
          items: read.value.packages,
          next_cursor: read.value.next_cursor,
        })
        : read;
    });
    // app마다 활성 release가 쓰는 package. 한 version씩 사용처를 읽어 앱·release로 고른다.
    const packagesOf = new Map<string, string[]>();
    if (catalog.ok) {
      const releaseOf = new Map(
        apps.value.map((a) => [a.id, a.active_release]),
      );
      await Promise.all(
        catalog.value.flatMap((pkg) =>
          pkg.versions.map(async ({ version }) => {
            const read = await readOf(call, packagesUsage, {
              name: pkg.name,
              version,
            });
            if (!read.ok) return;
            for (const use of read.value.usages) {
              if (releaseOf.get(use.app) !== use.release) continue;
              const list = packagesOf.get(use.app) ?? [];
              list.push(`${pkg.name}@${version}`);
              packagesOf.set(use.app, list);
            }
          })
        ),
      );
    }
    for (const record of listed.value) {
      projects.set(record.id, record);
      allProjectFolders.push(...record.folders.map((f) => f.path));
    }
    const nameOf = (id: string) => projects.get(id)?.name ?? id;
    for (const record of listed.value) {
      const own = apps.value.find((a) => a.project === record.id);
      const uses = own === undefined || !usage.ok
        ? []
        : usage.value.uses.filter((u) => u.app === own.id);
      projectList.push({
        name: record.name,
        purpose: record.purpose,
        app: own?.name ?? null,
        tools: (own === undefined ? [] : toolsOf.get(own.id) ?? [])
          .filter((t) => t.public)
          .map((t) => ({
            key: t.name,
            effect: t.effect,
            description: t.description,
          })),
        packages: own === undefined ? [] : packagesOf.get(own.id) ?? [],
        usedBy: uses.map((u) => ({ tool: u.tool, project: nameOf(u.project) })),
      });
    }
  }

  // 부를 수 있는 agent. grant가 막은 상대는 core가 이미 뺐다.
  const sendable = await readOf(call, callSendable, {});
  if (!sendable.ok) return sendable;
  const labels = new Map<string, string | null>();
  const labelOf = async (
    at: { kind: "project" | "app"; id: string } | null,
  ): Promise<string | null> => {
    if (at === null || at.kind === "app") return null;
    const key = `${at.kind}:${at.id}`;
    if (labels.has(key)) return labels.get(key) ?? null;
    let name = at.id;
    const read = await projectOf(at.id);
    if (read.ok) name = read.value.name;
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
    const defined = await readOf(call, agentDefinitionList, {});
    for (const row of defined.ok ? defined.value.agents : []) {
      if (row.kind !== "operator" || row.issues.length > 0) continue;
      await add(row.agent, row.name, row.place);
    }
  }

  const skillsFolder = role === "project_manager" && place?.kind === "project"
    ? files.skillsFolder(place.id)
    : null;
  const scope = placeScope({
    role,
    place,
    projectFolders,
    artifactsFolder: artifacts,
    kindsFile,
    appSource: app?.source ?? null,
    skillsFolder,
    dataFolder: place?.kind === "project" ? files.dataFolder(place.id) : null,
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
      skillsFolder,
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
