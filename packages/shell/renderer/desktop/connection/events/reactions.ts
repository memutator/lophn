// event를 넣으면 반응(toast) 목록이 나오는 순수 함수. 문구 key는 toast 호스트의 wording이 채운다.
// agent의 turn 끝·권한 물음·질문 알림은 여기 없다. 터미널 agent와 같은 규칙으로 shell main이 정한다.
import type { BusEvent } from "../../../../../protocol/events/mod.ts";

export type ReactionAction =
  | { kind: "waiting" }
  /** session이 null이고 app이 있으면 호스트가 그 앱 공간을 연다. */
  | { kind: "session"; session: string | null; app?: string };

export interface Reaction {
  /** 같은 일이 두 번 뜨지 않게 하는 id. */
  readonly id: string;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly params: Readonly<Record<string, string>>;
  readonly action?: ReactionAction;
}

/** toast가 듣는 event 종류. */
export const REACTION_EVENT_TYPES = [
  "ActivationConsentRequested",
  "AppRestartHalted",
] as const;

const NONE: readonly Reaction[] = [];

function toast(
  kind: string,
  id: string,
  params: Record<string, string>,
  action?: ReactionAction,
): readonly Reaction[] {
  return [
    {
      id: `${kind}:${id}`,
      titleKey: `waiting.toast-${kind}.title`,
      bodyKey: `waiting.toast-${kind}.body`,
      params,
      action,
    },
  ];
}

/** snapshot으로 들어온 것은 놓친 toast라 다시 띄우지 않는다. */
export function reactionsOf(
  event: BusEvent,
  origin: "live" | "snapshot",
): readonly Reaction[] {
  if (origin === "snapshot") return NONE;
  switch (event.type) {
    case "ActivationConsentRequested":
      return toast(
        "activation",
        event.payload.release,
        { app: event.payload.app_name },
        { kind: "waiting" },
      );
    case "AppRestartHalted":
      // 열 session이 없어 단추는 그 앱 공간을 연다.
      return toast(
        "restart-halted",
        `${event.subject}:${event.at}`,
        {
          app: event.payload.app_name,
          crashes: String(event.payload.crashes),
        },
        { kind: "session", session: null, app: event.subject },
      );
    default:
      return NONE;
  }
}
