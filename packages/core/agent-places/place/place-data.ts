import { err, ok, type Result } from "../../../base/mod.ts";
import {
  appToolIndex,
  appTools,
} from "../../../protocol/apps/declaration/read.ts";
import {
  appGet,
  appList,
  appUsage,
  packagesList,
} from "../../../protocol/apps/mod.ts";
import type { App } from "../../../protocol/apps/apps.ts";
import { agentList, placeKindOf } from "../../../protocol/lophn-agent/mod.ts";
import { projectApi } from "../../../protocol/projects/mod.ts";
import type { ResolvedAgent } from "../../lophn-agent/agents/mod.ts";
import {
  type PlaceAgent,
  type TurnPromptInput,
} from "../../lophn-agent/prompt-assembly/mod.ts";
import { type CoreCall, readOf } from "../../lophn-agent/run-loop/core-call.ts";
import {
  type FolderRead,
  type PlaceAppItem,
  type PlaceData,
  placeInfo,
  type PlaceProject,
} from "./place-info.ts";
import { type FolderScope, placeScope } from "./place-folders.ts";
import type { ArtifactEntry } from "./artifact-list.ts";

// place 폴더를 data root에서 찾고 만드는 file system 접근이다. 조립(runtime entry)이 꽂는다.
export type PlaceFiles = {
  // project·앱 place의 `skills/` 폴더. data root를 모르면 null.
  skillsFolder(place: { kind: "project" | "app"; id: string }): string | null;
  // project·앱 place의 `artifacts/` 폴더. data root를 모르면 null.
  artifactsFolder(place: {
    kind: "project" | "app";
    id: string;
  }): string | null;
  // place의 data 폴더. 폴더 자체는 core가 place를 만들 때 이미 만든다.
  dataFolder(place: { kind: "project" | "app"; id: string }): string | null;
  // project의 `workflows/` 폴더. data root를 모르면 null.
  workflowsFolder(project: string): string | null;
  ensureDir(path: string): Promise<void>;
  listArtifacts(folder: string): Promise<readonly ArtifactEntry[]>;
};

// prompt의 place 정보 재료를 turn의 agent 자격으로 core 읽기에서 모은다. turn마다 한 번 읽는다.
// file tool이 닿는 폴더(scope)도 같은 읽기에서 나온다. 읽은 값만 모아 place-folders의 규칙(placeScope)에 넘긴다.

type PlaceRead = {
  place: PlaceData;
  scope: FolderScope;
};

// place 정보의 앱 목록 예산(글자 수). 고정값이라 session을 시작할 때 정한 것과 같다.
const PLACE_TEXT_BUDGET = 12000;

const MAX_PAGES = 50;

async function pages<T>(
  next: (
    cursor: string | undefined,
  ) => Promise<Result<{ items: T[]; next_cursor: string | null }>>,
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
  folders: readonly FolderRead[];
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function placeProject(project: ProjectRecord): PlaceProject {
  return {
    id: project.id,
    name: project.name,
    purpose: project.purpose,
    folders: project.folders.map((f) => ({
      path: f.path,
      description: f.description,
    })),
  };
}

async function readPlaceData(
  call: CoreCall,
  agent: ResolvedAgent,
  files: PlaceFiles,
): Promise<Result<PlaceRead>> {
  const { place } = agent;
  const projects = new Map<string, ProjectRecord>();
  const projectOf = async (id: string): Promise<Result<ProjectRecord>> => {
    const known = projects.get(id);
    if (known !== undefined) return ok(known);
    const read = await readOf(call, projectApi.get, { project: id });
    if (!read.ok) return read;
    projects.set(id, read.value.project);
    return ok(read.value.project);
  };
  const appRecords = new Map<string, App>();
  const appOf = async (id: string): Promise<Result<App>> => {
    const known = appRecords.get(id);
    if (known !== undefined) return ok(known);
    const read = await readOf(call, appGet, { app: id });
    if (!read.ok) return read;
    appRecords.set(id, read.value.app);
    return ok(read.value.app);
  };
  // active 앱 전체. home의 앱 목록이 쓴다.
  let activeApps: Promise<Result<App[]>> | undefined;
  const readActiveApps = () =>
    (activeApps ??= pages(async (cursor) => {
      const read = await readOf(call, appList, {
        status: "active",
        ...(cursor === undefined ? {} : { cursor }),
      });
      return read.ok
        ? ok({ items: read.value.apps, next_cursor: read.value.next_cursor })
        : read;
    }).then((read) => {
      if (read.ok) {
        for (const a of read.value) appRecords.set(a.id, a);
      }
      return read;
    }));

  let project: PlaceProject | null = null;
  let app: PlaceData["app"] = null;
  let release: PlaceData["release"] = null;
  let projectFolders: string[] = [];
  let appSource: string | null = null;
  let appFolders: string[] = [];

  if (place?.kind === "project") {
    const read = await projectOf(place.id);
    if (!read.ok) return read;
    project = placeProject(read.value);
    projectFolders = read.value.folders.map((f) => f.path);
  } else if (place?.kind === "app") {
    const read = await appOf(place.id);
    if (!read.ok) return read;
    const found = read.value;
    appSource = found.source_path;
    appFolders = found.folders.map((f) => f.path);
    app = {
      id: found.id,
      name: found.name,
      purpose: found.description,
      source: appSource,
      folders: found.folders.map((f) => ({
        path: f.path,
        description: f.description,
      })),
      declaration: appSource === null ? "lophn.ts" : `${appSource}/lophn.ts`,
    };
    if (found.active_release !== null) {
      const tools = await readOf(call, appTools, { app: found.id });
      if (tools.ok) {
        release = {
          version: tools.value.release,
          command_names: tools.value.tools.map((tool) => tool.name),
        };
      }
    }
  }

  // home: 모든 project와 앱의 목록(앱마다 공개 command와 쓰는 곳). 폴더는 읽기만 열린다.
  const projectList: { name: string; purpose: string }[] = [];
  const appItems: PlaceAppItem[] = [];
  const allProjectFolders: string[] = [];
  if (place === null) {
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
    const apps = await readActiveApps();
    if (!apps.ok) return apps;
    for (const record of listed.value) {
      projects.set(record.id, record);
      projectList.push({ name: record.name, purpose: record.purpose });
      allProjectFolders.push(...record.folders.map((f) => f.path));
    }
    // 읽기 오류는 그 덩어리만 비우고 간다.
    const index = await readOf(call, appToolIndex, {});
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
    // package는 주인 앱의 줄에 싣는다.
    const packagesOf = new Map<string, string[]>();
    for (const pkg of catalog.ok ? catalog.value : []) {
      if (pkg.owner_app === null) continue;
      const list = packagesOf.get(pkg.owner_app) ?? [];
      list.push(...pkg.versions.map((v) => `${pkg.name}@${v.version}`));
      packagesOf.set(pkg.owner_app, list);
    }
    for (const a of apps.value) {
      const tools = (toolsOf.get(a.id) ?? []).filter((t) => t.public);
      const toolNames = new Set(tools.map((t) => t.name));
      const uses = !usage.ok
        ? []
        : usage.value.uses.filter(
            (u) => u.app === a.id && toolNames.has(u.tool),
          );
      appItems.push({
        name: a.name,
        slug: a.slug,
        purpose: a.description,
        packages: packagesOf.get(a.id) ?? [],
        commands: tools.map((t) => ({
          key: t.name,
          effect: t.effect,
          description: t.description,
        })),
        usedBy: uses.map((u) => ({
          tool: u.tool,
          place:
            (u.place.kind === "project"
              ? projects.get(u.place.id)?.name
              : appRecords.get(u.place.id)?.name) ?? u.place.id,
        })),
      });
    }
  }

  // 부를 수 있는 agent는 전역 정의 목록의 이름뿐이다. 자기 자신도 넣는다: 다른 place의 자기에게 call할 수 있다.
  const listed = await readOf(call, agentList, {});
  if (!listed.ok) return listed;
  const agents: PlaceAgent[] = listed.value.agents
    .filter((row) => row.issues.length === 0)
    .map((row) => ({ name: row.name }));

  // project place의 turn 시작에 workflows 폴더를 만든다(없는 허용 폴더는 file scope가 건너뛴다). 만들지 못하면 범위에서 빠진 채 간다.
  let workflowsFolder: string | null = null;
  if (place?.kind === "project") {
    const folder = files.workflowsFolder(place.id);
    if (folder !== null) {
      try {
        await files.ensureDir(folder);
        workflowsFolder = folder;
      } catch {
        /* 폴더가 없으면 범위에서 빠진다 */
      }
    }
  }

  // project·앱 place의 turn 시작에 skills 폴더를 만든다(workflows와 같다).
  let skillsFolder: string | null = null;
  if (place !== null) {
    const folder = files.skillsFolder(place);
    if (folder !== null) {
      try {
        await files.ensureDir(folder);
        skillsFolder = folder;
      } catch {
        /* 폴더가 없으면 범위에서 빠진다 */
      }
    }
  }

  // project·앱 place의 turn 시작에 artifacts 폴더를 만든다(workflows와 같다).
  let artifacts: PlaceData["artifacts"] = null;
  if (place !== null) {
    const folder = files.artifactsFolder(place);
    if (folder !== null) {
      try {
        await files.ensureDir(folder);
        artifacts = {
          folder,
          items: await files.listArtifacts(folder).catch(() => []),
        };
      } catch {
        /* 폴더가 없으면 범위에서 빠진다 */
      }
    }
  }

  const scope = placeScope({
    place,
    projectFolders,
    appSource,
    appFolders,
    dataFolder: place === null ? null : files.dataFolder(place),
    allProjectFolders,
    workflowsFolder,
    skillsFolder,
    artifactsFolder: artifacts?.folder ?? null,
  });
  return ok({
    place: {
      self: { name: agent.name },
      project,
      app,
      agents,
      apps: appItems,
      projects: projectList,
      release,
      workflowsFolder,
      skillsFolder,
      artifacts,
    },
    scope,
  });
}

// prompt가 받는 place 값과 file 범위다. 글은 여기서 정해 harness는 place 종류만 안다.
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
  return ok({
    place: {
      text: placeInfo(placeKindOf(agent.place), place, PLACE_TEXT_BUDGET),
      agents: place.agents,
    },
    scope,
  });
}
