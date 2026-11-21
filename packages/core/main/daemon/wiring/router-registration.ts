// Router의 writer·reader Worker 쪽 등록 file이다. Worker가 팀 등록 file로 import하면 Router가 쓸 바깥 구현
// (session 목록, 입력 transport)을 이 file이 끼운다. main thread의 wiring은 router.ts다.
import { DEFAULT_CALL_POLICY } from "../../../../protocol/lophn-agent/call-policy.ts";
import { callPolicyAt } from "../../../config/setting-declarations.ts";
import { err, ok } from "../../../../base/mod.ts";
import { dataRootOf } from "../../../lophn-agent/agents/store.ts";
import { readMachineIdSync } from "../../../machine/mod.ts";
import { projectByIdentity } from "../../../projects/lookups.ts";
import { loadProject } from "../../../projects/registry/mod.ts";
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
import { sessionStateOf } from "../../../lophn-agent/session/state.ts";
import { transportBySession } from "../../../router/router.ts";
import {
  callSignals,
  createCallStore,
  createMailOutbox,
  createMailSeen,
  createRouterReaderRegistration,
  createRouterRegistration,
  installRouterEnvironment,
  type RouterEnvironment,
} from "../../../router/mod.ts";
import { afterCommit } from "../../../storage/ledger/after-commit.ts";
import {
  remoteStepChanged,
  remoteStepFailed,
} from "../../../workflows/remote.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";

const announce = (tx: Tx, topic: string, data: unknown) =>
  tx.port(afterCommit).push(topic, data);
import { AGENT_EVENT_TOPIC } from "../../../lophn-agent/run-loop/topics.ts";
import type { Id } from "../../../../protocol/base/ids.ts";

const environment: RouterEnvironment = {
  deps(view, who) {
    const workspaces = workspaceDepsOf(view.sql);
    const directory = {
      ...createSessionDirectory({
        ...workspaces,
        // 새 session의 SessionStarted는 commit 뒤에 Bus로 낸다.
        publish: (event) =>
          view.port(afterCommit).push(AGENT_EVENT_TOPIC, event),
        sql: () => view.sql,
      }),
      projectOfIdentity: (identity: string) =>
        projectByIdentity(view.sql, identity) as Id<"prj"> | null,
      identityOfProject(project: string) {
        const found = workspaces.projects.projectByName(project);
        if (found === null) {
          return err({
            code: "not_found" as const,
            message: "project not found",
          });
        }
        const loaded = loadProject(view.sql, found.id);
        return loaded.ok ? ok(loaded.value?.identity ?? null) : loaded;
      },
    };
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
      outbox: createMailOutbox(),
      seen: createMailSeen(),
      // writer Worker 안에서 data root의 machine.json을 읽는다. core는 켤 때 그 file을 만든다.
      self: () => {
        const root = dataRootOf(view.sql, undefined);
        const machine = root.ok ? readMachineIdSync(root.value) : root;
        if (!machine.ok) throw new Error(machine.error.message);
        return machine.value;
      },
      announce,
      steps: {
        failed: (tx, call, reason) =>
          remoteStepFailed(tx, call, reason, announce),
        changed: (tx, call) => remoteStepChanged(tx, call, announce),
      },
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
  interruptRunningTurns: (tx, notify) =>
    interruptRunningTurns(tx, publishAfterCommit, "restarted", undefined, {
      signals: callSignals,
      notify,
    }),
  describe: (view, target) => ({
    state: sessionStateOf(view.sql, target.session).state,
  }),
};

installRouterEnvironment(environment);

export const createCoreRegistration = createRouterRegistration;
export const createReaderRegistration = createRouterReaderRegistration;
