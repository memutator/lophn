// 대기 목록·toast·secret 보호 입력 화면. 동작하는 ProjectApp 위에 pill과 panel, toast를 얹어 고정 상태로 놓는다.
import { ProjectApp } from "../project-app.tsx";
import { documentTab } from "../phroner-data.ts";
import { SecretInput } from "./secret-input.tsx";
import {
  ACTIVATION,
  ALL_ITEMS,
  APP_API_CALL,
  CONFIG_EDIT,
  EXTERNAL_CALL,
  FIRST_ACTIVATION,
  QUESTION,
  REACTION,
  SETTLED,
  TOASTS,
  type WaitingItem,
} from "./waiting-data.ts";
import { WaitingLayer, type WaitingLayerProps } from "./waiting-list.tsx";

const DOC = documentTab("eval/experiments/exp-008-query-tools.md");

// 문서 탭 하나가 열린 project 창 의 위쪽 바에 대기 목록 층을 둔다.
function over(props: WaitingLayerProps) {
  return (
    <ProjectApp
      sidebar={{ foldersClosed: true }}
      panes={[{ tabs: [DOC], selected: DOC.key }]}
      titleExtra={<WaitingLayer {...props} />}
    />
  );
}

const open = (
  items: readonly WaitingItem[],
  rest: Omit<WaitingLayerProps, "items" | "open"> = {},
) => over({ items, open: true, ...rest });

/** 대기 목록: 모든 session의 대기 요청이 한 목록에 종류별로 나뉜다. coding agent의 물음은 lophn에서 답하지 않고 터미널 탭으로 보낸다. */
export const WaitingList = () => open(ALL_ITEMS);

/** 권한 요청 셋을 세부까지 펼친 상태: 대상, 정규화한 입력, 효과가 보인다. app-api와 MCP tool은 선택지가 넷이고 설정 고치기는 둘이다. */
export const WaitingPermission = () =>
  open([APP_API_CALL, CONFIG_EDIT, EXTERNAL_CALL], {
    expanded: [APP_API_CALL.id, CONFIG_EDIT.id, EXTERNAL_CALL.id],
  });

/** 거절 이유: Deny를 누르면 이유 칸이 열린다. 비워도 되고, 적으면 요청한 agent의 tool 결과로 간다. */
export const WaitingDenyReason = () =>
  open([APP_API_CALL, EXTERNAL_CALL], {
    denying: { id: APP_API_CALL.id, reason: "Ask Budget's owner first." },
  });

/** activation 허락 카드를 펼친 상태: 이전 release보다 늘어난 선언과 손실 단계만 보인다. */
export const WaitingActivation = () =>
  open([ACTIVATION], { expanded: [ACTIVATION.id] });

/** 첫 activation: 이전 release가 없어서 선언 전부가 늘어난 것이다. */
export const WaitingFirstActivation = () =>
  open([FIRST_ACTIVATION], { expanded: [FIRST_ACTIVATION.id] });

/** 물음인 reaction을 펼친 상태: 어떤 domain event로 어떤 agent의 session을 열지 보이고 허락·거절한다. */
export const WaitingReaction = () =>
  open([REACTION], { expanded: [REACTION.id] });

/** 결정한 뒤 잠깐 남는 줄: 접수와 적용 성공을 구별하고, 거절과 cancelled를 구별한다. */
export const WaitingSettled = () => open([QUESTION], { settled: SETTLED });

/** toast 묶음: 권한 요청, 허락 요청, 질문, 앱 재시작 멈춤. 창 위 overlay라 layout을 차지하지 않는다. */
export const WaitingToasts = () => over({ items: ALL_ITEMS, toasts: TOASTS });

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
