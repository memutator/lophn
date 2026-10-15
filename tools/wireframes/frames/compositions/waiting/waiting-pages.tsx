// 대기 목록·toast·secret 보호 입력 화면. 동작하는 ProjectApp 위에 renderer의 대기 목록 층을 얹고, 항목은 fake Gateway가
// 채운다. toast 그림은 screens-data-toast가 고치기 전까지 이 파일 안 작은 wrapper가 그린다.
import { useState } from "react";
import { ToastStack } from "@lophn/design/components";

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
import { ProjectApp } from "../project-app.tsx";
import { documentTab } from "../phroner-data.ts";
import { SecretInput } from "./secret-input.tsx";
import { type ToastRow, WaitingToast } from "./waiting-toast.tsx";

const DOC = documentTab("eval/experiments/exp-008-query-tools.md");

type Items = Parameters<typeof createFakeWaiting>[0];

const noop = () => {};

const TOASTS: readonly ToastRow[] = [
  {
    id: "toast-permission",
    title: "Operator needs permission",
    body: "Call Budget › entries.create (write)",
    action: "Review",
    goes: "list",
  },
  {
    id: "toast-approval",
    title: "Orders release 7 needs approval",
    body: "4 new declarations and 3 data-loss steps",
    action: "Review",
    goes: "list",
  },
  {
    id: "toast-question",
    title: "lophn has a question",
    body: "Weekly report",
    action: "Open session",
    goes: "session",
  },
  {
    id: "toast-restart",
    title: "App restart halted",
    body: "Orders kept crashing, so lophn stopped restarting it.",
    action: "Open session",
    goes: "session",
  },
];

// toast의 [Review]는 대기 목록 panel을 연다.
function Toasts() {
  const { setOpen } = useWaitingPanel();
  const [toasts, setToasts] = useState(TOASTS);
  const remove = (id: string) =>
    setToasts((now) => now.filter((row) => row.id !== id));
  return (
    <ToastStack>
      {toasts.map((toast) => (
        <WaitingToast
          key={toast.id}
          toast={toast}
          onAction={() => {
            if (toast.goes === "list") setOpen(true);
            remove(toast.id);
          }}
          onClose={() => remove(toast.id)}
        />
      ))}
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

/** secret 보호 입력: provider key. 값은 점으로만 보인다. */
export const SecretInputProvider = () => <SecretInput kind="provider" />;

/** secret 보호 입력: 이미 설정된 앱 secret의 값을 바꾼다. */
export const SecretInputApp = () => (
  <SecretInput
    kind="app"
    filled
    configured
  />
);

/** secret 보호 입력: MCP server credential. */
export const SecretInputMcp = () => <SecretInput kind="mcp" />;
