import { err, type Result } from "../../base/mod.ts";
import { requestPrincipal } from "../storage/ledger/after-commit.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { TargetSession } from "./ports.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { createRouter, type Router, type RouterDeps } from "./router.ts";
import type { RouteInput, RouteResult } from "./model.ts";
import type { SqlView } from "./store.ts";

// Router가 쓰는 바깥 구현(session 목록, 입력 transport, Gate)은 wiring이 끼운다. command와 read는 tx나
// snapshot마다 그 tx의 sql을 보는 구현이 필요해서 요청마다 만든다. writer·reader Worker는 wiring 등록 file을
// import하는 것으로 이 환경을 놓는다.
export type RouterEnvironment = {
  // `who`는 호출한 자격의 principal이다. 받는 session 기록의 본문 blob이 그 이름으로 준비돼 있다.
  deps(view: SqlView, who: () => string): RouterDeps;
  // 켤 때 잃어버린 call을 닫는 같은 tx에서 도는 turn도 닫는다(run-loop의 몫이라 wiring이 끼운다).
  interruptRunningTurns?(tx: Tx): Result<number>;
  // call이 닿을 session 목록에 더하는 정보. 없으면 place는 agent에서 읽고 상태는 unknown이다.
  describe?: RouterDescribe;
};

type RouterDescribe = (
  view: SqlView,
  target: { session: string },
) => { place: { kind: "project" | "app"; id: string } | null; state: string };

let installed: RouterEnvironment | undefined;

export function installRouterEnvironment(environment: RouterEnvironment): void {
  installed = environment;
}

const NOT_WIRED = err({
  code: "unavailable" as const,
  message: "the router is not wired",
});

export function routerEnvironment(): Result<RouterEnvironment> {
  return installed === undefined ? NOT_WIRED : { ok: true, value: installed };
}

// 부른 command의 자격으로 이 tx 안에서 쓸 Router를 만든다.
export function routerFor(tx: Tx): Result<Router> {
  const environment = routerEnvironment();
  if (!environment.ok) return environment;
  const who = () => tx.port(requestPrincipal).principal() ?? "";
  return {
    ok: true,
    value: createRouter(environment.value.deps(tx, who)),
  };
}

// 사람 메시지를 받는 쪽(`SendMessage`)이 같은 tx 안에서 부르는 입구다. message는 보내는 쪽이 이미 썼다.
export const messageRouter = {
  route(tx: Tx, input: RouteInput): Result<RouteResult> {
    const router = routerFor(tx);
    return router.ok ? router.value.route(tx, input) : router;
  },
};

// 받는 session을 찾는다. `SendMessage`가 입력을 쓰기 전에 archive한 session을 거절하는 데 쓴다.
export const messageDirectory = {
  find(tx: Tx, session: string): TargetSession | null {
    const environment = routerEnvironment();
    if (!environment.ok) return null;
    return environment.value
      .deps(tx, () => "")
      .directory.find(session as Id<"ses">);
  },
};

// session을 archive하거나 지울 때 같은 tx에서 그 session이 받은 열린 call을 닫는다.
export function failReceivedCalls(tx: Tx, session: string): Result<void> {
  const router = routerFor(tx);
  return router.ok ? router.value.failReceivedBy(tx, session) : router;
}
