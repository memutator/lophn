// 작업 공간 정본 reader(`declared`/`mentioned` 정적 영향 조회, 작업 공간 스냅샷, release 계약 변경 하류 조회).
// 별도 캐시 표를 두지 않고 부를 때 ledger와 디스크 정본을 직접 읽으며, 보관된(archived) 앱·project는 늘 건너뛴다.
// memory.md와 LOPHN.md는 읽지 않는다(인계 고정 문구로 정리한다).
import { lstat, readdir, readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import type { ContractChange } from "../../../../protocol/apps/releases.ts";
import type { WorkspaceUpdateSummary } from "../../../../protocol/apps/updates.ts";
import {
  type DeclaredRef,
  type FollowUpWorkspace,
  type Id,
  type ImpactSummary,
  idSchema,
  type MentionedRef,
  parseActor,
} from "../../../../protocol/base/mod.ts";
import {
  type JobAction,
  type JobTrigger,
  jobActionSchema,
  jobTriggerSchema,
} from "../../../../protocol/jobs/mod.ts";
import {
  type CallPolicy,
  DEFAULT_CALL_POLICY,
} from "../../../../protocol/lophn-agent/call-policy.ts";
import {
  type AgentId,
  type AgentRuntime,
  codingBuiltinOf,
  type ImpactTarget,
  impactRead,
  impactTargetSchema,
  isHarnessRuntime,
  isLophn,
  workspaceOfLophn,
} from "../../../../protocol/lophn-agent/mod.ts";
import { artifactsFolder } from "../../../../protocol/projects/artifact.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import {
  WORKFLOW_DECLARATION_FILE,
  WORKFLOW_FLOW_FILE,
  type WorkflowDeclaration,
  workflowDeclarationSchema,
  workflowFolder,
  workflowNameSchema,
  workflowsFolder,
} from "../../../../protocol/workflows/mod.ts";
import { workspaceDataSkillsFolder } from "../../../agent-workspaces/workspace/data-folder.ts";
import type { AppDeclaration } from "../../../apps/declaration/mod.ts";
import { loadApp, loadApps } from "../../../apps/registration/store.ts";
import { loadActiveDeclaration } from "../../../apps/releases/store.ts";
import { callPolicySetting } from "../../../config/setting-declarations.ts";
import { parseAgentFile } from "../../../lophn-agent/agents/definition-file.ts";
import {
  loadSession,
  workspaceOf,
} from "../../../lophn-agent/session/model.ts";
import { loadProject, loadProjects } from "../../../projects/registry/store.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

type Query = Pick<Sql, "get" | "all">;

export type ActiveAppSnapshot = {
  id: Id<"app">;
  slug: string;
  name: string;
  source_path: string | null;
  active_release: Id<"rel"> | null;
  declaration: AppDeclaration | null;
};

export type ActiveProjectSnapshot = {
  id: Id<"prj">;
  name: string;
  folders: readonly string[];
};

export type WorkflowSnapshot = {
  project: Id<"prj">;
  project_name: string;
  name: string;
  declaration: WorkflowDeclaration | null;
  flow_sdk: string | null;
  has_flow: boolean;
  flow_source: string | null;
};

export type SkillDocSnapshot = {
  workspace: FollowUpWorkspace | null;
  workspace_name: string;
  skill: string;
  file: string;
  content: string;
};

export type AgentSnapshot = {
  id: AgentId;
  handle: string;
  name: string;
  workspace: FollowUpWorkspace | null;
  runtime: AgentRuntime;
  // 이 agent에게 배포한 앱 skill의 앱 slug(agent 층의 배포만이다).
  apps: readonly string[];
};

export type JobSnapshot = {
  id: Id<"job">;
  title: string;
  creator_agent: string;
  creator_workspace: FollowUpWorkspace | null;
  enabled: boolean;
  action: JobAction;
  trigger: JobTrigger | null;
};

export type WorkspaceSnapshot = {
  apps: readonly ActiveAppSnapshot[];
  projects: readonly ActiveProjectSnapshot[];
  workflows: readonly WorkflowSnapshot[];
  skills: readonly SkillDocSnapshot[];
  agents: readonly AgentSnapshot[];
  jobs: readonly JobSnapshot[];
  summary: WorkspaceUpdateSummary;
};

export type WorkspaceReaderDeps = {
  sql: Query;
  dataRoot: string;
  callPolicy?: CallPolicy;
  secretNames?: () => Promise<readonly string[]> | readonly string[];
};

export type ImpactReadResult = {
  target_label: string;
  immediate: string[];
  impact: ImpactSummary;
};

export type ContractChangeInput = Pick<
  ContractChange,
  "surface" | "name" | "change"
>;

export type AffectedWorkspace = {
  workspace: FollowUpWorkspace | null;
  workspace_name: string;
  reasons: string[];
};

export type ReleaseContractImpact = {
  app: Id<"app">;
  slug: string;
  app_name: string;
  declared: DeclaredRef[];
  mentioned: MentionedRef[];
  affected_workspaces: AffectedWorkspace[];
};

function hasTable(sql: Query, name: string): boolean {
  return (
    sql.get(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?",
      [name],
    ) !== undefined
  );
}

function safeCount(
  sql: Query,
  query: string,
  params: readonly (string | number | null)[] = [],
): number {
  try {
    const row = sql.get(query, [...params]);
    return Number(row?.["n"] ?? 0);
  } catch {
    return 0;
  }
}

async function isRegularDir(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readTextIfFile(path: string): Promise<string | null> {
  try {
    if (!(await lstat(path)).isFile()) return null;
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function readDirNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((e) => e.name).sort();
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return [];
    return [];
  }
}

function parseWorkspaceId(raw: unknown): FollowUpWorkspace | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw.startsWith("prj_")) {
    return { kind: "project", id: raw as Id<"prj"> };
  }
  if (raw.startsWith("app_")) {
    return { kind: "app", id: raw as Id<"app"> };
  }
  return null;
}

function workspaceKey(workspace: FollowUpWorkspace | null): string {
  return workspace === null ? "home" : `${workspace.kind}:${workspace.id}`;
}

function sameWorkspace(
  a: FollowUpWorkspace | null,
  b: FollowUpWorkspace | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.id === b.id;
}

function parseWorkflowYaml(text: string | null): WorkflowDeclaration | null {
  if (text === null) return null;
  try {
    const parsed = parseYaml(text, { schema: "core" });
    const shaped = workflowDeclarationSchema.safeParse(parsed);
    return shaped.success ? shaped.data : null;
  } catch {
    return null;
  }
}

async function readSkillsUnder(
  rootDir: string,
  displayPrefix: string,
  workspace: FollowUpWorkspace | null,
  workspaceName: string,
): Promise<SkillDocSnapshot[]> {
  const out: SkillDocSnapshot[] = [];
  for (const name of await readDirNames(rootDir)) {
    const dir = `${rootDir}/${name}`;
    if (!(await isRegularDir(dir))) continue;
    const skillPath = `${dir}/SKILL.md`;
    const content = await readTextIfFile(skillPath);
    if (content === null) continue;
    out.push({
      workspace,
      workspace_name: workspaceName,
      skill: name,
      file: `${displayPrefix}/${name}/SKILL.md`,
      content,
    });
  }
  return out;
}

async function readAgentsFromDisk(
  dataRoot: string,
  activeAppIds: ReadonlySet<string>,
  activeProjectIds: ReadonlySet<string>,
): Promise<AgentSnapshot[]> {
  const folder = `${dataRoot}/agents`;
  const agents: AgentSnapshot[] = [];
  for (const entry of await readDirNames(folder)) {
    if (!entry.endsWith(".md")) continue;
    const id = entry.slice(0, -3);
    const validId =
      idSchema("agt").safeParse(id).success ||
      isLophn(id) ||
      codingBuiltinOf(id) !== null;
    if (!validId) continue;
    const text = await readTextIfFile(`${folder}/${entry}`);
    if (text === null) continue;
    const parsed = parseAgentFile(text, { agent: id as AgentId });
    if (!parsed.ok) continue;
    const def = parsed.value;
    let workspace: FollowUpWorkspace | null = null;
    if (isLophn(id)) {
      workspace = workspaceOfLophn(id) as FollowUpWorkspace | null;
    } else if (def.workspace !== undefined) {
      workspace = def.workspace as FollowUpWorkspace;
    }
    if (
      workspace !== null &&
      ((workspace.kind === "app" && !activeAppIds.has(workspace.id)) ||
        (workspace.kind === "project" && !activeProjectIds.has(workspace.id)))
    ) {
      continue;
    }
    agents.push({
      id: id as AgentId,
      handle: def.handle ?? id,
      name: def.name ?? def.handle ?? id,
      workspace,
      runtime: def.runtime ?? "lophn",
      apps: [...new Set((def.deployed_skills ?? []).map((one) => one.app))],
    });
  }
  return agents;
}

function readActiveJobs(
  sql: Query,
  activeAppIds: ReadonlySet<string>,
  activeProjectIds: ReadonlySet<string>,
): JobSnapshot[] {
  if (!hasTable(sql, "jobs")) return [];
  const jobs: JobSnapshot[] = [];
  const rows = sql.all(
    "SELECT id, title, creator_agent, creator_workspace, enabled, action, trigger FROM jobs ORDER BY id",
    [],
  );
  for (const row of rows) {
    const creatorWorkspace = parseWorkspaceId(row["creator_workspace"]);
    if (
      creatorWorkspace !== null &&
      ((creatorWorkspace.kind === "app" &&
        !activeAppIds.has(creatorWorkspace.id)) ||
        (creatorWorkspace.kind === "project" &&
          !activeProjectIds.has(creatorWorkspace.id)))
    ) {
      continue;
    }
    let parsedAction: ReturnType<typeof jobActionSchema.safeParse>;
    try {
      parsedAction = jobActionSchema.safeParse(
        JSON.parse(String(row["action"])),
      );
    } catch {
      continue;
    }
    if (!parsedAction.success) continue;
    let trigger: JobTrigger | null = null;
    if (row["trigger"] !== null && row["trigger"] !== undefined) {
      try {
        const parsedTrigger = jobTriggerSchema.safeParse(
          JSON.parse(String(row["trigger"])),
        );
        if (parsedTrigger.success) trigger = parsedTrigger.data;
      } catch {
        trigger = null;
      }
    }
    jobs.push({
      id: String(row["id"]) as Id<"job">,
      title: String(row["title"]),
      creator_agent: String(row["creator_agent"]),
      creator_workspace: creatorWorkspace,
      enabled: Number(row["enabled"]) === 1,
      action: parsedAction.data,
      trigger,
    });
  }
  return jobs;
}

function countPairedMachines(sql: Query): number {
  const devices = hasTable(sql, "devices")
    ? safeCount(sql, "SELECT COUNT(*) AS n FROM devices")
    : 0;
  const reach = hasTable(sql, "roster_reach")
    ? Math.max(0, safeCount(sql, "SELECT COUNT(*) AS n FROM roster_reach") - 1)
    : 0;
  return Math.max(devices, reach);
}

// 작업 공간의 활성 정본(보관된 앱·project 제외)을 디스크와 ledger에서 직접 읽는다.
export async function readWorkspaceSnapshot(
  deps: WorkspaceReaderDeps,
): Promise<Result<WorkspaceSnapshot>> {
  const { sql, dataRoot } = deps;
  const loadedApps = hasTable(sql, "apps") ? loadApps(sql, "active") : ok([]);
  if (!loadedApps.ok) return loadedApps;

  const apps: ActiveAppSnapshot[] = [];
  for (const app of loadedApps.value) {
    let declaration: AppDeclaration | null = null;
    if (hasTable(sql, "releases")) {
      const active = loadActiveDeclaration(sql, app.id);
      if (!active.ok) return active;
      declaration = active.value?.declaration ?? null;
    }
    apps.push({
      id: app.id as Id<"app">,
      slug: app.slug,
      name: app.name,
      source_path: app.source_path,
      active_release: app.active_release as Id<"rel"> | null,
      declaration,
    });
  }

  const loadedProjects = hasTable(sql, "projects") ? loadProjects(sql) : ok([]);
  if (!loadedProjects.ok) return loadedProjects;
  const projects: ActiveProjectSnapshot[] = loadedProjects.value
    .filter((p) => p.status === "active")
    .map((p) => ({
      id: p.id as Id<"prj">,
      name: p.name,
      folders: p.folders.map((f) => f.path),
    }));

  const activeAppIds = new Set(apps.map((a) => a.id));
  const activeProjectIds = new Set(projects.map((p) => p.id));

  const workflows: WorkflowSnapshot[] = [];
  const skills: SkillDocSnapshot[] = [];

  skills.push(
    ...(await readSkillsUnder(
      workspaceDataSkillsFolder(dataRoot, null),
      "home/skills",
      null,
      "Home",
    )),
  );

  for (const project of projects) {
    const wfRoot = workflowsFolder(dataRoot, project.id);
    for (const name of await readDirNames(wfRoot)) {
      if (!workflowNameSchema.safeParse(name).success) continue;
      const dir = workflowFolder(dataRoot, project.id, name);
      if (!(await isRegularDir(dir))) continue;
      const yamlText = await readTextIfFile(
        `${dir}/${WORKFLOW_DECLARATION_FILE}`,
      );
      const flowSource = await readTextIfFile(`${dir}/${WORKFLOW_FLOW_FILE}`);
      const declaration = parseWorkflowYaml(yamlText);
      workflows.push({
        project: project.id,
        project_name: project.name,
        name,
        declaration,
        flow_sdk: declaration?.flow_sdk ?? null,
        has_flow: flowSource !== null,
        flow_source: flowSource,
      });
    }

    const ws: FollowUpWorkspace = { kind: "project", id: project.id };
    skills.push(
      ...(await readSkillsUnder(
        workspaceDataSkillsFolder(dataRoot, ws),
        "skills",
        ws,
        project.name,
      )),
    );
    const primaryFolder = project.folders[0];
    if (primaryFolder !== undefined) {
      skills.push(
        ...(await readSkillsUnder(
          `${primaryFolder}/.lophn/skills`,
          ".lophn/skills",
          ws,
          project.name,
        )),
      );
    }
  }

  for (const app of apps) {
    const ws: FollowUpWorkspace = { kind: "app", id: app.id };
    skills.push(
      ...(await readSkillsUnder(
        workspaceDataSkillsFolder(dataRoot, ws),
        "skills",
        ws,
        app.name,
      )),
    );
    if (app.source_path !== null) {
      skills.push(
        ...(await readSkillsUnder(
          `${app.source_path}/.lophn/skills`,
          ".lophn/skills",
          ws,
          app.name,
        )),
      );
    }
  }

  const agents = await readAgentsFromDisk(
    dataRoot,
    activeAppIds,
    activeProjectIds,
  );
  const jobs = readActiveJobs(sql, activeAppIds, activeProjectIds);

  const providers = hasTable(sql, "providers")
    ? safeCount(sql, "SELECT COUNT(*) AS n FROM providers")
    : 0;
  const machines = countPairedMachines(sql);

  const summary: WorkspaceUpdateSummary = {
    active_apps: apps.length,
    active_projects: projects.length,
    workflows: workflows.length,
    custom_agents: agents.filter((a) => a.runtime === "custom").length,
    harness_agents: agents.filter((a) => isHarnessRuntime(a.runtime)).length,
    providers,
    machines,
  };

  return ok({
    apps,
    projects,
    workflows,
    skills,
    agents,
    jobs,
    summary,
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function excerptAt(source: string, index: number): string {
  const lineStart = source.lastIndexOf("\n", index) + 1;
  const lineEnd = source.indexOf("\n", index);
  const line = source
    .slice(lineStart, lineEnd === -1 ? source.length : lineEnd)
    .trim();
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

function wordMentionExcerpt(
  content: string,
  terms: readonly string[],
): string | null {
  for (const term of terms) {
    if (term.length === 0) continue;
    const pattern = new RegExp(
      `(?<![A-Za-z0-9_-])${escapeRegExp(term)}(?![A-Za-z0-9_-])`,
    );
    const match = pattern.exec(content);
    if (match !== null) {
      return excerptAt(content, match.index);
    }
  }
  return null;
}

// flow.ts 안의 agent(...), tool(...), workflow(...), onEvent(...) 리터럴 호출을 뽑는다.
// @lophn/flow 2.0 객체 인자(`tool({ app: "x", tool: "y" })`)와 문자열 리터럴 인자(`tool("x.y")`) 모두 잡는다.
function extractFlowToolCalls(
  source: string,
): Array<{ app: string; tool?: string; excerpt: string }> {
  const found: Array<{ app: string; tool?: string; excerpt: string }> = [];
  const objPattern = /\btool\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  for (const m of source.matchAll(objPattern)) {
    const body = m[1] ?? "";
    const appMatch = /\bapp\s*:\s*["'`]([^"'`]+)["'`]/.exec(body);
    if (appMatch === null) continue;
    const toolMatch = /\btool\s*:\s*["'`]([^"'`]+)["'`]/.exec(body);
    found.push({
      app: appMatch[1],
      ...(toolMatch !== null ? { tool: toolMatch[1] } : {}),
      excerpt: excerptAt(source, m.index ?? 0),
    });
  }
  const strPattern =
    /\btool\s*\(\s*["'`]([^"'`]+)["'`](?:\s*,\s*["'`]([^"'`]+)["'`])?/g;
  for (const m of source.matchAll(strPattern)) {
    const first = m[1];
    const second = m[2];
    if (second !== undefined) {
      found.push({
        app: first,
        tool: second,
        excerpt: excerptAt(source, m.index ?? 0),
      });
    } else {
      const sep = /[.:/]/.exec(first);
      if (sep !== null) {
        found.push({
          app: first.slice(0, sep.index),
          tool: first.slice(sep.index + 1),
          excerpt: excerptAt(source, m.index ?? 0),
        });
      } else {
        found.push({
          app: first,
          excerpt: excerptAt(source, m.index ?? 0),
        });
      }
    }
  }
  return found;
}

function extractFlowOnEventCalls(
  source: string,
): Array<{ source: string; event?: string; excerpt: string }> {
  const found: Array<{ source: string; event?: string; excerpt: string }> = [];
  const objPattern = /\bonEvent\s*\(\s*\{([\s\S]*?)\}/g;
  for (const m of source.matchAll(objPattern)) {
    const body = m[1] ?? "";
    const srcMatch = /\bsource\s*:\s*["'`]([^"'`]+)["'`]/.exec(body);
    if (srcMatch === null) continue;
    const evMatch = /\bevent\s*:\s*["'`]([^"'`]+)["'`]/.exec(body);
    found.push({
      source: srcMatch[1],
      ...(evMatch !== null ? { event: evMatch[1] } : {}),
      excerpt: excerptAt(source, m.index ?? 0),
    });
  }
  const strPattern =
    /\bonEvent\s*\(\s*["'`]([^"'`]+)["'`](?:\s*,\s*["'`]([^"'`]+)["'`])?/g;
  for (const m of source.matchAll(strPattern)) {
    const first = m[1];
    const second = m[2];
    if (second !== undefined) {
      found.push({
        source: first,
        event: second,
        excerpt: excerptAt(source, m.index ?? 0),
      });
    } else {
      const sep = /[.:/]/.exec(first);
      if (sep !== null) {
        found.push({
          source: first.slice(0, sep.index),
          event: first.slice(sep.index + 1),
          excerpt: excerptAt(source, m.index ?? 0),
        });
      } else {
        found.push({
          source: first,
          excerpt: excerptAt(source, m.index ?? 0),
        });
      }
    }
  }
  return found;
}

function extractFlowAgentCalls(
  source: string,
): Array<{ agent: string; excerpt: string }> {
  const found: Array<{ agent: string; excerpt: string }> = [];
  const strPattern = /\bagent\s*\(\s*["'`]([^"'`]+)["'`]/g;
  for (const m of source.matchAll(strPattern)) {
    found.push({ agent: m[1], excerpt: excerptAt(source, m.index ?? 0) });
  }
  const objPattern = /\bagent\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  for (const m of source.matchAll(objPattern)) {
    const body = m[1] ?? "";
    const inner = /\bagent\s*:\s*["'`]([^"'`]+)["'`]/.exec(body);
    if (inner !== null) {
      found.push({ agent: inner[1], excerpt: excerptAt(source, m.index ?? 0) });
    }
  }
  const humanPattern = /\bhuman\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  for (const m of source.matchAll(humanPattern)) {
    const body = m[1] ?? "";
    const direct = /\bwith\s*:\s*["'`]([^"'`]+)["'`]/.exec(body);
    if (direct !== null) {
      found.push({
        agent: direct[1],
        excerpt: excerptAt(source, m.index ?? 0),
      });
      continue;
    }
    const nested = /\bwith\s*:\s*\{[^}]*\bagent\s*:\s*["'`]([^"'`]+)["'`]/.exec(
      body,
    );
    if (nested !== null) {
      found.push({
        agent: nested[1],
        excerpt: excerptAt(source, m.index ?? 0),
      });
    }
  }
  return found;
}

function extractFlowWorkflowCalls(
  source: string,
): Array<{ workflow: string; excerpt: string }> {
  const found: Array<{ workflow: string; excerpt: string }> = [];
  const strPattern = /\bworkflow\s*\(\s*["'`]([^"'`]+)["'`]/g;
  for (const m of source.matchAll(strPattern)) {
    found.push({ workflow: m[1], excerpt: excerptAt(source, m.index ?? 0) });
  }
  const objPattern = /\bworkflow\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  for (const m of source.matchAll(objPattern)) {
    const body = m[1] ?? "";
    const wfMatch = /\bworkflow\s*:\s*["'`]([^"'`]+)["'`]/.exec(body);
    if (wfMatch !== null) {
      found.push({
        workflow: wfMatch[1],
        excerpt: excerptAt(source, m.index ?? 0),
      });
    }
  }
  return found;
}

function workspaceNameResolver(snapshot: WorkspaceSnapshot) {
  const projectNames = new Map<string, string>(
    snapshot.projects.map((p) => [p.id, p.name]),
  );
  const appNames = new Map<string, string>(
    snapshot.apps.map((a) => [a.id, a.name]),
  );
  return (workspace: FollowUpWorkspace | null): string => {
    if (workspace === null) return "Home";
    if (workspace.kind === "project") {
      return projectNames.get(workspace.id) ?? workspace.id;
    }
    return appNames.get(workspace.id) ?? workspace.id;
  };
}

function matchesAgentScope(
  agentWorkspace: FollowUpWorkspace | null,
  workflowProjectId: Id<"prj">,
  workflowProjectName: string,
  explicitWorkspace:
    | { project: string }
    | { app: string }
    | { home: true }
    | undefined,
  appById: ReadonlyMap<string, ActiveAppSnapshot>,
  projectById: ReadonlyMap<string, ActiveProjectSnapshot>,
): boolean {
  if (agentWorkspace === null) {
    // 전역 agent는 workspace 지정이 없거나 home일 때 어디서나 부른다.
    return explicitWorkspace === undefined || "home" in explicitWorkspace;
  }
  if (explicitWorkspace !== undefined) {
    if ("home" in explicitWorkspace) return false;
    if ("project" in explicitWorkspace) {
      if (agentWorkspace.kind !== "project") return false;
      const p = projectById.get(agentWorkspace.id);
      return (
        explicitWorkspace.project === agentWorkspace.id ||
        (p !== undefined && explicitWorkspace.project === p.name)
      );
    }
    if (agentWorkspace.kind !== "app") return false;
    const a = appById.get(agentWorkspace.id);
    return (
      explicitWorkspace.app === agentWorkspace.id ||
      (a !== undefined &&
        (explicitWorkspace.app === a.slug || explicitWorkspace.app === a.name))
    );
  }
  return (
    agentWorkspace.kind === "project" &&
    (agentWorkspace.id === workflowProjectId ||
      projectById.get(agentWorkspace.id)?.name === workflowProjectName)
  );
}

// 대상(app·agent·artifact·workflow)을 지우거나 고치기 전 즉각 정리 항목(immediate)과
// lophn 인계 대상(declared: 정확 / mentioned: 후보)을 계산한다.
export async function scanImpact(
  deps: WorkspaceReaderDeps,
  target: ImpactTarget,
): Promise<Result<ImpactReadResult>> {
  const snapshotResult = await readWorkspaceSnapshot(deps);
  if (!snapshotResult.ok) return snapshotResult;
  const snapshot = snapshotResult.value;
  const wsName = workspaceNameResolver(snapshot);
  const declared: DeclaredRef[] = [];
  const mentioned: MentionedRef[] = [];
  const immediate: string[] = [];

  if (target.kind === "app") {
    const loaded = loadApp(deps.sql, target.app);
    if (!loaded.ok) return loaded;
    if (loaded.value === null) {
      return err({ code: "not_found", message: "app not found" });
    }
    const app = loaded.value;
    const target_label = `${app.name} (${app.slug})`;

    const openSessions = hasTable(deps.sql, "sessions")
      ? safeCount(
          deps.sql,
          "SELECT COUNT(*) AS n FROM sessions WHERE workspace_kind = 'app' AND workspace_id = ? AND lifecycle = 'open'",
          [app.id],
        )
      : 0;
    const releasesCount = hasTable(deps.sql, "releases")
      ? safeCount(
          deps.sql,
          "SELECT COUNT(*) AS n FROM releases WHERE app = ?",
          [app.id],
        )
      : 0;
    const erasedJobs = snapshot.jobs.filter(
      (j) =>
        (j.creator_workspace?.kind === "app" &&
          j.creator_workspace.id === app.id) ||
        (j.action.kind === "tool_run" && j.action.app === app.id) ||
        (j.trigger !== null &&
          j.trigger.source_machine === undefined &&
          j.trigger.app === app.id),
    );
    const scopedAgents = snapshot.agents.filter(
      (a) => a.workspace?.kind === "app" && a.workspace.id === app.id,
    );
    const assignedAgents = snapshot.agents.filter(
      (a) =>
        !(a.workspace?.kind === "app" && a.workspace.id === app.id) &&
        a.apps.includes(app.id),
    );

    immediate.push(
      `App data and ${releasesCount} release${releasesCount === 1 ? "" : "s"}`,
    );
    if (openSessions > 0) {
      immediate.push(
        `${openSessions} open session${openSessions === 1 ? "" : "s"}`,
      );
    }
    if (scopedAgents.length > 0) {
      immediate.push(
        `${scopedAgents.length} app-scoped agent definition${scopedAgents.length === 1 ? "" : "s"}`,
      );
    }
    if (erasedJobs.length > 0) {
      immediate.push(
        `${erasedJobs.length} job${erasedJobs.length === 1 ? "" : "s"}`,
      );
    }
    if (assignedAgents.length > 0) {
      immediate.push(
        `${assignedAgents.length} agent skill deployment${assignedAgents.length === 1 ? "" : "s"}`,
      );
    }

    for (const other of snapshot.apps) {
      if (other.id === app.id || other.declaration === null) continue;
      for (const conn of other.declaration.app_connections) {
        if (conn.app === app.id || conn.app === app.slug) {
          declared.push({
            kind: "app_connection",
            workspace: { kind: "app", id: other.id },
            workspace_name: other.name,
            label: `${other.slug} -> ${conn.commands.join(", ")}`,
            detail: conn.reason,
          });
        }
      }
      for (const sub of other.declaration.subscriptions ?? []) {
        if (
          sub.machine === undefined &&
          (sub.source === app.slug || sub.source === app.id)
        ) {
          declared.push({
            kind: "app_subscription",
            workspace: { kind: "app", id: other.id },
            workspace_name: other.name,
            label: `${other.slug} subscribes to ${sub.source}.${sub.event}`,
            detail: `on.${sub.source}.${sub.event}`,
          });
        }
      }
    }

    for (const job of snapshot.jobs) {
      if (
        job.creator_workspace?.kind === "app" &&
        job.creator_workspace.id === app.id
      ) {
        continue;
      }
      if (job.action.kind === "tool_run" && job.action.app === app.id) {
        declared.push({
          kind: "job_action",
          workspace: job.creator_workspace,
          workspace_name: wsName(job.creator_workspace),
          label: job.title,
          detail: `tool_run ${app.slug}.${job.action.tool}`,
        });
      }
      if (
        job.trigger !== null &&
        job.trigger.source_machine === undefined &&
        job.trigger.app === app.id
      ) {
        declared.push({
          kind: "job_trigger",
          workspace: job.creator_workspace,
          workspace_name: wsName(job.creator_workspace),
          label: job.title,
          detail: `event trigger ${app.slug}.${job.trigger.event}`,
        });
      }
    }

    for (const agent of assignedAgents) {
      declared.push({
        kind: "agent_app_assignment",
        workspace: agent.workspace,
        workspace_name: wsName(agent.workspace),
        label: `@${agent.handle}`,
        detail: `deployed skills of app ${app.slug}`,
      });
    }

    for (const wf of snapshot.workflows) {
      if (wf.flow_source === null) continue;
      const ws: FollowUpWorkspace = { kind: "project", id: wf.project };
      const file = `workflows/${wf.name}/${WORKFLOW_FLOW_FILE}`;
      for (const call of extractFlowToolCalls(wf.flow_source)) {
        if (call.app === app.slug || call.app === app.id) {
          mentioned.push({
            kind: "flow_literal",
            workspace: ws,
            workspace_name: wf.project_name,
            file,
            excerpt: call.excerpt,
          });
        }
      }
      for (const ev of extractFlowOnEventCalls(wf.flow_source)) {
        if (ev.source === app.slug || ev.source === app.id) {
          mentioned.push({
            kind: "flow_literal",
            workspace: ws,
            workspace_name: wf.project_name,
            file,
            excerpt: ev.excerpt,
          });
        }
      }
    }

    for (const doc of snapshot.skills) {
      if (doc.workspace?.kind === "app" && doc.workspace.id === app.id) {
        continue;
      }
      const excerpt = wordMentionExcerpt(doc.content, [app.slug, app.id]);
      if (excerpt !== null) {
        mentioned.push({
          kind: "skill_mention",
          workspace: doc.workspace,
          workspace_name: doc.workspace_name,
          file: doc.file,
          excerpt,
        });
      }
    }

    return ok({ target_label, immediate, impact: { declared, mentioned } });
  }

  if (target.kind === "agent") {
    const fileText = await readTextIfFile(
      `${deps.dataRoot}/agents/${target.agent}.md`,
    );
    if (fileText === null) {
      return err({ code: "not_found", message: "agent not found" });
    }
    const parsed = parseAgentFile(fileText, { agent: target.agent });
    const handle = parsed.ok
      ? (parsed.value.handle ?? target.agent)
      : target.agent;
    const name = parsed.ok ? (parsed.value.name ?? handle) : handle;
    const agentWorkspace: FollowUpWorkspace | null = parsed.ok
      ? ((parsed.value.workspace as FollowUpWorkspace | undefined) ?? null)
      : null;
    const target_label = `${name} (@${handle})`;

    const openSessions = hasTable(deps.sql, "sessions")
      ? safeCount(
          deps.sql,
          "SELECT COUNT(*) AS n FROM sessions WHERE agent = ? AND lifecycle = 'open'",
          [target.agent],
        )
      : 0;
    const agentJobs = snapshot.jobs.filter(
      (j) =>
        j.creator_agent === target.agent ||
        (j.action.kind === "agent_run" && j.action.agent === target.agent),
    );
    const secretList = deps.secretNames ? await deps.secretNames() : [];
    const mcpSecrets = secretList.filter(
      (key) =>
        key.startsWith(`mcp.${target.agent}.`) ||
        key.startsWith(`mcp-oauth.${target.agent}.`),
    );
    const policy = deps.callPolicy ?? DEFAULT_CALL_POLICY;
    const policyRules = policy.agents.filter(
      (rule) => rule.from === target.agent || rule.to === target.agent,
    );

    immediate.push(`Agent definition and memory (@${handle})`);
    if (openSessions > 0) {
      immediate.push(
        `${openSessions} open session${openSessions === 1 ? "" : "s"}`,
      );
    }
    if (agentJobs.length > 0) {
      immediate.push(
        `${agentJobs.length} job${agentJobs.length === 1 ? "" : "s"}`,
      );
    }
    if (mcpSecrets.length > 0) {
      immediate.push(
        `${mcpSecrets.length} MCP secret${mcpSecrets.length === 1 ? "" : "s"}`,
      );
    }
    if (policyRules.length > 0) {
      immediate.push(
        `${policyRules.length} call policy rule${policyRules.length === 1 ? "" : "s"}`,
      );
    }

    for (const job of snapshot.jobs) {
      if (
        job.action.kind === "agent_run" &&
        job.action.agent === target.agent
      ) {
        declared.push({
          kind: "job_action",
          workspace: job.creator_workspace,
          workspace_name: wsName(job.creator_workspace),
          label: job.title,
          detail: `agent_run @${handle}`,
        });
      }
    }

    const appById = new Map(snapshot.apps.map((a) => [a.id, a]));
    const projectById = new Map(snapshot.projects.map((p) => [p.id, p]));
    const matchesRef = (ref: string) => ref === handle || ref === target.agent;

    for (const wf of snapshot.workflows) {
      const ws: FollowUpWorkspace = { kind: "project", id: wf.project };
      if (wf.declaration !== null) {
        for (const [key, participant] of Object.entries(
          wf.declaration.participants ?? {},
        )) {
          if ("kind" in participant || participant.on !== undefined) continue;
          if (
            matchesRef(participant.agent) &&
            matchesAgentScope(
              agentWorkspace,
              wf.project,
              wf.project_name,
              participant.workspace,
              appById,
              projectById,
            )
          ) {
            declared.push({
              kind: "workflow_participant",
              workspace: ws,
              workspace_name: wf.project_name,
              label: `${wf.name} (${key})`,
              detail: `participant agent ${participant.agent}`,
            });
          }
        }
        if (
          wf.declaration.agent !== undefined &&
          matchesRef(wf.declaration.agent) &&
          matchesAgentScope(
            agentWorkspace,
            wf.project,
            wf.project_name,
            undefined,
            appById,
            projectById,
          )
        ) {
          declared.push({
            kind: "workflow_creator",
            workspace: ws,
            workspace_name: wf.project_name,
            label: wf.name,
            detail: `creator agent ${wf.declaration.agent}`,
          });
        }
        for (const [inputKey, field] of Object.entries(
          wf.declaration.inputs ?? {},
        )) {
          if (
            field.type === "agent" &&
            typeof field.default === "string" &&
            matchesRef(field.default) &&
            matchesAgentScope(
              agentWorkspace,
              wf.project,
              wf.project_name,
              undefined,
              appById,
              projectById,
            )
          ) {
            declared.push({
              kind: "workflow_input",
              workspace: ws,
              workspace_name: wf.project_name,
              label: `${wf.name} (input: ${inputKey})`,
              detail: `default agent ${field.default}`,
            });
          }
        }
      }

      if (wf.flow_source !== null) {
        const file = `workflows/${wf.name}/${WORKFLOW_FLOW_FILE}`;
        for (const call of extractFlowAgentCalls(wf.flow_source)) {
          if (
            matchesRef(call.agent) &&
            matchesAgentScope(
              agentWorkspace,
              wf.project,
              wf.project_name,
              undefined,
              appById,
              projectById,
            )
          ) {
            mentioned.push({
              kind: "flow_literal",
              workspace: ws,
              workspace_name: wf.project_name,
              file,
              excerpt: call.excerpt,
            });
          }
        }
      }
    }

    for (const doc of snapshot.skills) {
      if (
        agentWorkspace !== null &&
        doc.workspace !== null &&
        !sameWorkspace(doc.workspace, agentWorkspace)
      ) {
        continue;
      }
      const excerpt = wordMentionExcerpt(doc.content, [
        `@${handle}`,
        handle,
        target.agent,
      ]);
      if (excerpt !== null) {
        mentioned.push({
          kind: "skill_mention",
          workspace: doc.workspace,
          workspace_name: doc.workspace_name,
          file: doc.file,
          excerpt,
        });
      }
    }

    return ok({ target_label, immediate, impact: { declared, mentioned } });
  }

  if (target.kind === "workflow") {
    const project = loadProject(deps.sql, target.project);
    if (!project.ok) return project;
    if (project.value === null) {
      return err({ code: "not_found", message: "project not found" });
    }
    const dir = workflowFolder(deps.dataRoot, target.project, target.name);
    if (!(await isRegularDir(dir))) {
      return err({ code: "not_found", message: "workflow not found" });
    }
    const target_label = `${project.value.name}/${target.name}`;

    const runningInstances = hasTable(deps.sql, "workflow_instances")
      ? safeCount(
          deps.sql,
          "SELECT COUNT(*) AS n FROM workflow_instances WHERE project = ? AND workflow = ? AND state = 'running'",
          [target.project, target.name],
        )
      : 0;
    const wfJobs = snapshot.jobs.filter(
      (j) =>
        j.action.kind === "workflow_start" &&
        j.action.project === target.project &&
        j.action.workflow === target.name,
    );

    immediate.push(`Workflow folder workflows/${target.name} and desk layout`);
    if (runningInstances > 0) {
      immediate.push(
        `${runningInstances} running workflow instance${runningInstances === 1 ? "" : "s"}`,
      );
    }
    if (wfJobs.length > 0) {
      immediate.push(`${wfJobs.length} job${wfJobs.length === 1 ? "" : "s"}`);
    }

    for (const job of wfJobs) {
      declared.push({
        kind: "job_action",
        workspace: job.creator_workspace,
        workspace_name: wsName(job.creator_workspace),
        label: job.title,
        detail: `workflow_start ${project.value.name}/${target.name}`,
      });
    }

    for (const wf of snapshot.workflows) {
      if (wf.project !== target.project || wf.name === target.name) continue;
      if (wf.flow_source === null) continue;
      const file = `workflows/${wf.name}/${WORKFLOW_FLOW_FILE}`;
      for (const call of extractFlowWorkflowCalls(wf.flow_source)) {
        if (call.workflow === target.name) {
          mentioned.push({
            kind: "flow_literal",
            workspace: { kind: "project", id: wf.project },
            workspace_name: wf.project_name,
            file,
            excerpt: call.excerpt,
          });
        }
      }
    }

    for (const doc of snapshot.skills) {
      if (
        doc.workspace !== null &&
        !(
          doc.workspace.kind === "project" &&
          doc.workspace.id === target.project
        )
      ) {
        continue;
      }
      const excerpt = wordMentionExcerpt(doc.content, [
        `${project.value.name}/${target.name}`,
        target.name,
      ]);
      if (excerpt !== null) {
        mentioned.push({
          kind: "skill_mention",
          workspace: doc.workspace,
          workspace_name: doc.workspace_name,
          file: doc.file,
          excerpt,
        });
      }
    }

    return ok({ target_label, immediate, impact: { declared, mentioned } });
  }

  // target.kind === "artifact"
  let ownerName: string;
  if (target.workspace.kind === "project") {
    const project = loadProject(deps.sql, target.workspace.id);
    if (!project.ok) return project;
    if (project.value === null) {
      return err({ code: "not_found", message: "project not found" });
    }
    ownerName = project.value.name;
  } else {
    const app = loadApp(deps.sql, target.workspace.id);
    if (!app.ok) return app;
    if (app.value === null) {
      return err({ code: "not_found", message: "app not found" });
    }
    ownerName = app.value.name;
  }
  const artifactDir = `${artifactsFolder(deps.dataRoot, target.workspace)}/${target.name}`;
  if (!(await isRegularDir(artifactDir))) {
    return err({ code: "not_found", message: "artifact not found" });
  }
  const target_label = `${ownerName}/${target.name}`;
  immediate.push(`Artifact folder artifacts/${target.name}`);

  const artifactPattern = new RegExp(
    `["'\`](?:[^"'\`]*\\/)?artifacts\\/${escapeRegExp(target.name)}(?:\\/[^"'\`]*)?["'\`]`,
  );
  if (target.workspace.kind === "project") {
    for (const wf of snapshot.workflows) {
      if (wf.project !== target.workspace.id || wf.flow_source === null) {
        continue;
      }
      const match = artifactPattern.exec(wf.flow_source);
      if (match !== null) {
        mentioned.push({
          kind: "flow_literal",
          workspace: target.workspace,
          workspace_name: ownerName,
          file: `workflows/${wf.name}/${WORKFLOW_FLOW_FILE}`,
          excerpt: excerptAt(wf.flow_source, match.index),
        });
      }
    }
  }

  for (const doc of snapshot.skills) {
    if (
      doc.workspace !== null &&
      !sameWorkspace(doc.workspace, target.workspace)
    ) {
      continue;
    }
    const excerpt = wordMentionExcerpt(doc.content, [
      `artifacts/${target.name}`,
      target.name,
    ]);
    if (excerpt !== null) {
      mentioned.push({
        kind: "skill_mention",
        workspace: doc.workspace,
        workspace_name: doc.workspace_name,
        file: doc.file,
        excerpt,
      });
    }
  }

  return ok({ target_label, immediate, impact: { declared, mentioned } });
}

// Wave 2 사후 인계용: release.activate로 바뀐/지워진 command·skill·event를 가리키는 하류 활성 workspace를 찾는다.
export async function scanReleaseContractUsers(
  sql: Query,
  dataRoot: string,
  appId: Id<"app">,
  contractChanges: readonly ContractChangeInput[],
): Promise<Result<ReleaseContractImpact>> {
  const loaded = loadApp(sql, appId);
  if (!loaded.ok) return loaded;
  if (loaded.value === null) {
    return err({ code: "not_found", message: "app not found" });
  }
  const app = loaded.value;
  if (contractChanges.length === 0) {
    return ok({
      app: app.id as Id<"app">,
      slug: app.slug,
      app_name: app.name,
      declared: [],
      mentioned: [],
      affected_workspaces: [],
    });
  }

  const snapshotResult = await readWorkspaceSnapshot({ sql, dataRoot });
  if (!snapshotResult.ok) return snapshotResult;
  const snapshot = snapshotResult.value;
  const wsName = workspaceNameResolver(snapshot);

  const changedCommands = new Map<string, ContractChange["change"]>();
  const changedSkills = new Map<string, ContractChange["change"]>();
  const changedEvents = new Map<string, ContractChange["change"]>();
  for (const change of contractChanges) {
    if (change.surface === "command") {
      changedCommands.set(change.name, change.change);
    } else if (change.surface === "skill") {
      changedSkills.set(change.name, change.change);
    } else {
      changedEvents.set(change.name, change.change);
    }
  }

  const declared: DeclaredRef[] = [];
  const mentioned: MentionedRef[] = [];
  const affected = new Map<string, AffectedWorkspace>();
  const noteWorkspace = (
    workspace: FollowUpWorkspace | null,
    workspace_name: string,
    reason: string,
  ) => {
    if (workspace?.kind === "app" && workspace.id === app.id) return;
    const key = workspaceKey(workspace);
    let entry = affected.get(key);
    if (entry === undefined) {
      entry = { workspace, workspace_name, reasons: [] };
      affected.set(key, entry);
    }
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
  };

  // 1. 다른 활성 앱의 app_connections(command) & non-remote subscriptions(event).
  for (const other of snapshot.apps) {
    if (other.id === app.id || other.declaration === null) continue;
    const ws: FollowUpWorkspace = { kind: "app", id: other.id };
    if (changedCommands.size > 0) {
      for (const conn of other.declaration.app_connections) {
        if (conn.app !== app.id && conn.app !== app.slug) continue;
        const hits = conn.commands.filter((cmd) => changedCommands.has(cmd));
        if (hits.length === 0) continue;
        const reason = `app_connection to ${app.slug}: ${hits.map((c) => `${c} (${changedCommands.get(c)})`).join(", ")}`;
        declared.push({
          kind: "app_connection",
          workspace: ws,
          workspace_name: other.name,
          label: `${other.slug} -> ${hits.join(", ")}`,
          detail: reason,
        });
        noteWorkspace(ws, other.name, reason);
      }
    }
    if (changedEvents.size > 0) {
      for (const sub of other.declaration.subscriptions ?? []) {
        if (sub.machine !== undefined) continue;
        if (sub.source !== app.slug && sub.source !== app.id) continue;
        const state = changedEvents.get(sub.event);
        if (state === undefined) continue;
        const reason = `subscription to ${app.slug}.${sub.event} (${state})`;
        declared.push({
          kind: "app_subscription",
          workspace: ws,
          workspace_name: other.name,
          label: `${other.slug} subscribes to ${app.slug}.${sub.event}`,
          detail: reason,
        });
        noteWorkspace(ws, other.name, reason);
      }
    }
  }

  // 2. 활성 jobs의 tool_run(command) & local event trigger(event).
  for (const job of snapshot.jobs) {
    if (
      job.creator_workspace?.kind === "app" &&
      job.creator_workspace.id === app.id
    ) {
      continue;
    }
    const name = wsName(job.creator_workspace);
    if (
      changedCommands.size > 0 &&
      job.action.kind === "tool_run" &&
      job.action.app === app.id
    ) {
      const state = changedCommands.get(job.action.tool);
      if (state !== undefined) {
        const reason = `job "${job.title}" runs ${app.slug}.${job.action.tool} (${state})`;
        declared.push({
          kind: "job_action",
          workspace: job.creator_workspace,
          workspace_name: name,
          label: job.title,
          detail: reason,
        });
        noteWorkspace(job.creator_workspace, name, reason);
      }
    }
    if (
      changedEvents.size > 0 &&
      job.trigger !== null &&
      job.trigger.source_machine === undefined &&
      job.trigger.app === app.id
    ) {
      const state = changedEvents.get(job.trigger.event);
      if (state !== undefined) {
        const reason = `job "${job.title}" triggers on ${app.slug}.${job.trigger.event} (${state})`;
        declared.push({
          kind: "job_trigger",
          workspace: job.creator_workspace,
          workspace_name: name,
          label: job.title,
          detail: reason,
        });
        noteWorkspace(job.creator_workspace, name, reason);
      }
    }
  }

  // 3. public skill 변경 시 이 앱의 skill을 배포받은 외부 agent.
  if (changedSkills.size > 0) {
    const summary = [...changedSkills.entries()]
      .map(([n, c]) => `${n} (${c})`)
      .join(", ");
    for (const agent of snapshot.agents) {
      if (agent.workspace?.kind === "app" && agent.workspace.id === app.id) {
        continue;
      }
      if (!agent.apps.includes(app.id)) continue;
      const name = wsName(agent.workspace);
      const reason = `agent @${agent.handle} has skills of ${app.slug} deployed (skills: ${summary})`;
      declared.push({
        kind: "agent_app_assignment",
        workspace: agent.workspace,
        workspace_name: name,
        label: `@${agent.handle}`,
        detail: reason,
      });
      noteWorkspace(agent.workspace, name, reason);
    }
  }

  // 4. 활성 project workflow의 flow.ts tool/onEvent 리터럴.
  for (const wf of snapshot.workflows) {
    if (wf.flow_source === null) continue;
    const ws: FollowUpWorkspace = { kind: "project", id: wf.project };
    const file = `workflows/${wf.name}/${WORKFLOW_FLOW_FILE}`;
    if (changedCommands.size > 0) {
      for (const call of extractFlowToolCalls(wf.flow_source)) {
        if (call.app !== app.slug && call.app !== app.id) continue;
        if (call.tool !== undefined && !changedCommands.has(call.tool)) {
          continue;
        }
        mentioned.push({
          kind: "flow_literal",
          workspace: ws,
          workspace_name: wf.project_name,
          file,
          excerpt: call.excerpt,
        });
        noteWorkspace(
          ws,
          wf.project_name,
          `workflow ${wf.name} calls ${app.slug}${call.tool ? `.${call.tool}` : ""}`,
        );
      }
    }
    if (changedEvents.size > 0) {
      for (const ev of extractFlowOnEventCalls(wf.flow_source)) {
        if (ev.source !== app.slug && ev.source !== app.id) continue;
        if (ev.event !== undefined && !changedEvents.has(ev.event)) continue;
        mentioned.push({
          kind: "flow_literal",
          workspace: ws,
          workspace_name: wf.project_name,
          file,
          excerpt: ev.excerpt,
        });
        noteWorkspace(
          ws,
          wf.project_name,
          `workflow ${wf.name} listens to ${app.slug}${ev.event ? `.${ev.event}` : ""}`,
        );
      }
    }
  }

  // 5. 활성 skill markdown 언급.
  const skillTerms = [
    ...[...changedCommands.keys()].flatMap((c) => [
      `${app.slug} ${c}`,
      `${app.slug}.${c}`,
    ]),
    ...[...changedSkills.keys()],
    ...[...changedEvents.keys()].flatMap((e) => [`${app.slug}.${e}`, e]),
  ];
  if (skillTerms.length > 0) {
    for (const doc of snapshot.skills) {
      if (doc.workspace?.kind === "app" && doc.workspace.id === app.id) {
        continue;
      }
      const excerpt = wordMentionExcerpt(doc.content, skillTerms);
      if (excerpt !== null) {
        mentioned.push({
          kind: "skill_mention",
          workspace: doc.workspace,
          workspace_name: doc.workspace_name,
          file: doc.file,
          excerpt,
        });
        noteWorkspace(
          doc.workspace,
          doc.workspace_name,
          `skill ${doc.file} mentions ${app.slug} contract`,
        );
      }
    }
  }

  const affected_workspaces = [...affected.values()].sort((a, b) =>
    workspaceKey(a.workspace).localeCompare(workspaceKey(b.workspace)),
  );

  return ok({
    app: app.id as Id<"app">,
    slug: app.slug,
    app_name: app.name,
    declared,
    mentioned,
    affected_workspaces,
  });
}

// P12 경계: impact.read는 user(UI)와 Home agent만 부른다.
function isImpactReaderAllowed(
  ledgerPath: string,
  actorHeader: string,
  conditions: Readonly<Record<string, unknown>>,
): Result<boolean> {
  const actor = parseActor(actorHeader);
  if (actor === undefined) return ok(false);
  if (actor.kind === "user") return ok(true);
  if (actor.kind !== "agent") return ok(false);
  if (conditions["project"] !== undefined || conditions["app"] !== undefined) {
    return ok(false);
  }
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return opened;
  try {
    const row = loadSession({ sql: opened.value.sql }, actor.id);
    if (row === undefined) return ok(false);
    return ok(workspaceOf(row) === null);
  } finally {
    opened.value.close();
  }
}

export const workspaceReaderWiring: WiringFactory = () => ({
  name: "workspace-reader",
  build(ctx) {
    const routeKey = `${impactRead.resource}/${impactRead.method}`;
    return ok({
      memory: [
        [
          routeKey,
          async (auth, raw) => {
            const allowed = isImpactReaderAllowed(
              ctx.ledgerPath,
              auth.actor,
              auth.conditions,
            );
            if (!allowed.ok) return allowed;
            if (!allowed.value) {
              return err({
                code: "forbidden",
                message: "only user or Home agent reads workspace impact",
              });
            }
            const parsed = impactTargetSchema.safeParse(raw);
            if (!parsed.success) {
              return err({
                code: "invalid_input",
                message: "invalid impact read target",
              });
            }
            const opened = openConnection(ctx.ledgerPath);
            if (!opened.ok) {
              return err({
                code: "unavailable",
                message: "ledger is unavailable",
              });
            }
            try {
              const callPolicy =
                ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY;
              return await scanImpact(
                {
                  sql: opened.value.sql,
                  dataRoot: ctx.root.path,
                  callPolicy,
                  secretNames: () => {
                    const names = ctx.secretStore.names();
                    return names.ok ? names.value : [];
                  },
                },
                parsed.data,
              );
            } finally {
              opened.value.close();
            }
          },
        ],
      ],
    });
  },
});
