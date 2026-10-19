// 대기 목록·toast·secret 보호 입력 화면. 동작하는 ProjectApp 위에 renderer의 대기 목록 층을 얹고, 항목은 fake Gateway가
// 채운다. toast는 design Toast를 직접 쓴다.
import { type CSSProperties, useState } from "react";
import { Toast, ToastStack } from "@lophn/ui/overlay";

import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { EventsProvider } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import {
  ACTIVATION,
  allItems,
  APP_API_CALL,
  CONFIG_EDIT,
  createFakeWaiting,
  EXTERNAL_CALL,
  FIRST_ACTIVATION,
  REACTION,
  SETTLED,
} from "../../../../../packages/shell/renderer/desktop/connection/waiting/fake-source.ts";
import {
  useWaitingPanel,
  WaitingLayer,
  type WaitingLayerProps,
} from "../../../../../packages/shell/renderer/desktop/connection/waiting/waiting-layer.tsx";
import { busEventSchema } from "../../../../../packages/protocol/events/mod.ts";
import type { CallAgent } from "../../../../../packages/protocol/lophn-agent/calls.ts";
import { reactionsOf } from "../../../../../packages/shell/renderer/desktop/connection/events/reactions.ts";
import { toastText } from "../../../../../packages/shell/renderer/desktop/connection/toasts/toast-text.ts";
import { ProjectApp } from "../project-app.tsx";
import { documentTab } from "../../../mock/phroner-data.ts";
import { SecretInput } from "../../../../../packages/shell/renderer/secret-input/secret-input.tsx";

const DOC = documentTab("eval/experiments/exp-008-query-tools.md");

type Items = Parameters<typeof createFakeWaiting>[0];

const noop = () => {};

const sid = (prefix: string, n: number) =>
  `${prefix}_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
const AT = "2026-10-16T09:00:00.000Z";

// 반응 층이 읽는 것과 같은 event를 fake로 만들어 reactionsOf에 넣는다. 정적 화면이라 overlay 창은 쓰지 않는다.
const permission = APP_API_CALL();
const FAKE_EVENTS = [
  {
    session: permission.session.id,
    type: "PermissionRequested",
    at: AT,
    payload: { request: permission.request },
  },
  {
    type: "ApprovalRequested",
    subject: ACTIVATION().id,
    at: AT,
    payload: { request: ACTIVATION() },
  },
  {
    session: sid("ses", 4),
    type: "QuestionAsked",
    at: AT,
    payload: {
      group: sid("qgr", 1),
      turn: sid("trn", 31),
      tool_call: sid("tcl", 31),
    },
  },
  {
    seq: "7",
    type: "AppRestartHalted",
    subject: sid("app", 1),
    actor: "machine",
    at: AT,
    payload: { release: sid("rel", 7), crashes: 3 },
  },
  {
    seq: "8",
    type: "KindViolationFound",
    subject: sid("dom", 1),
    actor: "machine",
    at: AT,
    payload: { domain: sid("dom", 1), count: 2 },
  },
].flatMap((event) => reactionsOf(busEventSchema.parse(event), "live"));

const AGENTS: Record<string, CallAgent> = {
  [permission.session.id]: permission.session.agent,
};

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
        const text = toastText(reaction, (session) => AGENTS[session] ?? null);
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
function Over(
  { items, initial, toasts = false }: {
    items: Items;
    initial: WaitingLayerProps["initial"];
    toasts?: boolean;
  },
) {
  const [client] = useState(() => createEventClient(createFakeWaiting(items)));
  return (
    <EventsProvider client={client}>
      <ProjectApp
        sidebar={{ foldersClosed: true }}
        panes={[{ tabs: [DOC], selected: DOC.key }]}
        titleExtra={
          <WaitingLayer
            onOpenSession={noop}
            onAnswerInTerminal={noop}
            initial={initial}
          />
        }
      >
        {toasts ? <Toasts /> : null}
      </ProjectApp>
    </EventsProvider>
  );
}

const idOf = (item: { request: { id: string } } | { id: string }) =>
  "request" in item ? item.request.id : item.id;

/** 대기 목록: 모든 session의 대기 요청이 한 목록에 종류별로 나뉜다. coding agent의 물음은 lophn에서 답하지 않고 터미널 탭으로 보낸다. */
export const WaitingList = () => (
  <Over items={allItems()} initial={{ open: true }} />
);

/** 권한 요청 셋을 세부까지 펼친 상태: 대상, 정규화한 입력, 효과가 보인다. app-api와 MCP tool은 선택지가 넷이고 설정 고치기는 둘이다. */
export const WaitingPermission = () => {
  const items = [APP_API_CALL(), CONFIG_EDIT(), EXTERNAL_CALL()];
  return (
    <Over
      items={items}
      initial={{ open: true, expanded: items.map(idOf) }}
    />
  );
};

/** 거절 이유: Deny를 누르면 이유 칸이 열린다. 비워도 되고, 적으면 요청한 agent의 tool 결과로 간다. */
export const WaitingDenyReason = () => {
  const items = [APP_API_CALL(), EXTERNAL_CALL()];
  return (
    <Over
      items={items}
      initial={{
        open: true,
        denying: { id: idOf(items[0]), reason: "Ask Budget's owner first." },
      }}
    />
  );
};

/** activation 허락 카드를 펼친 상태: 이전 release보다 늘어난 선언과 손실 단계만 보인다. */
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

/** 물음인 reaction을 펼친 상태: 어떤 domain event로 어떤 agent의 session을 열지 보이고 허락·거절한다. */
export const WaitingReaction = () => {
  const item = REACTION();
  return (
    <Over items={[item]} initial={{ open: true, expanded: [idOf(item)] }} />
  );
};

/** 결정한 뒤 잠깐 남는 줄: 접수와 적용 성공을 구별하고, 거절과 cancelled를 구별한다. */
export const WaitingSettled = () => (
  <Over items={["question"]} initial={{ open: true, settled: SETTLED }} />
);

/** toast 묶음: 권한 요청, 허락 요청, 질문, 앱 재시작 멈춤. 창 위 overlay라 layout을 차지하지 않는다. */
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
