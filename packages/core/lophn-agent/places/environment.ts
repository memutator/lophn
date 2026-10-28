import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { INBOX_CLEAR_TOPIC } from "../run-loop/topics.ts";
import { publishAfterCommit } from "../run-loop/turn-events.ts";
import type { EndDeps, OpenDeps, PlaceDeps } from "./ports.ts";
import { UNWIRED_PLACE_DEPS } from "./unwired.ts";

// project, 앱, agent 정의는 다른 module의 것이라 읽는 길을 wiring이 끼운다. tx나 snapshot마다 그 sql을 보는
// 구현이 필요해서 요청마다 만든다. writer·reader Worker는 wiring 등록 file을 import하는 것으로 이 환경을 놓는다.
type PlaceEnvironment = {
  deps(sql: Pick<Sql, "get" | "all">): PlaceDeps;
};

let installed: PlaceEnvironment | undefined;

export function installPlaceEnvironment(environment: PlaceEnvironment): void {
  installed = environment;
}

// 놓지 않았으면 project와 앱이 없는 것으로 읽혀 session을 열지 못한다.
export function placeDepsOf(sql: Pick<Sql, "get" | "all">): PlaceDeps {
  return installed?.deps(sql) ?? UNWIRED_PLACE_DEPS;
}

// 이 tx에서 session을 여는 deps다. SessionStarted는 commit 뒤에 Bus로 간다.
export function openDepsOf(tx: Tx): OpenDeps {
  return {
    ...placeDepsOf(tx.sql),
    publish: (event) => publishAfterCommit(tx, event),
  };
}

export const COMMIT_END_DEPS: Pick<EndDeps, "clearInbox" | "publish"> = {
  clearInbox: (tx, session) =>
    tx.port(afterCommit).push(INBOX_CLEAR_TOPIC, { session }),
  publish: publishAfterCommit,
};
