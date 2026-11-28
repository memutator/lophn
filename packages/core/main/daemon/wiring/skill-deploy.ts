// skill 배포의 조립. 배포 기록은 네 자리에 있다: 전역 설정, workspace `extensions.json`, agent 정의의 `deployed_skills`, 터미널 coding agent(harness)의 설정 `coding-agent.deployed_skills`.
// 앞의 셋은 lophn agent의 session에 닿고 harness 자리는 harness의 skill 폴더로 복사된다(`lophn harness sync-skills`).
// 이 module이 층을 읽고 쓰고, 한 session에 닿는 배포를 합치고(Gate, 호출 판정, 앱 삭제가 같은 읽기를 쓴다), `lophn skill deploy|undeploy|deployments`의
// 규칙(누가 묻지 않고 하는가)을 건다. 표는 없다: skill 본문은 앱의 active release bundle이 봉한 사본이고 기록은 그것을 가리킨다.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { ToolGateResult } from "../../../../protocol/approvals/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import {
  type AgentId,
  type AgentWorkspace,
  CODING_DEPLOYED_SKILLS_SETTING_KEY,
  isLophn,
  LOPHN_HOME_ID,
  lophnIdOf,
  type SkillDeployment,
  type SkillDeploymentRow,
  skillsDeploy,
  skillsDeployments,
  skillsUndeploy,
  workspaceOfKey,
  workspaceOfLophn,
} from "../../../../protocol/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  Sql,
} from "../../../../protocol/server/mod.ts";
import { PROJECT_LAYER } from "../../../agent-workspaces/workspace/project-layer.ts";
import {
  appStatusOf,
  declaredPublicSkillsOf,
  publicSkillsOf,
} from "../../../apps/lookups.ts";
import { projectIds, projectStatusOf } from "../../../projects/lookups.ts";
import { loadApp, loadApps } from "../../../apps/registration/store.ts";
import type { AppAccess } from "../../../approvals/approvals.ts";
import type { AgentFileSystem } from "../../../lophn-agent/agents/ports.ts";
import {
  createAgentStore,
  writeAgentDeployedSkills,
} from "../../../lophn-agent/agents/store.ts";
import {
  appReached,
  globalDeployedSkillsSetting,
  receivedFromLayers,
  skillsOffSetting,
} from "../../../lophn-agent/extensions/mod.ts";
import {
  EMPTY_PROJECT_EXTENSIONS,
  parseProjectExtensions,
  type ProjectExtensions,
  serializeProjectExtensions,
} from "../../../lophn-agent/extensions/project-settings.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import { workspaceDepsOf } from "../../../lophn-agent/workspaces/mod.ts";
import { platformEntryUrl } from "../../../install-and-update/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import type { WiringContext } from "./context.ts";
import { agentDirectory } from "./lophn-agent-team.ts";
import { codingDeployedSkillsSetting } from "./setting-declarations.ts";

// 동기 file API는 core 프로세스의 module graph에 정적으로 두지 않는다. adapter는 URL로 연다.
const NODE_AGENT_FILES = platformEntryUrl(import.meta.url, "agentNodeFs").href;
const { createNodeAgentFiles } = (await import(NODE_AGENT_FILES)) as {
  createNodeAgentFiles(): AgentFileSystem;
};

type Query = Pick<Sql, "get" | "all">;

type Layer =
  | { layer: "global" }
  | { layer: "workspace"; workspace: AgentWorkspace | null }
  | { layer: "agent"; agent: AgentId }
  | { layer: "harness" };

export type DeployWho = { agent: AgentId; workspace: AgentWorkspace | null };

// 한 배포 기록과 그 자리다. `workspace`는 workspace 층이나 agent가 속한 workspace(undefined는 전역·harness)이고 null은 Home이다.
export type DeploymentEntry = {
  app: string;
  slug: string | null;
  skill: string;
  // 그 앱의 active release가 그 skill을 public으로 내놓는가. 앱이 보관돼도 그대로다(`archived`가 따로 말한다).
  provided: boolean;
  layer: SkillDeploymentRow["layer"];
  at: string | null;
  workspace: AgentWorkspace | null | undefined;
  active: boolean;
};

// 목록은 그 앱이 보관됐는지도 싣는다. 보관한 앱의 기록은 그대로 두고 아무도 받지 않으며 되살리면 다시 닿는다.
type HeldEntry = DeploymentEntry & { archived: boolean };

type Ctx = Pick<
  WiringContext,
  "ledgerPath" | "root" | "settings" | "settingsUpdate"
>;

function unavailable(what: string): Result<never> {
  return err({ code: "unavailable", message: what });
}

function sameDeployment(a: SkillDeployment, b: SkillDeployment): boolean {
  return a.app === b.app && a.skill === b.skill;
}

function layerName(layer: Layer): string {
  return layer.layer === "workspace"
    ? `workspace ${layer.workspace?.id ?? "home"}`
    : layer.layer === "agent"
      ? `agent ${layer.agent}`
      : layer.layer;
}

// 모든 workspace에 `lophn`이 있어서 handle만으로는 어느 것인지 모른다: `deployments`는 lophn 옆에 그 workspace를 적는다.
function agentLabel(
  info: { id: string; handle: string },
  deps: ReturnType<typeof workspaceDepsOf>,
  slugs: ReadonlyMap<string, string>,
): string {
  if (!isLophn(info.id)) return info.handle;
  return `${info.handle}@${placeName(workspaceOfLophn(info.id), deps, slugs)}`;
}

// workspace를 사람이 읽는 이름으로: `home`, project 이름, 앱 slug. 이름이 없으면 id다.
function placeName(
  workspace: AgentWorkspace | null,
  deps: ReturnType<typeof workspaceDepsOf>,
  slugs: ReadonlyMap<string, string>,
): string {
  if (workspace === null) return "home";
  return workspace.kind === "project"
    ? (deps.projects.project(workspace.id as never)?.name ?? workspace.id)
    : (slugs.get(workspace.id) ?? workspace.id);
}

// 층 하나의 읽기와 쓰기, 한 session에 닿는 배포 합치기, 앱 지움 때의 정리다. 상태가 없어 부르는 쪽이 ctx로 만든다.
export function createSkillDeployments(ctx: Ctx) {
  const root = ctx.root.path;
  const snapshot = <T>(read: (sql: Query) => T): Result<T> =>
    ledgerSnapshot(ctx.ledgerPath, (lookup) => read(lookup.sql));

  async function readWorkspace(
    workspace: AgentWorkspace | null,
  ): Promise<Result<ProjectExtensions>> {
    let text: string;
    try {
      text = await readFile(
        PROJECT_LAYER.extensionsFile(root, workspace),
        "utf8",
      );
    } catch (thrown) {
      if ((thrown as { code?: string }).code === "ENOENT") {
        return ok(EMPTY_PROJECT_EXTENSIONS);
      }
      return unavailable("the workspace settings file could not be read");
    }
    const parsed = parseProjectExtensions(text);
    return parsed.ok
      ? ok(parsed.value)
      : unavailable("the workspace settings file is invalid");
  }

  async function read(target: Layer): Promise<Result<SkillDeployment[]>> {
    if (target.layer === "global") {
      return ok([...(ctx.settings.get(globalDeployedSkillsSetting) ?? [])]);
    }
    if (target.layer === "harness") {
      return ok([...(ctx.settings.get(codingDeployedSkillsSetting) ?? [])]);
    }
    if (target.layer === "workspace") {
      const found = await readWorkspace(target.workspace);
      return found.ok ? ok(found.value.deployed_skills) : found;
    }
    const info = snapshot((sql) => agentDirectory(sql).agent(target.agent));
    if (!info.ok) return info;
    return info.value === null
      ? err({ code: "not_found", message: "agent not found" })
      : ok([...info.value.deployedSkills]);
  }

  async function write(
    target: Layer,
    next: SkillDeployment[],
  ): Promise<Result<void>> {
    if (target.layer === "global" || target.layer === "harness") {
      const written = ctx.settingsUpdate([
        {
          key:
            target.layer === "global"
              ? globalDeployedSkillsSetting.key
              : CODING_DEPLOYED_SKILLS_SETTING_KEY,
          action: "set",
          value: next,
        },
      ]);
      return !written.ok || written.value.rejected.length > 0
        ? unavailable(`the ${target.layer} deployments could not be saved`)
        : ok(undefined);
    }
    if (target.layer === "workspace") {
      const current = await readWorkspace(target.workspace);
      if (!current.ok) return current;
      const file = PROJECT_LAYER.extensionsFile(root, target.workspace);
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(
          `${file}.tmp`,
          serializeProjectExtensions({
            ...current.value,
            deployed_skills: next,
          }),
          "utf8",
        );
        await rename(`${file}.tmp`, file);
      } catch {
        return unavailable("the workspace settings file could not be written");
      }
      return ok(undefined);
    }
    const written = writeAgentDeployedSkills(
      createAgentStore(createNodeAgentFiles(), root),
      target.agent,
      next,
    );
    return written.ok ? ok(undefined) : written;
  }

  // 한 session이 받는 배포다. 세 층(전역, 그 workspace, 그 agent)을 `receivedFromLayers`로 모은다: turn 길(`deploymentsOf`)과 같은 한 규칙이고,
  // 한 층이라도 읽지 못하면 받는 배포가 없다(fails closed).
  async function reaching(who: DeployWho): Promise<SkillDeployment[]> {
    const workspace = await readWorkspace(who.workspace);
    const agent = snapshot((sql) => agentDirectory(sql).agent(who.agent));
    return receivedFromLayers({
      global: {
        deployed: ctx.settings.get(globalDeployedSkillsSetting) ?? [],
        off: ctx.settings.get(skillsOffSetting) ?? [],
      },
      workspace: workspace.ok
        ? {
            deployed: workspace.value.deployed_skills,
            off: workspace.value.skills_off,
          }
        : null,
      agent: agent.ok
        ? {
            deployed: [...(agent.value?.deployedSkills ?? [])],
            off: [...(agent.value?.skillsOff ?? [])],
          }
        : null,
    });
  }

  // 앱 호출이 그 session에 닿는가. 앱 자기 workspace의 session이거나, 받는 배포 가운데 그 앱의 지금 public skill이 하나라도 있으면 닿는다
  // (`appReached`. 같은 규칙을 command 목록과 명함이 쓴다). `mayDeploy`는 이 session의 agent가 묻지 않고 배포할 수 있는가다(거절 문장이 쓴다).
  async function appAccess(
    who: DeployWho,
    app: string,
  ): Promise<Result<AppAccess>> {
    const found = snapshot((sql) => {
      const loaded = loadApp(sql, app);
      return loaded.ok && loaded.value !== null
        ? {
            id: loaded.value.id,
            slug: loaded.value.slug,
            skills: publicSkillsOf(sql, loaded.value.id),
            agent: agentDirectory(sql).agent(who.agent)?.name,
          }
        : null;
    });
    if (!found.ok) return found;
    if (found.value === null) {
      return err({ code: "not_found", message: "app not found" });
    }
    const { id, slug, skills, agent } = found.value;
    const own = who.workspace?.kind === "app" && who.workspace.id === id;
    const reached = own || appReached(await reaching(who), id, skills);
    return ok({
      reached,
      slug,
      ...(agent === undefined ? {} : { agent }),
      skills,
      mayDeploy: mayDeployWithoutAsking(who, id),
    });
  }

  // 앱 `app`(id)의 public skill 전부를 그 자리에 더한다. 이미 있는 것은 그대로다. 더한 skill 이름을 돌려준다.
  async function deployAll(
    target: Layer,
    app: string,
  ): Promise<Result<string[]>> {
    const found = snapshot((sql) => {
      const loaded = loadApp(sql, app);
      return loaded.ok && loaded.value !== null
        ? { id: loaded.value.id, skills: publicSkillsOf(sql, loaded.value.id) }
        : null;
    });
    if (!found.ok) return found;
    if (found.value === null) {
      return err({ code: "not_found", message: "app not found" });
    }
    const current = await read(target);
    if (!current.ok) return current;
    const added = found.value.skills
      .map((skill) => ({ app: found.value!.id, skill }))
      .filter(
        (one) => !current.value.some((have) => sameDeployment(have, one)),
      );
    if (added.length === 0) return ok([]);
    const written = await write(target, [...current.value, ...added]);
    return written.ok ? ok(added.map((one) => one.skill)) : written;
  }

  // 모든 자리의 배포 기록이다(전역, harness, workspace, agent). 앱과 skill은 id와 이름을 같이 갖고, `provided`는 그 앱의 active release가 지금
  // 그 skill을 public으로 내놓는가다(앱을 보관해도 그대로고 `archived`가 따로 말한다). 내놓지 않는 기록(skill이 지워졌거나 비공개가 됐다)과 보관한 앱의 기록도 싣는다:
  // 읽는 쪽이 말없이 빼는 것을 여기서는 보인다. 앱을 읽는 쪽 모두가 이 한 목록을 쓴다.
  async function entries(): Promise<
    Result<{ found: HeldEntry[]; unreadable: number }>
  > {
    const places = snapshot((sql) => {
      const deps = workspaceDepsOf(sql);
      const apps = loadApps(sql, undefined);
      const slugs = new Map(
        (apps.ok ? apps.value : []).map((one) => [one.id, one.slug]),
      );
      // 연결이 닫히기 전에 다 읽는다.
      const provided = new Map<string, readonly string[]>(
        (apps.ok ? apps.value : []).map((one) => [
          one.id,
          declaredPublicSkillsOf(sql, one.id),
        ]),
      );
      const archivedIds = new Set(
        (apps.ok ? apps.value : [])
          .filter((one) => appStatusOf(sql, one.id) === "archived")
          .map((one) => one.id),
      );
      const activeIds = new Set([
        ...projectIds(sql).filter(
          (id) => projectStatusOf(sql, id) === "active",
        ),
        ...(apps.ok ? apps.value : [])
          .filter((one) => appStatusOf(sql, one.id) === "active")
          .map((one) => one.id),
      ]);
      const providedBy = (app: string): readonly string[] =>
        provided.get(app) ?? [];
      const active = (workspace: AgentWorkspace | null): boolean =>
        workspace === null || activeIds.has(workspace.id);
      return {
        slugs,
        providedBy,
        archivedIds,
        active,
        projects: projectIds(sql).map((id) => ({
          workspace: { kind: "project", id } as AgentWorkspace,
          name: deps.projects.project(id as never)?.name ?? id,
        })),
        apps: (apps.ok ? apps.value : []).map((one) => ({
          workspace: { kind: "app", id: one.id } as AgentWorkspace,
          name: one.slug,
        })),
        agents: agentDirectory(sql)
          .agents()
          .map((one) => ({
            at: agentLabel(one, deps, slugs),
            workspace: one.workspace,
            deployed: one.deployedSkills,
          })),
      };
    });
    if (!places.ok) return places;
    const found: HeldEntry[] = [];
    // 읽지 못한 자리의 수다. 건너뛰되 센다: 목록이 모자란다는 것을 보이는 쪽이 알린다.
    let unreadable = 0;
    const add = (
      layer: SkillDeploymentRow["layer"],
      at: string | null,
      workspace: AgentWorkspace | null | undefined,
      items: readonly SkillDeployment[],
    ) => {
      for (const item of items) {
        found.push({
          app: item.app,
          slug: places.value.slugs.get(item.app) ?? null,
          skill: item.skill,
          provided: places.value.providedBy(item.app).includes(item.skill),
          archived: places.value.archivedIds.has(item.app),
          layer,
          at,
          workspace,
          active: places.value.active(workspace ?? null),
        });
      }
    };
    const global = await read({ layer: "global" });
    if (global.ok) add("global", null, undefined, global.value);
    else unreadable += 1;
    const harness = await read({ layer: "harness" });
    if (harness.ok) add("harness", null, undefined, harness.value);
    else unreadable += 1;
    const home = await read({ layer: "workspace", workspace: null });
    if (home.ok) add("workspace", "home", null, home.value);
    else unreadable += 1;
    for (const place of [...places.value.projects, ...places.value.apps]) {
      const one = await read({
        layer: "workspace",
        workspace: place.workspace,
      });
      if (one.ok) add("workspace", place.name, place.workspace, one.value);
      else unreadable += 1;
    }
    for (const agent of places.value.agents) {
      add("agent", agent.at, agent.workspace, agent.deployed);
    }
    return ok({ found, unreadable });
  }

  // `lophn skill deployments`와 화면의 목록이다. 앱 slug를 주면 그 앱의 것만이다. 앱은 slug로 보이고(앱이 이미 없으면 기록의 id).
  // `scope`가 있으면 그 agent에게 닿는 자리의 줄만 낸다(전역, harness, 자기 workspace, 자기 workspace의 agent). 자기 앱을 물으면 다른 자리는
  // 이름 없이 수만 `others`로 센다(P12: 앱 session은 다른 그릇이 무엇을 받는지 읽지 못한다). `unreadable`은 읽지 못한 자리 수다.
  async function list(
    slug?: string,
    scope?: { workspace: AgentWorkspace | null },
  ): Promise<
    Result<{
      rows: SkillDeploymentRow[];
      others: number;
      unreadable: number;
    }>
  > {
    const all = await entries();
    if (!all.ok) return all;
    const matching = all.value.found.filter(
      (one) => slug === undefined || (one.slug ?? one.app) === slug,
    );
    const visible = (one: HeldEntry): boolean =>
      scope === undefined ||
      one.layer === "global" ||
      one.layer === "harness" ||
      sameWorkspace(one.workspace ?? null, scope.workspace);
    const shown = matching.filter(visible);
    const asksOwnApp =
      scope?.workspace?.kind === "app" &&
      slug !== undefined &&
      matching.some((one) => one.app === scope.workspace?.id);
    const others = !asksOwnApp
      ? 0
      : new Set(
          matching
            .filter((one) => !visible(one))
            .map((one) => `${one.layer}\0${one.at ?? ""}`),
        ).size;
    return ok({
      rows: shown.map((one) => ({
        app: one.slug ?? one.app,
        skill: one.skill,
        layer: one.layer,
        at: one.at,
        provided: one.provided && !one.archived,
        archived: one.archived,
      })),
      others,
      unreadable: all.value.unreadable,
    });
  }

  // 그 앱(id)의 skill을 받는 바깥 자리다: 앱이 지금 내놓는 skill의 배포만(`provided`), 앱 자기 workspace와 그 workspace의 agent,
  // 보관된 workspace는 뺀다. 보관한 앱은 지금 아무도 받지 않지만 되살리면 받을 자리이므로 싣는다(지우기 창이 지울 기록을 보인다).
  // 의존 알림(release 준비, 동의 카드, 앱 삭제 창, 계약 변경 인계)이 모두 이 목록을 읽는다.
  // `skills`를 주면 그 이름의 배포만이다.
  async function receivers(
    app: string,
    skills?: readonly string[],
  ): Promise<Result<{ found: DeploymentEntry[]; unreadable: number }>> {
    const all = await entries();
    // 전체를 읽지 못하면 목록이 비는 것이 아니라 읽지 못한 것이다: 호출한 쪽이 "받는 곳 0"으로 보이지 않게 센다.
    if (!all.ok) return ok({ found: [], unreadable: 1 });
    return ok({
      found: all.value.found.filter(
        (one) =>
          one.app === app &&
          one.provided &&
          one.active &&
          !(one.workspace?.kind === "app" && one.workspace.id === app) &&
          (skills === undefined || skills.includes(one.skill)),
      ),
      unreadable: all.value.unreadable,
    });
  }

  // 앱을 지울 때 그 앱(id)의 배포를 모든 자리에서 거둔다(보관은 기록을 그대로 둔다). 읽지 못하거나 쓰지 못한 자리는 로그에 그 자리를 남기고 건너뛴다:
  // 기록은 id로 앱을 가리키므로 남은 기록은 아무 앱에도 닿지 않는 찌꺼기다(id는 다시 쓰이지 않는다).
  async function strip(
    app: string,
    log: (message: string) => void,
  ): Promise<void> {
    const places = snapshot((sql) => {
      const apps = loadApps(sql, undefined);
      return {
        workspaces: [
          ...projectIds(sql).map(
            (id) => ({ kind: "project", id }) as AgentWorkspace,
          ),
          ...(apps.ok ? apps.value : []).map(
            (one) => ({ kind: "app", id: one.id }) as AgentWorkspace,
          ),
        ],
        agents: agentDirectory(sql)
          .agents()
          .map((one) => one.id),
      };
    });
    if (!places.ok) log(`deployments of ${app} left: places not read`);
    const targets: Layer[] = [
      { layer: "global" },
      { layer: "harness" },
      { layer: "workspace", workspace: null },
      ...(places.ok
        ? [
            ...places.value.workspaces.map(
              (workspace): Layer => ({ layer: "workspace", workspace }),
            ),
            ...places.value.agents.map(
              (agent): Layer => ({ layer: "agent", agent }),
            ),
          ]
        : []),
    ];
    for (const target of targets) {
      const name = layerName(target);
      const current = await read(target);
      if (!current.ok) {
        log(`deployments of ${app} left in ${name}: ${current.error.message}`);
        continue;
      }
      if (current.value.every((one) => one.app !== app)) continue;
      const written = await write(
        target,
        current.value.filter((one) => one.app !== app),
      );
      if (!written.ok) {
        log(`deployments of ${app} left in ${name}: ${written.error.message}`);
      }
    }
  }

  return {
    read,
    write,
    reaching,
    appAccess,
    deployAll,
    list,
    receivers,
    strip,
  };
}

export type SkillDeployments = ReturnType<typeof createSkillDeployments>;

// 닿지 않은 앱의 호출이 막혔을 때 그 호출자가 읽는 말이다. 호출자가 실제로 할 수 있는 일만 쓴다: public skill이 없으면 배포할 것이 없고(앱 자기
// workspace의 agent가 써야 한다), agent는 묻지 않고 배포할 자격이 있을 때만 배포하라고 하고, flow는 사람이 없어 배포도 허락 받기도 못한다.
export function undeployedMessage(
  access: {
    reached: boolean;
    slug: string;
    skills: readonly string[];
    mayDeploy: boolean;
  },
  kind: "agent" | "flow",
  command: { tool: string; public: boolean },
): string {
  // 앱에는 닿았는데 command가 public이 아니면 배포 탓이 아니다: 비공개 command는 그 앱 workspace의 agent만 부른다.
  if (access.reached && !command.public) {
    return `the call is not granted: command ${command.tool} of app ${access.slug} is not public; only an agent in the app's own workspace calls a private command`;
  }
  const head = `the call is not granted: no skill of app ${access.slug} is deployed to this ${kind === "flow" ? "flow's workspace" : "agent"} (and received), and the person did not allow this call`;
  if (access.skills.length === 0) {
    return `${head}. The app has no public skill, so there is nothing to deploy; the agent in the app's own workspace has to write one`;
  }
  if (kind === "flow") {
    return `${head}. A flow has no person to ask: the person has to deploy a skill of this app to the flow's workspace (\`lophn skill deploy ${access.slug} <skill> --to workspace:<name>\`)`;
  }
  return access.mayDeploy
    ? `${head}. Deploy one of the app's public skills (\`lophn skill deploy ${access.slug} <skill> --to workspace\`, \`--to agent:<handle>\` or \`--to global\`)`
    : `${head}. This agent cannot deploy it: ask the person to deploy a skill of this app, or to allow the call in a session they are in`;
}

const DENIED_HINT =
  "only the person, an agent in the app's own workspace and the Home lophn deploy without asking (and nobody but the person deploys to harness without a card). Calling the app's command (`lophn <app> <command>`) asks the person to allow it, and allowing it always deploys the app's skills to that workspace.";

// workspace를 가리키는 말: `home`, project 이름이나 id, 앱 slug·이름이나 id. Home은 null이다.
function resolveWorkspace(
  sql: Query,
  ref: string,
): Result<AgentWorkspace | null> {
  if (ref === "home") return ok(null);
  const deps = workspaceDepsOf(sql);
  if (/^(prj|app)_/.test(ref)) {
    const keyed = workspaceOfKey(ref as never) as AgentWorkspace;
    const found =
      keyed.kind === "project"
        ? deps.projects.project(keyed.id as never)
        : deps.apps.app(keyed.id as never);
    if (found !== null) return ok(keyed);
  }
  const project = deps.projects.projectByName(ref);
  const slugged = loadApps(sql, undefined);
  const bySlug = slugged.ok
    ? slugged.value.find((one) => one.slug === ref)
    : undefined;
  const byName = bySlug === undefined ? deps.apps.appByName(ref) : undefined;
  const app =
    bySlug !== undefined
      ? bySlug.id
      : byName?.ok === true
        ? byName.value.id
        : undefined;
  // 프로젝트 이름과 앱 slug·이름이 같으면 어느 쪽인지 모른다: 후보를 id로 알린다.
  if (project !== null && app !== undefined) {
    return err({
      code: "invalid_input",
      message: `${ref} names both a project and an app; say which with workspace:${project.id} or workspace:${app}`,
    });
  }
  if (project !== null) return ok({ kind: "project", id: project.id });
  if (app !== undefined) return ok({ kind: "app", id: app });
  return err({ code: "not_found", message: `workspace ${ref} not found` });
}

const sameWorkspace = (
  a: AgentWorkspace | null,
  b: AgentWorkspace | null,
): boolean =>
  a === null ? b === null : b !== null && a.kind === b.kind && a.id === b.id;

// 모든 workspace에 `lophn`이 있다. `agents/card`와 같은 규칙으로 가린다: workspace가 있으면 그 workspace의 lophn, agent session이 주지 않으면
// 자기 workspace의 lophn, 사람이 주지 않으면 어느 것인지 모르므로 후보를 알리며 거절한다.
function lophnCandidates(sql: Query): string[] {
  const deps = workspaceDepsOf(sql);
  const apps = loadApps(sql, undefined);
  return [
    "agent:lophn@home",
    ...projectIds(sql).map(
      (id) => `agent:lophn@${deps.projects.project(id as never)?.name ?? id}`,
    ),
    ...(apps.ok ? apps.value : []).map((one) => `agent:lophn@${one.slug}`),
  ];
}

// `to`는 `global`, `harness`, `workspace`, `workspace:<ref>`, `agent:<handle>[@<workspace>]`이다. workspace의 ref는 `home`, project 이름이나 id, 앱 slug·이름이나 id다.
function parseTarget(
  sql: Query,
  to: string,
  here: AgentWorkspace | null | undefined,
): Result<Layer> {
  if (to === "global") return ok({ layer: "global" });
  if (to === "harness") return ok({ layer: "harness" });
  if (to === "workspace") {
    return here === undefined
      ? err({
          code: "invalid_input",
          message: "name the workspace: --to workspace:<project, app or home>",
        })
      : ok({ layer: "workspace", workspace: here });
  }
  if (to.startsWith("workspace:")) {
    const where = resolveWorkspace(sql, to.slice("workspace:".length));
    return where.ok
      ? ok({ layer: "workspace", workspace: where.value })
      : where;
  }
  if (to.startsWith("agent:")) {
    const rest = to.slice("agent:".length).trim();
    const at = rest.indexOf("@");
    const handle = (at === -1 ? rest : rest.slice(0, at)).trim().toLowerCase();
    const ref = at === -1 ? null : rest.slice(at + 1).trim();
    let narrowed: AgentWorkspace | null | undefined;
    if (ref !== null) {
      const where = resolveWorkspace(sql, ref);
      if (!where.ok) return where;
      narrowed = where.value;
    }
    if (handle === "lophn") {
      const where = narrowed !== undefined ? narrowed : here;
      if (where === undefined) {
        return err({
          code: "invalid_input",
          message: `every workspace has a lophn; say which: ${lophnCandidates(sql).join(", ")}`,
        });
      }
      return ok({ layer: "agent", agent: lophnIdOf(where) });
    }
    const found = agentDirectory(sql)
      .agents()
      .filter((one) => one.handle.trim().toLowerCase() === handle)
      .find(
        (one) =>
          narrowed === undefined ||
          one.workspace === null ||
          sameWorkspace(one.workspace, narrowed),
      );
    return found === undefined
      ? err({ code: "not_found", message: `agent ${handle} not found` })
      : ok({ layer: "agent", agent: found.id });
  }
  return err({
    code: "invalid_input",
    message:
      "--to is global, harness, workspace, workspace:<name> or agent:<handle>[@<workspace>]",
  });
}

function describe(layer: Layer, sql: Query): string {
  if (layer.layer === "global") return "every agent";
  if (layer.layer === "harness") return "the coding agents in terminals";
  if (layer.layer === "agent") {
    const info = agentDirectory(sql).agent(layer.agent);
    const apps = loadApps(sql, undefined);
    const slugs = new Map(
      (apps.ok ? apps.value : []).map((one) => [one.id, one.slug]),
    );
    return `agent ${info === null ? layer.agent : agentLabel(info, workspaceDepsOf(sql), slugs)}`;
  }
  if (layer.workspace === null) return "the Home workspace";
  const deps = workspaceDepsOf(sql);
  const name =
    layer.workspace.kind === "project"
      ? deps.projects.project(layer.workspace.id as never)?.name
      : deps.apps.app(layer.workspace.id as never)?.name;
  return `${layer.workspace.kind} ${name ?? layer.workspace.id}`;
}

// 묻지 않고 배포하는 자격이다: 그 앱 자기 workspace의 agent(그 앱의 skill을 어느 층에든)와 Home의 lophn(어느 앱이든 어느 층에든).
// 그 밖의 agent는 사람에게 묻는다. 사람 자신은 여기를 거치지 않는다. 예외 하나: `harness`는 agent가 쓴 글을 사람의 coding agent의 전역 skill
// 폴더에 쓰고 그 agent들은 shell이 있고 Gate가 없으므로, 누구든 agent는 늘 사람에게 묻는다(사람이 없는 실행은 거절).
export function mayDeployWithoutAsking(
  who: DeployWho,
  app: string,
  layer?: Layer["layer"],
): boolean {
  if (layer === "harness") return false;
  return (
    (who.workspace?.kind === "app" && who.workspace.id === app) ||
    (who.workspace === null && who.agent === LOPHN_HOME_ID)
  );
}

export type SkillDeployHandlerDeps = {
  deployments: SkillDeployments;
  // agent가 부른 session의 agent와 workspace다. 사람 자격에는 없다.
  sessionOf(session: string): Result<DeployWho | null>;
  // 사람에게 묻는다. 조립이 `tool_gate/check`를 꽂는다.
  askPerson(
    who: AuthenticatedContext,
    input: {
      session: string;
      turn: string;
      tool_call: string;
      tool: string;
      call: { kind: "setting"; key: string; lines: string[] };
    },
  ): Promise<Result<ToolGateResult>>;
  ledgerPath: string;
};

// 앱 skill 배포의 명령 셋이다(`lophn skill deploy|undeploy|deployments`). 사람은 모두 한다. agent는 자기 앱 workspace의 앱 skill과 Home lophn이면
// 묻지 않고 하고, 그 밖의 agent는 사람에게 묻는다(사람이 없는 실행은 거절).
export function createSkillDeployHandlers(
  deps: SkillDeployHandlerDeps,
): readonly [string, MemoryHandler][] {
  const key = (route: { resource: string; method: string }) =>
    `${route.resource}/${route.method}`;

  async function change(
    who: AuthenticatedContext,
    raw: unknown,
    mode: "deploy" | "undeploy",
  ): Promise<Result<{ changed: boolean }>> {
    const route = mode === "deploy" ? skillsDeploy : skillsUndeploy;
    const parsed = route.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid input" });
    }
    const input = parsed.data;
    const actor = parseActor(who.actor);
    const caller =
      actor?.kind === "agent" ? deps.sessionOf(actor.id) : ok(null);
    if (!caller.ok) return caller;
    if (actor?.kind === "agent" && caller.value === null) {
      return err({ code: "forbidden", message: "unknown agent session" });
    }
    const resolved = ledgerSnapshot<
      Result<{ target: Layer; app: string; place: string }>
    >(deps.ledgerPath, (lookup) => {
      const sql = lookup.sql;
      const target = parseTarget(sql, input.to, caller.value?.workspace);
      if (!target.ok) return target;
      const apps = loadApps(sql, undefined);
      const app = apps.ok
        ? apps.value.find((one) => one.slug === input.app)
        : undefined;
      if (app === undefined) {
        return err({
          code: "not_found",
          message: `app ${input.app} not found`,
        });
      }
      // 보관한 앱의 기록은 그대로 두므로 거둘 수는 있다. 새로 배포하는 것은 앱을 되살린 뒤다.
      if (mode === "deploy" && appStatusOf(sql, app.id) === "archived") {
        return err({
          code: "invalid_input",
          message: `app ${input.app} is archived; unarchive it before deploying its skills`,
        });
      }
      const skills = publicSkillsOf(sql, app.id);
      // 배포는 public skill만 받는다. 지울 때는 사라졌거나 비공개가 된 기록도 거둘 수 있어야 한다.
      if (mode === "deploy" && !skills.includes(input.skill)) {
        return err({
          code: "invalid_input",
          message: `${input.skill} is not a public skill of the active release of app ${input.app}${skills.length === 0 ? " (it has no public skill)" : `; its public skills are ${skills.join(", ")}`}`,
        });
      }
      return ok({
        target: target.value,
        app: app.id,
        place: describe(target.value, sql),
      });
    });
    if (!resolved.ok) return resolved;
    if (!resolved.value.ok) return resolved.value;
    const { target, app, place } = resolved.value.value;

    if (caller.value !== null) {
      if (!mayDeployWithoutAsking(caller.value, app, target.layer)) {
        const session = actor?.kind === "agent" ? actor.id : undefined;
        const conditions = who.conditions;
        const toolCall = (raw as { tool_call?: string }).tool_call;
        if (
          session === undefined ||
          conditions.session !== session ||
          conditions.turn === undefined ||
          toolCall === undefined
        ) {
          return err({ code: "forbidden", message: DENIED_HINT });
        }
        const asked = await deps.askPerson(who, {
          session,
          turn: conditions.turn,
          tool_call: toolCall,
          tool: "lophn",
          call: {
            kind: "setting",
            key: `skill ${mode} (${input.app}/${input.skill})`,
            lines: [
              `${mode === "deploy" ? "Deploy" : "Remove"} the ${input.app} skill ${input.skill} ${mode === "deploy" ? "to" : "from"} ${place}`,
            ],
          },
        });
        if (!asked.ok) return asked;
        if (asked.value.kind === "rejected") {
          return err({
            code: "forbidden",
            message: `the person rejected this ${mode}${asked.value.reason === null ? "" : `: ${asked.value.reason}`}`,
          });
        }
        if (asked.value.kind !== "run") {
          return err({
            code: "forbidden",
            message: `the person has to allow this and cannot be asked now; ${DENIED_HINT}`,
          });
        }
      }
    }

    const current = await deps.deployments.read(target);
    if (!current.ok) return current;
    const wanted = { app, skill: input.skill };
    const has = current.value.some((one) => sameDeployment(one, wanted));
    if (mode === "deploy" ? has : !has) return ok({ changed: false });
    const written = await deps.deployments.write(
      target,
      mode === "deploy"
        ? [...current.value, wanted]
        : current.value.filter((one) => !sameDeployment(one, wanted)),
    );
    return written.ok ? ok({ changed: true }) : written;
  }

  return [
    [
      key(skillsDeploy),
      async (who, raw) => {
        const done = await change(who, raw, "deploy");
        return done.ok ? ok({ deployed: done.value.changed }) : done;
      },
    ],
    [
      key(skillsUndeploy),
      async (who, raw) => {
        const done = await change(who, raw, "undeploy");
        return done.ok ? ok({ removed: done.value.changed }) : done;
      },
    ],
    [
      key(skillsDeployments),
      async (who, raw) => {
        const parsed = skillsDeployments.input.safeParse(raw);
        if (!parsed.success) {
          return err({ code: "invalid_input", message: "invalid input" });
        }
        // 누가 묻느냐에 따라 보이는 범위가 다르다: 사람과 Home의 lophn(session 행으로 확인)은 모두, 다른 agent는 자기에게 닿는 자리만이다.
        const actor = parseActor(who.actor);
        let scope: { workspace: AgentWorkspace | null } | undefined;
        if (actor?.kind === "agent") {
          const caller = deps.sessionOf(actor.id);
          if (!caller.ok) return caller;
          if (caller.value === null) {
            return err({ code: "forbidden", message: "unknown agent session" });
          }
          const home =
            caller.value.workspace === null &&
            caller.value.agent === LOPHN_HOME_ID;
          if (!home) scope = { workspace: caller.value.workspace };
        }
        const found = await deps.deployments.list(parsed.data.app, scope);
        return found.ok
          ? ok({
              deployments: found.value.rows,
              others: found.value.others,
              unreadable: found.value.unreadable,
            })
          : found;
      },
    ],
  ];
}
