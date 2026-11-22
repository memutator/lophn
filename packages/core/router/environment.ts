import { err, type Result } from "../../base/mod.ts";
import { requestPrincipal } from "../storage/ledger/after-commit.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { TargetSession } from "./ports.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import type { TurnEndedKind } from "../../protocol/lophn-agent/mail.ts";
import { createRouter, type Router, type RouterDeps } from "./router.ts";
import type { RouteInput, RouteResult } from "./model.ts";
import type { SqlView } from "./store.ts";

// Router가 쓰는 바깥 구현(session 목록, 입력 transport, Gate)은 wiring이 끼운다. command와 read는 tx나
// snapshot마다 그 tx의 sql을 보는 구현이 필요해서 요청마다 만든다. writer·reader Worker는 wiring 등록 file을
// import하는 것으로 이 환경을 놓는다.
export type RouterEnvironment = {
  // `who`는 호출한 자격의 principal이다. 받는 session 기록의 본문 blob이 그 이름으로 준비돼 있다.
  deps(view: SqlView, who: () => string): RouterDeps;
  // 부른 agent credential이 묶인 turn의 mode가 unattended인지. call과 답의 unattended 표시는 model 입력이 아니라 이 turn
  // mode에서 찍는다. skip은 call을 따라 가지 않는다.
  unattendedTurn(view: SqlView, turn: string): boolean;
  // 켤 때 잃어버린 call을 닫는 같은 tx에서 도는 turn도 닫는다(run-loop의 몫이라 wiring이 끼운다).
  // notify는 그 turn들이 가져간 call의 보낸 session에 줄 실패 글이 준비됐는지다.
  interruptRunningTurns?(tx: Tx, notify: boolean): Result<number>;
  // call이 닿을 session 목록에 더하는 정보. 없으면 상태는 unknown이다.
  describe?: RouterDescribe;
};

type RouterDescribe = (
  view: SqlView,
  target: { session: string },
) => { state: string };

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

// 앱의 slug와 보관 여부. 앱 화면이 보낸 사람 메시지의 이름표를 얼릴 때 쓴다.
export function messageApp(tx: Tx, id: string): { slug: string } | null {
  const environment = routerEnvironment();
  if (!environment.ok) return null;
  return environment.value.deps(tx, () => "").directory.app(id);
}

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

// 받은 turn이 답 없이 끝난 call 하나를 같은 tx에서 닫는다(GUI 탭 팀원).
export function failReceivedCall(
  tx: Tx,
  session: string,
  call: string,
): Result<boolean> {
  const router = routerFor(tx);
  return router.ok ? router.value.failReceived(tx, session, call) : router;
}

// session을 archive하거나 지울 때 같은 tx에서 그 session이 받은 열린 call을 닫는다.
export function failReceivedCalls(tx: Tx, session: string): Result<void> {
  const router = routerFor(tx);
  return router.ok ? router.value.failReceivedBy(tx, session) : router;
}

// 받는 session의 turn이 call 입력을 가져갔거나 답 없이 끝냈다는 신호를 받는 쪽이다. run-loop가 turn을 시작하고 끝내는 tx에서 부른다.
export const callSignals = {
  consumed(tx: Tx, call: Id<"cal">): Result<void> {
    const router = routerFor(tx);
    return router.ok ? router.value.markConsumed(tx, call) : router;
  },
  abandoned(
    tx: Tx,
    input: {
      call: Id<"cal">;
      session: Id<"ses">;
      ended: TurnEndedKind;
      step: boolean;
      notify: boolean;
    },
  ): Result<void> {
    const router = routerFor(tx);
    return router.ok ? router.value.abandoned(tx, input) : router;
  },
};
