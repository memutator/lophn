// 대기 목록·toast·secret 보호 입력 화면. 동작하는 ProjectApp 위에 renderer의 대기 목록 층을 얹고, 항목은 fake Gateway가
// 채운다. toast는 design Toast를 직접 쓴다.
import { type CSSProperties, useState } from "react";
import { Toast, ToastStack } from "@lophn/ui/overlay";

import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { EventsProvider } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import {
  ACTIVATION,
  allItems,
  createFakeWaiting,
  EXTERNAL_CALL,
  FIRST_ACTIVATION,
  JOB_HOLD_AGENT,
  JOB_HOLD_BLOCKED,
  JOB_APPROVAL_TOOL,
  JOB_HOLD_TOOL,
  JOB_HOLD_WORKFLOW,
  SETTLED,
  SHELL_COMMAND,
} from "../../../../../packages/shell/renderer/desktop/connection/waiting/fake-source.ts";
import {
  useWaitingPanel,
  WaitingLayer,
  type WaitingLayerProps,
} from "../../../../../packages/shell/renderer/desktop/connection/waiting/waiting-layer.tsx";
import { busEventSchema } from "../../../../../packages/protocol/events/mod.ts";
import { reactionsOf } from "../../../../../packages/shell/renderer/desktop/connection/events/reactions.ts";
import { toastText } from "../../../../../packages/shell/renderer/desktop/connection/toasts/toast-text.ts";
import { ProjectApp } from "../project-app.tsx";
import { documentTab } from "../../../mock/phroner-data.ts";
import { click, runSteps, type Step, useDrive } from "../../../mock/drive.ts";
import { SecretInput } from "../../../../../packages/shell/renderer/secret-input/secret-input.tsx";

const DOC = documentTab("eval/experiments/exp-008-query-tools.md");

type Items = Parameters<typeof createFakeWaiting>[0];

const noop = () => {};

const sid = (prefix: string, n: number) =>
  `${prefix}_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
const AT = "2026-10-16T09:00:00.000Z";

// 반응 층이 읽는 것과 같은 event를 fake로 만들어 reactionsOf에 넣는다. 정적 화면이라 overlay 창은 쓰지 않는다.
const FAKE_EVENTS = [
  {
    type: "ActivationConsentRequested",
    subject: ACTIVATION().release,
    at: AT,
    payload: {
      app: ACTIVATION().app,
      app_name: ACTIVATION().app_name,
      release: ACTIVATION().release,
    },
  },
  {
    type: "AppRestartHalted",
    subject: sid("app", 1),
    at: AT,
    payload: { release: sid("rel", 7), app_name: "Orders", crashes: 3 },
  },
].flatMap((event) => reactionsOf(busEventSchema.parse(event), "live"));

// 시간이 가지 않는 timer를 주어 화면에 남은 채로 보인다. ×와 행동으로 닫는다.
const NO_TIMER = { set: () => 0, clear: () => {} };

// toast의 [Review]는 대기 목록 panel을 연다.
function Toasts() {
  const { setOpen } = useWaitingPanel();
  const [reactions, setReactions] = useState(FAKE_EVENTS);
  const remove = (id: string) =>
    setReactions((now) => now.filter((row) => row.id !== id));
  return (
    <ToastStack>
      {reactions.map((reaction) => {
        const text = toastText(reaction);
        return (
          <Toast
            key={reaction.id}
            title={text.title}
            body={text.body}
            actions={text.action ? [{ id: "act", label: text.action }] : []}
            onAction={() => {
              if (reaction.action?.kind === "waiting") setOpen(true);
              remove(reaction.id);
            }}
            onClose={() => remove(reaction.id)}
            timer={NO_TIMER}
          />
        );
      })}
    </ToastStack>
  );
}

// 문서 탭 하나가 열린 project 창의 위쪽 바에 대기 목록 층을 둔다.
function Over({
  items,
  initial,
  toasts = false,
  steps = [],
}: {
  items: Items;
  initial: WaitingLayerProps["initial"];
  toasts?: boolean;
  steps?: readonly Step[];
}) {
  const [client] = useState(() => createEventClient(createFakeWaiting(items)));
  useDrive(() => runSteps(steps));
  return (
    <EventsProvider client={client}>
      <ProjectApp
        sidebar={{ foldersClosed: true }}
        panes={[{ tabs: [DOC], selected: DOC.key }]}
        titleExtra={
          <WaitingLayer align="start" onOpenSession={noop} initial={initial} />
        }
      >
        {toasts ? <Toasts /> : null}
      </ProjectApp>
    </EventsProvider>
  );
}

// 사람이 보지 않는 사이 turn이 끝난 탭 둘: 터미널의 coding agent와 lophn agent session.
const FINISHED = [
  {
    id: "terminal:term_1",
    target: { kind: "terminal", terminal_ref: "term_1" },
    face: { kind: "vendor", harness: "claude" },
    label: "간단한 ui 수정",
    title: "Claude Code",
  },
  {
    id: "session:1",
    target: { kind: "session", session: sid("ses", 1) },
    face: { kind: "avatar", profile: { kind: "initial", text: "B" } },
    label: "Invoice import",
    title: "Bookkeeper",
  },
] as const satisfies NonNullable<
  NonNullable<WaitingLayerProps["initial"]>["finished"]
>;

const idOf = (item: { request: { id: string } } | { release: string }) =>
  "request" in item ? item.request.id : item.release;

/** 대기 목록: 모든 session의 대기 요청이 한 목록에 종류별로 나뉜다. 권한 요청, 질문, activation 동의 세 묶음이다. */
export const WaitingList = () => (
  <Over items={allItems()} initial={{ open: true, finished: FINISHED }} />
);

/** Finished 묶음: 사람이 보지 않는 사이 turn이 끝난 탭이 대기 항목 아래에 나온다. 줄을 누르면 그 탭이 있는 창이 앞으로 오고 탭이 골라지며, 탭을 보면 줄은 저절로 빠진다. 위 알림 단추의 개수에도 들어간다. */
export const WaitingFinished = () => (
  <Over
    items={[SHELL_COMMAND()]}
    initial={{ open: true, finished: FINISHED }}
  />
);

/** 권한 요청 둘: shell 명령은 접지 않고 code 줄로 보이며 Deny, Always allow(더해질 규칙 줄이 있을 때만), Allow once이고, MCP tool은 세부를 펼치면 대상과 효과가 보이며 Deny, Allow once다. 지금은 할당된 tool의 바깥 효과를 묻지 않아서 tool 물음은 실제로는 나오지 않고 카드 그림만 둔다. */
export const WaitingPermission = () => {
  const items = [SHELL_COMMAND(), EXTERNAL_CALL()];
  return (
    <Over items={items} initial={{ open: true, expanded: items.map(idOf) }} />
  );
};

/** 거절 이유: Deny를 누르면 이유 칸이 열린다. 비워도 되고, 적으면 요청한 agent의 tool 결과로 간다. */
export const WaitingDenyReason = () => {
  const items = [SHELL_COMMAND(), EXTERNAL_CALL()];
  return (
    <Over
      items={items}
      initial={{
        open: true,
        denying: {
          id: idOf(items[0]),
          reason: "Ask the release owner first.",
        },
      }}
    />
  );
};

/** activation 동의 카드를 펼친 상태: 이전 release보다 늘어난 선언과 손실 단계만 보인다. 요청한 agent가 없어 거절 이유 칸이 없다. */
export const WaitingActivation = () => {
  const item = ACTIVATION();
  return (
    <Over items={[item]} initial={{ open: true, expanded: [idOf(item)] }} />
  );
};

/** 첫 activation: 이전 release가 없어서 선언 전부가 늘어난 것이다. */
export const WaitingFirstActivation = () => {
  const item = FIRST_ACTIVATION();
  return (
    <Over items={[item]} initial={{ open: true, expanded: [idOf(item)] }} />
  );
};

/** 결정한 뒤 잠깐 남는 줄: 허락, 거절, cancelled를 구별한다. */
export const WaitingSettled = () => (
  <Over items={["question"]} initial={{ open: true, settled: SETTLED }} />
);

/** job hold: 놓친 차례가 "Scheduled jobs" 묶음으로 다른 대기 항목 아래에 섞여 있다. 단추는 오른쪽 끝에 [Skip], [Start now]이다. */
export const WaitingJobHolds = () => (
  <Over
    items={[SHELL_COMMAND(), ACTIVATION(), JOB_HOLD_AGENT()]}
    initial={{ open: true }}
  />
);

/** job 등록 승인: agent가 만든 job은 사람이 한 번 승인해야 돈다. 주기와 할 일이 보이고 단추는 [Reject](job을 지움), [Approve]이다. */
export const WaitingJobApproval = () => (
  <Over
    items={[JOB_APPROVAL_TOOL(), JOB_HOLD_AGENT()]}
    initial={{ open: true }}
  />
);

/** job hold의 세 가지 할 일: agent 호출(받는 agent), 앱 tool 호출(tool과 앱의 짧은 id), workflow 시작(workflow 이름). 놓친 수는 1·1·3이다. */
export const WaitingJobHoldKinds = () => (
  <Over
    items={[JOB_HOLD_AGENT(), JOB_HOLD_TOOL(), JOB_HOLD_WORKFLOW()]}
    initial={{ open: true }}
  />
);

/** 앞 차례가 아직 돌아 [Start now]가 막힌 상태: card는 남고 사유 글이 단추 위에 보이며 [Skip]은 쓸 수 있다. */
export const WaitingJobHoldConflict = () => {
  const blocked = JOB_HOLD_BLOCKED();
  return (
    <Over
      items={[JOB_HOLD_AGENT(), blocked]}
      initial={{ open: true }}
      steps={[
        () => click(`[data-job-hold="${blocked.job_run.id}"] [data-start-now]`),
      ]}
    />
  );
};

/** toast 묶음: 권한 요청, activation 동의, 질문, 앱 재시작 멈춤, kind 위반. 창 위 overlay라 layout을 차지하지 않는다. */
export const WaitingToasts = () => (
  <Over items={allItems()} initial={{ open: false }} toasts />
);

const STAGE: CSSProperties = {
  position: "absolute",
  inset: "var(--space-0)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--color-surface-floor)",
  fontFamily: "var(--font-sans)",
};

const SECRET_WINDOW: CSSProperties = {
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  width: "var(--dialog-width-default)",
  maxWidth: "100%",
  border: "var(--border-width) solid var(--color-border-strong)",
  borderRadius: "var(--radius-lg)",
  background: "var(--color-surface-base)",
  color: "var(--color-text-primary)",
  boxShadow: "var(--shadow-dialog)",
  fontSize: "var(--type-body-size)",
  lineHeight: "var(--type-body-line)",
  overflow: "hidden",
};

/** shell이 따로 띄우는 작은 창 하나를 gallery 무대 가운데에 놓는다. */
const SecretStage = (props: Parameters<typeof SecretInput>[0]) => (
  <div style={STAGE}>
    <div style={SECRET_WINDOW}>
      <SecretInput {...props} />
    </div>
  </div>
);

/** secret 보호 입력: provider key. */
export const SecretInputProvider = () => (
  <SecretStage
    purpose="provider"
    subject="OpenAI"
    name="OPENAI_API_KEY"
    configured={false}
  />
);

/** secret 보호 입력: 이미 설정된 앱 secret의 값을 바꾼다. 값은 점으로만 보인다. */
export const SecretInputApp = () => (
  <SecretStage
    purpose="app"
    subject="Orders app"
    name="PAYMENTS_KEY"
    configured
    initialValue="sk-example-0000000000"
  />
);

/** secret 보호 입력: MCP server credential. */
export const SecretInputMcp = () => (
  <SecretStage
    purpose="mcp"
    subject="mail"
    name="MAIL_ACCESS_TOKEN"
    configured={false}
  />
);
