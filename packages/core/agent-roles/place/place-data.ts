import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
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
import {
  DOMAIN_ARTIFACTS_FOLDER,
  DOMAIN_SKILLS_FOLDER,
} from "../../../protocol/domains/paths.ts";
import {
  domainList,
  type DomainRecord,
} from "../../../protocol/domains/mod.ts";
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
  type MapDomain,
  type PlaceData,
  type PlaceDomain,
  placeInfo,
  type PlaceProject,
} from "./place-info.ts";
import {
  type FolderScope,
  type PlaceFacts,
  placeScope,
} from "./place-folders.ts";
import type { ArtifactEntry } from "./artifact-list.ts";

// domain 폴더를 data root에서 찾고 만드는 file system 접근이다. 조립(runtime entry)이 꽂는다.
export type PlaceFiles = {
  // domain의 폴더(`DOMAIN.md`, `kinds.yaml`, `skills/`, `artifacts/`). data root를 모르면 null.
  domainFolder(domain: string): string | null;
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

// place 정보의 kind 글 예산(글자 수). 고정값이라 session을 시작할 때 정한 것과 같다.
const KIND_TEXT_BUDGET = 12000;

// 부를 수 있는 agent 목록에 붙는 한 줄. agent 정의에 설명 칸이 없어 role마다 고정 문장이다.
const ROLE_LINE: Record<Role, string> = {
  lophn: "Plans work, registers apps, and hands work to others.",
  project_manager:
    "Looks after the project's folders and its domains: DOMAIN.md, kinds and skills.",
  app_engineer:
    "Designs, builds and releases the app, and looks after its domains.",
  operator: "Works with the kinds and tools it was granted.",
};

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
  folders: readonly {
    path: string;
    description: string;
    subfolders: readonly FolderRead[];
  }[];
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
  const appRecords = new Map<string, App>();
  const appOf = async (id: string): Promise<Result<App>> => {
    const known = appRecords.get(id);
    if (known !== undefined) return ok(known);
    const read = await readOf(call, appGet, { app: id });
    if (!read.ok) return read;
    appRecords.set(id, read.value.app);
    return ok(read.value.app);
  };
  // active 앱 전체. lophn의 목록과 부를 수 있는 App Engineer 후보가 같이 쓴다.
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
    app = {
      id: found.id,
      name: found.name,
      purpose: found.description,
      source: appSource,
      declaration: appSource === null ? "lophn.ts" : `${appSource}/lophn.ts`,
    };
    if (found.active_release !== null) {
      const tools = await readOf(call, appTools, { app: found.id });
      if (tools.ok) {
        release = {
          version: tools.value.release,
          tool_names: tools.value.tools.map((tool) => tool.name),
        };
      }
    }
  }

  // 이 agent가 맡은 domain. 읽지 못한 domain은 빼고 turn은 계속한다.
  const domains: PlaceDomain[] = [];
  const scopeDomains: PlaceFacts["domains"][number][] = [];
  const kindDomains: Parameters<typeof buildKindText>[0]["domains"][number][] =
    [];
  const kindHashes: string[] = [];
  if (place !== null && role !== "lophn") {
    const listed = await pages(async (cursor) => {
      const read = await readOf(call, domainList, {
        owner: place,
        status: "active",
        ...(cursor === undefined ? {} : { cursor }),
      });
      return read.ok
        ? ok({ items: read.value.domains, next_cursor: read.value.next_cursor })
        : read;
    });
    const mine = (listed.ok ? listed.value : []).filter((d) =>
      agent.domains.includes(d.id),
    );
    for (const d of mine) {
      let folder: string | null = null;
      let artifacts: PlaceDomain["artifacts"] = null;
      const root = files.domainFolder(d.id);
      if (root !== null) {
        const artifactsFolder = `${root}/${DOMAIN_ARTIFACTS_FOLDER}`;
        // 첫 쓰기 전에 폴더가 있어야 한다. 없는 허용 폴더는 file scope가 건너뛴다. 만들지 못하면 범위에서 빠진 채 간다.
        try {
          await files.ensureDir(root);
          await files.ensureDir(`${root}/${DOMAIN_SKILLS_FOLDER}`);
          await files.ensureDir(artifactsFolder);
          folder = root;
        } catch {
          /* 폴더가 없으면 범위에서 빠진다 */
        }
        if (folder !== null) {
          scopeDomains.push({ id: d.id, folder, artifactsFolder });
          artifacts = {
            folder: artifactsFolder,
            items: await files.listArtifacts(artifactsFolder).catch(() => []),
          };
        }
      }
      domains.push({
        name: d.name,
        title: d.title,
        purpose: d.purpose,
        // Operator는 domain 폴더를 열지 못한다. 열리는 곳은 artifacts 폴더뿐이다.
        folder: role === "operator" ? null : folder,
        artifacts,
      });
      // kind 글만 비우고 turn은 계속한다.
      const got = await readOf(call, kindGet, { domain: d.id });
      if (got.ok) {
        const { status } = got.value;
        if (
          status.state !== "none" &&
          got.value.kinds !== null &&
          status.applied_hash !== null
        ) {
          kindDomains.push({
            name: d.name,
            kinds: got.value.kinds,
            warning: status.state === "invalid",
          });
          kindHashes.push(`${d.name}:${status.applied_hash}`);
        }
      }
    }
  }
  const kinds: PlaceKinds | null =
    kindDomains.length === 0
      ? null
      : {
          hash: kindHashes.sort(cmp).join(","),
          text: buildKindText({ domains: kindDomains }),
        };

  // lophn: 모든 project와 앱의 목록과 domain 지도. 폴더는 읽기만 열린다.
  const projectList: { name: string; purpose: string }[] = [];
  const appItems: PlaceData["apps"][number][] = [];
  const map: MapDomain[] = [];
  const allProjectFolders: string[] = [];
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
    const apps = await readActiveApps();
    if (!apps.ok) return apps;
    for (const record of listed.value) {
      projects.set(record.id, record);
      projectList.push({ name: record.name, purpose: record.purpose });
      allProjectFolders.push(...record.folders.map((f) => f.path));
    }
    // 지도 재료. 읽기 오류는 그 덩어리만 비우고 간다.
    const domainRecords = await pages(async (cursor) => {
      const read = await readOf(call, domainList, {
        status: "active",
        ...(cursor === undefined ? {} : { cursor }),
      });
      return read.ok
        ? ok({ items: read.value.domains, next_cursor: read.value.next_cursor })
        : read;
    });
    const records: DomainRecord[] = domainRecords.ok ? domainRecords.value : [];
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
      appItems.push({
        name: a.name,
        purpose: a.description,
        packages: packagesOf.get(a.id) ?? [],
      });
    }
    const domainNameOf = (id: string) =>
      records.find((d) => d.id === id)?.name ?? id;
    for (const d of records) {
      const ownerApp = d.owner.kind === "app" ? d.owner.id : null;
      const tools =
        ownerApp === null
          ? []
          : (toolsOf.get(ownerApp) ?? []).filter(
              (t) => t.public && t.domain === d.name,
            );
      const toolNames = new Set(tools.map((t) => t.name));
      const uses =
        ownerApp === null || !usage.ok
          ? []
          : usage.value.uses.filter(
              (u) =>
                u.app === ownerApp &&
                toolNames.has(u.tool) &&
                u.domain !== d.id,
            );
      map.push({
        name: d.name,
        owner:
          d.owner.kind === "project"
            ? `project ${projects.get(d.owner.id)?.name ?? d.owner.id}`
            : `app ${appRecords.get(d.owner.id)?.name ?? d.owner.id}`,
        purpose: d.purpose,
        tools: tools.map((t) => ({
          key: t.name,
          effect: t.effect,
          description: t.description,
        })),
        usedBy: uses.map((u) => ({
          tool: u.tool,
          domain: domainNameOf(u.domain),
        })),
      });
    }
  }

  // 부를 수 있는 열린 session. 자기 session은 core가 뺐다.
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
    const read =
      at.kind === "project" ? await projectOf(at.id) : await appOf(at.id);
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
      found.role === role &&
      found.name === agent.name &&
      found.place === (await labelOf(place))
    )
      continue;
    agents.set(`${found.role}\0${found.name}\0${found.place}`, found);
  }

  // session이 아직 없는 상대도 부를 수 있다(call이 새 session을 연다). 자기 자신만 뺀다.
  const own = canonicalize(agent.agent);
  const add = async (
    ref: AgentRef,
    name: string,
    at: { kind: "project" | "app"; id: string } | null,
  ) => {
    if (canonicalize(ref) === own) return;
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
    await add({ role: "project_manager", project: record.id }, record.name, {
      kind: "project",
      id: record.id,
    });
  }
  const appsRead = await readActiveApps();
  for (const record of appsRead.ok ? appsRead.value : []) {
    await add({ role: "app_engineer", app: record.id }, record.name, {
      kind: "app",
      id: record.id,
    });
  }
  const defined = await readOf(call, agentDefinitionList, {});
  for (const row of defined.ok ? defined.value.agents : []) {
    if (row.kind !== "operator" || row.issues.length > 0) continue;
    await add(row.agent, row.name, row.place);
  }

  // PM의 turn 시작에 workflows 폴더를 만든다(없는 허용 폴더는 file scope가 건너뛴다). 만들지 못하면 범위에서 빠진 채 간다.
  let workflowsFolder: string | null = null;
  if (place?.kind === "project") {
    const folder = files.workflowsFolder(place.id);
    if (folder !== null) {
      if (role === "project_manager") {
        try {
          await files.ensureDir(folder);
          workflowsFolder = folder;
        } catch {
          /* 폴더가 없으면 범위에서 빠진다 */
        }
      } else workflowsFolder = folder;
    }
  }

  const scope = placeScope({
    role,
    place,
    projectFolders,
    appSource,
    domains: scopeDomains,
    dataFolder: place === null ? null : files.dataFolder(place),
    allProjectFolders,
    workflowsFolder,
  });
  return ok({
    place: {
      self: { role, name: agent.name },
      project,
      app,
      agents: [...agents.values()],
      kinds,
      domains,
      apps: appItems,
      projects: projectList,
      map,
      release,
      workflowsFolder: role === "project_manager" ? workflowsFolder : null,
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
