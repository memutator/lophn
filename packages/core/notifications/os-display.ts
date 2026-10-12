// OS 표시 경로. 이 모듈은 ledger를 쓰지 않는다.
// 사람이 켰을 때만 같은 notification의 redaction한 최소 제목·대상 열기를 shell main에 줄
// 요청 모양으로 만들고, 표시 실패 관측은 ledger 밖 bounded 메모리에만 둔다. 배달 성공·실패용
// 업무 상태·event·재시도 표는 없다. 재시작 뒤에는 관측이 없으므로 성공으로 채우지 않는다.

import { type Clock, err, ok, type Result } from "../../base/mod.ts";
import {
  OS_DELIVERY_FAILURE_REASONS,
  type OsDeliveryFailureReason,
} from "../../protocol/notifications/mod.ts";
import { redactScreen } from "../../base/redaction/mod.ts";
import type { NotificationView } from "./model.ts";

// shell main에 주는 전부다. focus·문서·앱을 바꾸라는 필드가 없다. 이동은 사람이 Open을
// 고른 뒤 shell이 `open`이 가리키는 대상 화면으로 한다.
export type OsDisplayRequest = {
  notification: string;
  title: { kind: string };
  open: { kind: string; id: string } | null;
};

// 대상 종류마다 열 곳을 가리키는 필드 하나만 남긴다. 나머지(app·report·session 등)는
// OS로 나가지 않는다.
const OPEN_FIELD: Record<string, string> = {
  problem: "problem",
  approval: "approval",
  question: "question",
  ticket: "ticket",
  assignment: "assignment",
  context: "context",
  release: "release",
};

function openOf(target: unknown): { kind: string; id: string } | null {
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    return null;
  }
  const record = target as Record<string, unknown>;
  const kind = record["kind"];
  if (typeof kind !== "string") return null;
  const field = OPEN_FIELD[kind];
  if (field === undefined) return null;
  const id = record[field];
  return typeof id === "string" ? { kind, id } : null;
}

// 사람이 켜지 않았으면 만들지 않는다(기본은 창 안에만 보인다). 만들 때도 redaction을
// 한 번 더 거치고, 거절되면 아무것도 내보내지 않는다.
export function osDisplayRequest(
  view: NotificationView,
  optedIn: boolean,
): OsDisplayRequest | null {
  if (!optedIn) return null;
  const screened = redactScreen(
    { title: view.title, open: openOf(view.target) },
    ["title", "open"],
    [],
  );
  if (!screened.ok) return null;
  const value = screened.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const shaped = value as Record<string, unknown>;
  const title = shaped["title"];
  // 제목이 계기 종류 하나가 아니면(redaction이 모양을 바꾼 경우) 아무것도 올리지 않는다.
  if (
    title === null || typeof title !== "object" || Array.isArray(title) ||
    typeof (title as Record<string, unknown>)["kind"] !== "string"
  ) return null;
  return {
    notification: view.notification.id,
    title: { kind: (title as { kind: string }).kind },
    open: asOpen(shaped["open"]),
  };
}

function asOpen(value: unknown): { kind: string; id: string } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return typeof record["kind"] === "string" && typeof record["id"] === "string"
    ? { kind: record["kind"], id: record["id"] }
    : null;
}

// 표시 실패 이유는 contract의 고정 값뿐이다. OS 원문 오류는 담지 않는다.
export { OS_DELIVERY_FAILURE_REASONS, type OsDeliveryFailureReason };

// 조회에 붙는 전달 상태. "delivered"는 없다: 배달 성공은 보장하지 않는다.
// not_requested는 사람이 켜지 않아 OS로 올리지 않은 것, unconfirmed는 켰지만 이 실행에서
// 실패 관측이 없는 것(재시작 뒤 이전 결과를 확인할 수 없는 경우 포함)이다.
export type OsDeliveryState =
  | { state: "not_requested" }
  | { state: "unconfirmed" }
  | {
    state: "failed";
    reason: OsDeliveryFailureReason;
    observed_at: string;
  };

export const OS_DELIVERY_MEMORY = 1000;

export type OsDeliveryObservations = {
  /** shell이 안전 이유로 알린 표시 실패를 기억한다. 이유가 고정 값이 아니면 거절한다. */
  recordFailure(
    notification: string,
    reason: unknown,
  ): Result<{ observed_at: string }>;
  /** 다음 조회에 붙일 전달 상태. 읽기만 하며 아무것도 다시 보내지 않는다. */
  lookup(notification: string, optedIn: boolean): OsDeliveryState;
};

function isReason(value: unknown): value is OsDeliveryFailureReason {
  return (OS_DELIVERY_FAILURE_REASONS as readonly unknown[]).includes(value);
}

export function createOsDeliveryObservations(
  clock: Clock,
  limit: number = OS_DELIVERY_MEMORY,
): OsDeliveryObservations {
  const failures = new Map<
    string,
    { reason: OsDeliveryFailureReason; observed_at: string }
  >();
  return {
    recordFailure(notification, reason) {
      if (!isReason(reason)) {
        return err({
          code: "invalid_input",
          message: "전달 실패 이유가 고정 값이 아니다",
        });
      }
      const observed_at = clock.now();
      // 같은 notification의 다시 본 실패는 가장 나중 관측으로 바꾼다. 개수는 늘지 않는다.
      failures.delete(notification);
      failures.set(notification, { reason, observed_at });
      if (failures.size > limit) {
        const oldest = failures.keys().next().value;
        if (oldest !== undefined) failures.delete(oldest);
      }
      return ok({ observed_at });
    },
    lookup(notification, optedIn) {
      if (!optedIn) return { state: "not_requested" };
      const found = failures.get(notification);
      if (found === undefined) return { state: "unconfirmed" };
      return { state: "failed", ...found };
    },
  };
}
