// Router ↔ coding transport port. Router의 InputTransport가 harness session에 쓰는 쪽이다.
// 같은 tx 안에서 부르는 동기 Result다. 터미널 요청 frame 전송 같은 비동기 side effect는 이 port 밖에서
// commit 뒤에 한다. `queued` call의 취소와 lophn 재시작 때 failed로 돌리는 일은 Router 몫이다.
import type { z } from "zod";
import type { Result } from "../../base/mod.ts";
import { idSchema } from "../base/ids.ts";
import { definePort, type PortKey } from "../base/ports.ts";
import type { Tx } from "../server/registration.ts";
import type { CodingRunOptions } from "./launch-plan.ts";

const callIdSchema = idSchema("cal");
export type CallId = z.infer<typeof callIdSchema>;

export type CodingStartInput = {
  call: CallId;
  app: string;
  ticket: string;
  // harness가 없으면 transport가 Settings 기본 실행 옵션으로 채운다.
  options: CodingRunOptions;
};
export type CodingStartResult =
  | { status: "started"; session: string }
  | { status: "queued" };

// Result 오류의 details.reason이다.
export const CODING_START_FAILURES = [
  "not_connected",
  "cannot_launch",
  "no_source_folder",
  "ticket_unavailable",
] as const;
export type CodingStartFailure = (typeof CODING_START_FAILURES)[number];

export const CODING_SEND_REJECTIONS = [
  "no_turn_end_signal",
  "state_unknown",
  "session_ended",
] as const;
export type CodingSendRejection = (typeof CODING_SEND_REJECTIONS)[number];

// 앱별 맡기기 줄(메모리)이다.
export type CodingAppLine = {
  app: string;
  active: { session: string; ticket: string; call: CallId } | null;
  waiting: { call: CallId; ticket: string }[];
};

export type CodingTransport = {
  // 그 앱에 끝나지 않은 session이 있으면 queued.
  start(tx: Tx, input: CodingStartInput): Result<CodingStartResult>;
  // idle이면 delivered, 도는 중이라 기다리면 queued. 거절은 CODING_SEND_REJECTIONS.
  send(
    tx: Tx,
    input: { session: string; call: CallId | null; text: string },
  ): Result<{ status: "delivered" | "queued" }>;
  // 줄에 있으면 줄에서 빼고, 돌고 있으면 멈추고 token을 회수한다.
  stop(
    tx: Tx,
    input: { call: CallId; reason: "cancelled" | "ticket_cancelled" },
  ): Result<void>;
  lines(): readonly CodingAppLine[];
};
export const CodingTransport: PortKey<CodingTransport> = definePort<
  CodingTransport
>("CodingTransport");
