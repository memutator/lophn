// Router의 writer·reader Worker 쪽 등록 file이다. Worker가 팀 등록 file로 import하면 Router가 쓸 바깥 구현
// (session 목록, 입력 transport)을 이 file이 끼운다. main thread의 wiring은 router.ts다.
import { DEFAULT_CALL_POLICY } from "../../../../protocol/lophn-agent/call-policy.ts";
import { callPolicyAt } from "../../../config/setting-declarations.ts";
import { dataRootOf } from "../../../lophn-agent/agents/store.ts";
import {
  createReceivedRecorder,
  createSessionDirectory,
  workspaceDepsOf,
} from "../../../lophn-agent/workspaces/mod.ts";
import {
  createLophnInputTransport,
  interruptRunningTurns,
  publishAfterCommit,
} from "../../../lophn-agent/run-loop/mod.ts";
import { createHarnessInputTransport } from "../../../lophn-agent/session/mod.ts";
import { transportBySession } from "../../../router/router.ts";
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
    const workspaces = workspaceDepsOf(view.sql);
    const directory = createSessionDirectory({
      ...workspaces,
      // 새 session의 SessionStarted는 commit 뒤에 Bus로 낸다.
      publish: (event) => view.port(afterCommit).push(AGENT_EVENT_TOPIC, event),
      sql: () => view.sql,
    });
    const { record } = createReceivedRecorder({ principal: who });
    // lophn session은 run-loop의 queue가, harness session은 host의 queue가 받는다.
    const transport = transportBySession({
      lophn: createLophnInputTransport({ record }),
      harness: createHarnessInputTransport({ record }),
    });
    return {
      directory,
      transport,
      store: createCallStore(),
      announce: (tx, topic, data) => tx.port(afterCommit).push(topic, data),
      // writer Worker 안에서 설정 파일을 읽는다. data root는 ledger 파일이 있는 폴더이고, 읽지 못하면 규칙이 없는 기본(모두 허용)이다.
      callPolicy: () => {
        const root = dataRootOf(view.sql, undefined);
        return root.ok ? callPolicyAt(root.value) : DEFAULT_CALL_POLICY;
      },
    };
  },
  // turn의 mode는 시작 때 정해져 바뀌지 않는다.
  unattendedTurn: (view, turn) =>
    view.sql.get("select mode from turns where id = ?", [turn])?.["mode"] ===
    "unattended",
  interruptRunningTurns: (tx) =>
    interruptRunningTurns(tx, publishAfterCommit, "restarted"),
  describe(view, target) {
    const running =
      view.sql.get(
        "select 1 as found from turns where session = ? and state = 'running'",
        [target.session],
      ) !== undefined;
    if (!running) return { state: "idle" };
    // 사람의 동의를 기다리는 call(판정 전의 confirm call)이나 답을 기다리는 질문(시작한 ask)이 있으면 waiting이다.
    const waiting =
      view.sql.get(
        `select 1 as found from tool_calls c join turns t on t.id = c.turn
         where t.session = ? and t.state = 'running'
           and ((c.state = 'requested' and c.decision is null and c.confirm = 1)
             or (c.state = 'started' and c.tool = 'ask'))`,
        [target.session],
      ) !== undefined;
    return { state: waiting ? "waiting" : "running" };
  },
};

installRouterEnvironment(environment);

export const createCoreRegistration = createRouterRegistration;
export const createReaderRegistration = createRouterReaderRegistration;
