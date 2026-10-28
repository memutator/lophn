// Router의 writer·reader Worker 쪽 등록 file이다. Worker가 팀 등록 file로 import하면 Router가 쓸 바깥 구현
// (session 목록, 입력 transport)을 이 file이 끼운다. main thread의 wiring은 router.ts다.
import {
  createReceivedRecorder,
  createSessionDirectory,
  placeDepsOf,
} from "../../../lophn-agent/places/mod.ts";
import {
  createLophnInputTransport,
  interruptRunningTurns,
  publishAfterCommit,
} from "../../../lophn-agent/run-loop/mod.ts";
import {
  createCallStore,
  createRouterReaderRegistration,
  createRouterRegistration,
  installRouterEnvironment,
  type RouterEnvironment,
} from "../../../router/mod.ts";
import { afterCommit } from "../../../storage/ledger/after-commit.ts";
import { AGENT_EVENT_TOPIC } from "../../../lophn-agent/run-loop/topics.ts";

const environment: RouterEnvironment = {
  deps(view, who) {
    const places = placeDepsOf(view.sql);
    const directory = createSessionDirectory({
      ...places,
      // 새 session의 SessionStarted는 commit 뒤에 Bus로 낸다.
      publish: (event) => view.port(afterCommit).push(AGENT_EVENT_TOPIC, event),
      sql: () => view.sql,
    });
    // lophn session은 입력함이 받는다.
    const transport = createLophnInputTransport({
      record: (tx, session, input) =>
        createReceivedRecorder({ principal: who }).record(tx, session, input),
    });
    return {
      directory,
      transport,
      store: createCallStore(),
    };
  },
  interruptRunningTurns: (tx) =>
    interruptRunningTurns(tx, publishAfterCommit, "restarted"),
  describe(view, target) {
    const running =
      view.sql.get(
        "select 1 as found from turns where session = ? and state = 'running'",
        [target.session],
      ) !== undefined;
    return { state: running ? "running" : "idle" };
  },
};

installRouterEnvironment(environment);

export const createCoreRegistration = createRouterRegistration;
export const createReaderRegistration = createRouterReaderRegistration;
