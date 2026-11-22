import { ok } from "../../../base/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import { failReceivedCalls } from "../../router/environment.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { interruptRunningTurns } from "../run-loop/interrupt.ts";
import { QUEUE_CLEAR_TOPIC } from "../run-loop/topics.ts";
import { publishAfterCommit } from "../run-loop/turn-events.ts";
import type { EndDeps, OpenDeps, WorkspaceDeps } from "./ports.ts";
import { UNWIRED_END_DEPS, UNWIRED_WORKSPACE_DEPS } from "./unwired.ts";

// project, 앱, agent 정의는 다른 module의 것이라 읽는 길을 wiring이 끼운다. tx나 snapshot마다 그 sql을 보는
// 구현이 필요해서 요청마다 만든다. writer·reader Worker는 wiring 등록 file을 import하는 것으로 이 환경을 놓는다.
type WorkspaceEnvironment = {
  deps(sql: Pick<Sql, "get" | "all">): WorkspaceDeps;
};

let installed: WorkspaceEnvironment | undefined;

export function installWorkspaceEnvironment(
  environment: WorkspaceEnvironment,
): void {
  installed = environment;
}

// 놓지 않았으면 project와 앱이 없는 것으로 읽혀 session을 열지 못한다.
export function workspaceDepsOf(sql: Pick<Sql, "get" | "all">): WorkspaceDeps {
  return installed?.deps(sql) ?? UNWIRED_WORKSPACE_DEPS;
}

// 이 tx에서 session을 여는 deps다. SessionStarted는 commit 뒤에 Bus로 간다.
export function openDepsOf(tx: Tx): OpenDeps {
  return {
    ...workspaceDepsOf(tx.sql),
    publish: (event) => publishAfterCommit(tx, event),
  };
}

export const COMMIT_END_DEPS: Pick<EndDeps, "clearQueue" | "publish"> = {
  clearQueue: (tx, session) =>
    tx.port(afterCommit).push(QUEUE_CLEAR_TOPIC, { session }),
  publish: publishAfterCommit,
};

// session을 archive하거나 지우는 command가 같은 tx에서 하는 일이다. 도는 turn은 같은 tx에서 닫고, queue 비우기와 Bus event는 commit 뒤에
// main thread가 한다.
export const SESSION_END_DEPS: EndDeps = {
  ...UNWIRED_END_DEPS,
  ...COMMIT_END_DEPS,
  effects: { ...UNWIRED_END_DEPS.effects, failReceivedCalls },
  interruptRunningTurns: (tx, session) => {
    const done = interruptRunningTurns(
      tx,
      publishAfterCommit,
      "session_ended",
      session,
    );
    return done.ok ? ok(undefined) : done;
  },
};
