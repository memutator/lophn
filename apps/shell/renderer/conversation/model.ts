// 대화 도크의 순수 규칙. 화면은 이 값을 그대로 그린다.
import type { Outgoing } from "./delivery-state.ts";
import type { MessageRow, ResultLink, RunRow, SessionRow } from "./source.ts";

/** 도크 폭(shell/desktop#R2). */
export const DOCK_WIDTH = 400;
/** 도크 옆에 남겨야 하는 본문 폭. 모자라면 overlay다(desktop#R2). */
export const DOCK_BODY_MIN = 480;

export type DockPlacement = "docked" | "overlay" | "hidden";

/**
 * 도크 자리. 본문을 밀고도 본문 480px가 남으면 옆 열, 아니면 overlay다. 정보 패널 자리를
 * 임시로 쓰므로 정보 패널 폭은 셈에 넣지 않는다(desktop#R29).
 */
export function dockPlacement(
  open: boolean,
  contentWidth: number,
): DockPlacement {
  if (!open) return "hidden";
  return contentWidth - DOCK_WIDTH >= DOCK_BODY_MIN ? "docked" : "overlay";
}

/** 도크가 열리면 정보 패널은 자리를 내주고, 닫히면 사람이 둔 상태로 돌아간다. */
export function infoPanelShown(
  infoOpen: boolean,
  dock: DockPlacement,
): boolean {
  return infoOpen && dock === "hidden";
}

export type WorkStatus = "in-progress" | "waiting" | "stopped" | "done";

/** run 상태를 화면 말 넷으로 바꾼다(ui-ux 3절). 실패도 사람에게는 멈춤이다. */
export function workStatus(run: RunRow): WorkStatus {
  switch (run.state) {
    case "accepted":
    case "running":
      return "in-progress";
    case "waiting_user":
      return "waiting";
    case "finished":
      return run.outcome === "completed" ? "done" : "stopped";
  }
}

function seq(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/** 세션의 가장 늦게 접수된 run. 상태 줄과 수정의 대상이다. */
export function latestRun(
  runs: readonly RunRow[],
  session: string,
): RunRow | null {
  let found: RunRow | null = null;
  for (const run of runs) {
    if (run.session !== session) continue;
    if (found === null || seq(run.acceptedSeq) > seq(found.acceptedSeq)) {
      found = run;
    }
  }
  return found;
}

/** 아직 끝나지 않은 run. 수정과 멈추기는 이것에만 간다. */
export function activeRun(run: RunRow | null): RunRow | null {
  return run !== null && run.state !== "finished" ? run : null;
}

export interface SessionChoice {
  readonly id: string;
  /** 처음 연 것부터 1. */
  readonly number: number;
  readonly ended: boolean;
}

/** 세션 id는 시간순 ULID다. 고르는 목록은 최신부터, 번호는 오래된 것부터 붙인다. */
export function sessionChoices(
  sessions: readonly SessionRow[],
): readonly SessionChoice[] {
  const ordered = [...sessions].sort((a, b) => a.id.localeCompare(b.id));
  return ordered
    .map((session, index) => ({
      id: session.id,
      number: index + 1,
      ended: session.state === "closed",
    }))
    .reverse();
}

/** 처음 열 세션. 열린 세션 중 최신, 없으면 최신 세션이다. */
export function defaultSession(
  sessions: readonly SessionRow[],
): string | null {
  const choices = sessionChoices(sessions);
  return (choices.find((choice) => !choice.ended) ?? choices[0])?.id ?? null;
}

export type DeliveryLabel =
  | "sending"
  | "received"
  | "applied"
  | "saved"
  | "not-sent"
  | "unconfirmed";

export type ListItem =
  | {
    readonly kind: "message";
    readonly key: string;
    readonly message: MessageRow;
    /** 사람 말의 접수 표시. 다른 주체는 null이다. */
    readonly delivery: DeliveryLabel | null;
  }
  | {
    readonly kind: "outgoing";
    readonly key: string;
    readonly outgoing: Outgoing;
    readonly delivery: DeliveryLabel;
  };

function confirmedDelivery(message: MessageRow): DeliveryLabel | null {
  if (message.actor !== "user") return null;
  if (message.applied) return "applied";
  // paused 담당에 남긴 요청은 담당 run 없이 보존된다(lophn-agent/conversation#R14).
  if (message.mode === "request" && message.run === null) return "saved";
  return "received";
}

function outgoingDelivery(outgoing: Outgoing): DeliveryLabel {
  switch (outgoing.phase) {
    case "sending":
      return "sending";
    case "accepted":
      return "received";
    case "not_sent":
      return "not-sent";
    case "unconfirmed":
      return "unconfirmed";
  }
}

/**
 * 확정 메시지와 아직 확정되지 않은 보낸 말을 한 목록으로 만든다. 같은 id의 확정 메시지가
 * 오면 임시 표시를 그것으로 바꾼다.
 */
export function listItems(
  messages: readonly MessageRow[],
  outgoing: Outgoing | null,
): readonly ListItem[] {
  const items: ListItem[] = messages.map((message) => ({
    kind: "message",
    key: message.id,
    message,
    delivery: confirmedDelivery(message),
  }));
  if (outgoing !== null && !messages.some((item) => item.id === outgoing.id)) {
    items.push({
      kind: "outgoing",
      key: outgoing.id,
      outgoing,
      delivery: outgoingDelivery(outgoing),
    });
  }
  return items;
}

/** 결과 링크 접기(desktop#R3). 4개 이상이면 첫 3개와 남은 개수만 보인다. */
export const RESULT_FOLD_AT = 4;
export const RESULT_SHOWN = 3;

export function foldResults(
  links: readonly ResultLink[],
  expanded: boolean,
): { readonly shown: readonly ResultLink[]; readonly hidden: number } {
  if (expanded || links.length < RESULT_FOLD_AT) {
    return { shown: links, hidden: 0 };
  }
  return {
    shown: links.slice(0, RESULT_SHOWN),
    hidden: links.length - RESULT_SHOWN,
  };
}

/** 맨 아래로 보는 여유. 이만큼 안이면 새 말을 따라 내려간다. */
export const BOTTOM_SLACK = 24;

export function atBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= BOTTOM_SLACK;
}
