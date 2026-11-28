import type { z } from "zod";
import { ok, type Result } from "../../../base/mod.ts";
import { appTools } from "../../../protocol/apps/declaration/read.ts";
import { appList } from "../../../protocol/apps/mod.ts";
import type {
  Assignment,
  AssignmentEntry,
} from "../../../protocol/approvals/mod.ts";
import type {
  AgentAtWorkspace,
  AgentId,
} from "../../../protocol/lophn-agent/workspaces.ts";
import type { SkillDeployment } from "../../../protocol/lophn-agent/mod.ts";
import type { MachineCandidate } from "../../../protocol/machine/requester.ts";
import { machinesAppTools } from "../../../protocol/remote/mod.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";
import type { AppToolView } from "./app-tool/command.ts";

// agent runtime의 앱 command 연결. `lophn <slug> <command>`를 부를 때 그 session에 닿는 배포 기록(전역, workspace, agent 층)이 가리킨 앱과
// 그 앱 workspace의 자기 앱, 부른 slug의 앱을 읽고 그 앱의 활성 release 선언을 읽는다. 배포되지 않은 앱도 부른 slug로는 풀려야 Gate에 닿아 묻는다.
// 다른 기계의 앱(할당 줄에 machine이 있는 것)은 core의 `machines/app_tools`가 그 기계에 물어 한 번에 읽는다.
// 판정은 만들지 않는다: Gate는 호출이 지나는 core의 호출 경로가 건다.

type AppToolLoad = {
  // 이 기계의 앱과 읽은 다른 기계의 앱(`machine`이 있다). 닿지 않거나 거절한 다른 기계의 앱은 없다.
  views: readonly AppToolView[];
  entries: readonly AssignmentEntry[];
  // 명단의 컴퓨터(이 컴퓨터 포함). `--on`이 이것에서 기계를 고른다.
  machines: readonly MachineCandidate[];
};

// 한 turn 동안 다른 컴퓨터의 목록을 한 번만 읽도록 turn이 들고 있는 자리다. 닿지 않아 비어 온 답도 그 turn 동안 그대로다.
export type RemoteMemo = {
  read?: Promise<Result<MachinesAppTools>>;
};
type MachinesAppTools = z.output<typeof machinesAppTools.output>;

export type AppToolkit = {
  // 지금의 선언과 배포, 다른 컴퓨터 앱 할당. memo가 있으면 다른 컴퓨터의 목록은 그 turn에 한 번만 읽는다. `slug`는 지금 부르는 앱이다:
  // 배포되지 않았어도 그 앱의 command를 읽어 호출이 Gate까지 간다.
  load(
    who: AgentAtWorkspace,
    memo?: RemoteMemo,
    slug?: string,
  ): Promise<Result<AppToolLoad>>;
};

// 다른 컴퓨터가 이만큼 답하지 않으면 그 컴퓨터의 앱은 "not reachable now"다.
const REMOTE_READ_MS = 8000;

export function createAppToolkit(options: {
  // machine 자격의 loopback. 앱의 활성 release 선언을 읽는다.
  machine: CoreCall;
  // 다른 컴퓨터 앱 할당(`remote_apps`)이다.
  assignment(agent: AgentId): Promise<Result<Pick<Assignment, "entries">>>;
  // 그 session에 닿는 배포 기록이다(전역, workspace, agent 층). 읽지 못한 층은 없는 것이다.
  deployments(who: AgentAtWorkspace): Promise<readonly SkillDeployment[]>;
  remoteReadMs?: number;
}): AppToolkit {
  const MAX_APP_PAGES = 20;

  // 활성 앱 전부의 id와 slug다. 읽지 못하면 이 컴퓨터의 앱이 없는 것이다.
  async function activeApps(): Promise<{ id: string; slug: string }[]> {
    const found: { id: string; slug: string }[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_APP_PAGES; page += 1) {
      const listed = await readOf(options.machine, appList, {
        status: "active",
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!listed.ok) return found;
      for (const app of listed.value.apps) {
        found.push({ id: app.id, slug: app.slug });
      }
      if (listed.value.next_cursor === null) break;
      cursor = listed.value.next_cursor;
    }
    return found;
  }

  async function load(
    who: AgentAtWorkspace,
    memo?: RemoteMemo,
    slug?: string,
  ): Promise<Result<AppToolLoad>> {
    const assignment = await options.assignment(who.agent);
    if (!assignment.ok) return assignment;
    const entries: AssignmentEntry[] = assignment.value.entries;
    const views: AppToolView[] = [];
    const deployed = new Set(
      (await options.deployments(who)).map((entry) => entry.app),
    );
    const own = who.workspace?.kind === "app" ? who.workspace.id : null;
    for (const app of await activeApps()) {
      if (!deployed.has(app.slug) && app.id !== own && app.slug !== slug) {
        continue;
      }
      const read = await readOf(options.machine, appTools, { app: app.id });
      // active release가 없거나 읽지 못한 앱은 선언이 없는 앱과 같다.
      if (!read.ok) continue;
      views.push({
        app: read.value.app,
        slug: read.value.slug,
        name: read.value.name,
        release: read.value.release,
        tools: read.value.tools,
      });
    }
    // 다른 기계의 앱이 없으면 core에 묻지 않는다.
    if (entries.length === 0) {
      return ok({ views, entries, machines: [] });
    }
    const start = () => {
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<Result<never>>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              ok: false,
              error: { code: "unavailable", message: "no answer in time" },
            }),
          options.remoteReadMs ?? REMOTE_READ_MS,
        );
      });
      return Promise.race([
        readOf(options.machine, machinesAppTools, {
          agent: who.agent,
          workspace: who.workspace,
        }),
        late,
      ]).finally(() => clearTimeout(timer));
    };
    const remote = await (memo === undefined
      ? start()
      : (memo.read ??= start()));
    // 읽지 못하면 다른 기계의 앱이 없는 것과 같다(이 기계의 앱은 그대로 쓴다).
    if (!remote.ok) return ok({ views, entries, machines: [] });
    for (const row of remote.value.apps) {
      if (row.view === null) continue;
      views.push({
        app: row.app,
        machine: row.machine,
        slug: row.view.slug,
        name: row.name,
        release: row.view.release,
        tools: row.view.tools,
      });
    }
    return ok({ views, entries, machines: remote.value.machines });
  }

  return { load };
}
