// event를 넣으면 반응(toast) 목록이 나오는 순수 함수. 문구 key는 toast 호스트의 wording이 채운다.
import type { BusEvent } from "../../../../../protocol/events/mod.ts";
import { approvalWaitingKind } from "./waiting-store.ts";

export type ReactionAction =
  | { kind: "waiting" }
  /** session이 null이고 app이 있으면 호스트가 그 앱의 App Engineer 열린 session을 찾아 연다. */
  | { kind: "session"; session: string | null; app?: string }
  | {
    kind: "project-manager";
    project: string;
    context: string;
    check: string;
  };

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
  "PermissionRequested",
  "ApprovalRequested",
  "QuestionAsked",
  "AppRestartHalted",
  "ContextViolationFound",
] as const;

const NONE: readonly Reaction[] = [];

function toast(
  kind: string,
  id: string,
  params: Record<string, string>,
  action: ReactionAction,
): readonly Reaction[] {
  return [{
    id: `${kind}:${id}`,
    titleKey: `waiting.toast-${kind}.title`,
    bodyKey: `waiting.toast-${kind}.body`,
    params,
    action,
  }];
}

/** snapshot으로 들어온 것은 놓친 toast라 다시 띄우지 않는다. */
export function reactionsOf(
  event: BusEvent,
  origin: "live" | "snapshot",
): readonly Reaction[] {
  if (origin === "snapshot") return NONE;
  switch (event.type) {
    case "PermissionRequested":
      return toast("permission", event.payload.request.id, {
        session: event.session,
        intent: event.payload.request.intent.kind,
      }, { kind: "waiting" });
    case "ApprovalRequested": {
      const request = event.payload.request;
      if (approvalWaitingKind(request) === null) return NONE;
      return toast("approval", request.id, { intent: request.intent.kind }, {
        kind: "waiting",
      });
    }
    case "QuestionAsked":
      return toast(
        "question",
        event.payload.group,
        { session: event.session },
        {
          kind: "waiting",
        },
      );
    case "AppRestartHalted":
      // 반응이 여는 App Engineer session은 나중에 SessionStarted로 생기니 지금은 session id를 모른다.
      return toast(
        "restart-halted",
        event.seq,
        { app: event.subject, crashes: String(event.payload.crashes) },
        { kind: "session", session: null, app: event.subject },
      );
    case "ContextViolationFound": {
      const { project, context, check } = event.payload;
      return toast("violation", event.seq, { project, context, check }, {
        kind: "project-manager",
        project,
        context,
        check,
      });
    }
    default:
      return NONE;
  }
}
