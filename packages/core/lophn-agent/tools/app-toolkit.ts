import type { z } from "zod";
import { ok, type Result } from "../../../base/mod.ts";
import { appTools } from "../../../protocol/apps/declaration/read.ts";
import type {
  Assignment,
  AssignmentEntry,
} from "../../../protocol/approvals/mod.ts";
import type {
  AgentAtWorkspace,
  AgentId,
} from "../../../protocol/lophn-agent/workspaces.ts";
import type { MachineCandidate } from "../../../protocol/machine/requester.ts";
import { machinesAppTools } from "../../../protocol/remote/mod.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";
import type { AppToolView } from "./app-tool/command.ts";

// agent runtime의 앱 command 연결. `lophn <slug> <command>`를 부를 때 agent 할당에서 앱을 읽고, 그 앱의 활성 release
// 선언을 읽는다. 다른 기계의 앱(할당 줄에 machine이 있는 것)은 core의 `machines/app_tools`가 그 기계에 물어 한 번에 읽는다.
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
  // 지금의 선언과 할당. memo가 있으면 다른 컴퓨터의 목록은 그 turn에 한 번만 읽는다.
  load(who: AgentAtWorkspace, memo?: RemoteMemo): Promise<Result<AppToolLoad>>;
};

// 다른 컴퓨터가 이만큼 답하지 않으면 그 컴퓨터의 앱은 "not reachable now"다.
const REMOTE_READ_MS = 8000;

export function createAppToolkit(options: {
  // machine 자격의 loopback. 앱의 활성 release 선언을 읽는다.
  machine: CoreCall;
  assignment(agent: AgentId): Promise<Result<Pick<Assignment, "entries">>>;
  remoteReadMs?: number;
}): AppToolkit {
  async function load(
    who: AgentAtWorkspace,
    memo?: RemoteMemo,
  ): Promise<Result<AppToolLoad>> {
    const assignment = await options.assignment(who.agent);
    if (!assignment.ok) return assignment;
    const entries: AssignmentEntry[] = assignment.value.entries;
    const views: AppToolView[] = [];
    for (const entry of entries) {
      if (entry.machine !== undefined) continue;
      const read = await readOf(options.machine, appTools, {
        app: entry.app,
      });
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
    if (!entries.some((entry) => entry.machine !== undefined)) {
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
