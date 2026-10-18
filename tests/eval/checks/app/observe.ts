// observation 확인: 정해 둔 실패를 일으켜 새 problem이 열리나. 배열 순서가 실행 순서다(store 실패는 되돌리지 않아 마지막).
// 한 실패가 새 problem 하나를 열어야 한다: 앞선 실패가 연 problem이 before에 들어 있어, 다른 원인이 같은 이름으로
// 보고되면 묶여서 새 id가 안 생긴다. 그래서 "원인이 다르면 이름도 다른가"를 한 번에 본다.
import { DatabaseSync } from "node:sqlite";
import {
  appDisableExecution,
  appEnableExecution,
  appGet,
  appRuntime,
} from "../../../../packages/protocol/apps/mod.ts";
import { settingsUpdate } from "../../../../packages/protocol/config/mod.ts";
import {
  problemGet,
  type ProblemListItem,
} from "../../../../packages/protocol/problems/mod.ts";
import type { Core } from "../../../support/core/mod.ts";
import { until } from "../../../support/core/human.ts";
import type { CheckOutcome, ProgramCheck } from "../../types.ts";
import { callApi, findApp, liveCheck, waitProblems } from "./live.ts";
import { appProblems, appTickets } from "./tickets.ts";

export type Probe = { api: string; input?: unknown };
export type ObserveSpec = {
  app: string;
  notify: string;
  badInput: Probe;
  notifyDown: Probe;
  store: Probe;
};

type Seen = Pick<ProblemListItem, "id" | "name" | "occurrence_count">;

function changed(before: Seen[], after: Seen[]): boolean {
  const count = new Map(before.map((p) => [p.id, p.occurrence_count]));
  return after.some((p) =>
    !count.has(p.id) || p.occurrence_count > count.get(p.id)!
  );
}

export function decideFailure(
  before: Seen[],
  after: Seen[],
  status: string,
): CheckOutcome {
  const known = new Set(before.map((p) => p.id));
  const opened = after.filter((p) => !known.has(p.id));
  if (opened.length > 0) {
    return {
      pass: true,
      reason: `새 problem ${opened.map((p) => `"${p.name}"`).join(", ")}`,
    };
  }
  if (changed(before, after)) {
    const count = new Map(before.map((p) => [p.id, p.occurrence_count]));
    const grown = after.filter((p) => p.occurrence_count > count.get(p.id)!);
    return {
      pass: false,
      reason: `이미 있는 problem ${
        grown.map((p) => `"${p.name}"`).join(", ")
      }에 묶임: 원인이 달라도 이름이 같다`,
    };
  }
  return {
    pass: false,
    reason: `problem이 열리지 않음: 조용히 넘어감 (호출 결과 ${status})`,
  };
}

// 되돌리는 함수를 돌려준다.
type Around = (core: Core) => Promise<() => Promise<void>>;

async function observeFailure(
  core: Core,
  appName: string,
  probe: Probe,
  around?: Around,
): Promise<CheckOutcome> {
  // 끄지 않으면 새 problem마다 진짜 App Engineer session이 열린다.
  await core.call(settingsUpdate, {
    changes: [{
      key: "reactions.problem_opened",
      action: "set",
      value: "off",
    }],
  });
  const app = await findApp(core, appName);
  const before = await appProblems(core, app.id);
  const restore = around === undefined ? undefined : await around(core);
  let status: string;
  try {
    status = (await callApi(core, app.id, probe.api, probe.input)).status;
  } finally {
    await restore?.();
  }
  let after = await waitProblems(
    core,
    app.id,
    (items) => changed(before, items),
  );
  if (changed(before, after)) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    after = await appProblems(core, app.id);
  }
  return decideFailure(before, after, status);
}

// 알림 앱을 멈추고 호출 뒤 되살린다.
function stopNotify(name: string): Around {
  return async (core) => {
    const notify = await findApp(core, name);
    await core.call(appDisableExecution, { app: notify.id }, {
      base_revision: notify.revision,
    });
    // disable은 process가 끝나기 전에 돌아온다. termination_pending인 동안은 call이 아직 성공한다.
    await until(
      "알림 앱이 멈춤",
      async () => {
        const { state } = await core.call(appRuntime, { app: notify.id });
        return state.state !== "running" && !state.termination_pending
          ? true
          : undefined;
      },
      10_000,
    ).catch(() => {});
    return async () => {
      const now = (await core.call(appGet, { app: notify.id })).app;
      await core.call(appEnableExecution, { app: notify.id }, {
        base_revision: now.revision,
      });
    };
  };
}

// 앱 DB의 사용자 표를 모두 이름을 바꿔 둔다. 앱의 store 연결이 열려 있는 채 질의가 실패하는 가장 단순한 길이다.
// 제품 route에는 store 실패를 일으키는 길이 없다. 되돌리지 않는다(trial이 끝나면 root가 지워진다).
function renameTables(appName: string): Around {
  return async (core) => {
    const app = await findApp(core, appName);
    const db = new DatabaseSync(
      `${core.run.home}/apps/${app.id}/data/app.sqlite`,
    );
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      ).all() as { name: string }[];
      for (const { name } of tables) {
        db.exec(`ALTER TABLE "${name}" RENAME TO "${name}__eval_gone"`);
      }
    } finally {
      db.close();
    }
    return () => Promise.resolve();
  };
}

// ticket 글에 없는 이름만 돌려준다.
export function namesMissing(names: string[], ticketText: string): string[] {
  return [...new Set(names)].filter((name) => !ticketText.includes(name));
}

export function observationChecks(spec: ObserveSpec): ProgramCheck[] {
  return [
    liveCheck(
      "observe-bad-input",
      (core) => observeFailure(core, spec.app, spec.badInput),
    ),
    liveCheck(
      "observe-notify-down",
      (core) =>
        observeFailure(
          core,
          spec.app,
          spec.notifyDown,
          stopNotify(spec.notify),
        ),
    ),
    liveCheck(
      "observe-store",
      (core) =>
        observeFailure(core, spec.app, spec.store, renameTables(spec.app)),
    ),
    liveCheck("observe-names-in-ticket", async (core) => {
      const app = await findApp(core, spec.app);
      const names: string[] = [];
      for (const item of await appProblems(core, app.id)) {
        const { problem } = await core.call(problemGet, { problem: item.id });
        if (problem.group_key.kind === "named") {
          names.push(problem.group_key.name);
        }
      }
      if (names.length === 0) {
        return { pass: false, reason: "이름으로 보고된 problem이 없음" };
      }
      const text = (await appTickets(core, app.id)).map((t) =>
        `${t.goal}\n${JSON.stringify(t.check)}`
      ).join("\n");
      const missing = namesMissing(names, text);
      return {
        pass: missing.length === 0,
        reason: missing.length === 0
          ? `problem 이름 ${names.length}개가 모두 ticket에 있음`
          : `ticket에 없는 problem 이름: ${missing.join(", ")}`,
      };
    }),
  ];
}
