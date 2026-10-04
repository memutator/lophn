// 열린 창의 제출. handle을 쓰기 전에 정본을 다시 읽고, 불명이면 receipt만 다시 본다.
import { checkSubmission } from "./check.ts";
import type {
  CanonPort,
  Gate,
  SubmitPort,
  SubmitReceipt,
} from "./coordinator.ts";
import type { HandleTable, LiveHandle } from "./handle.ts";

export interface DecidingWindow {
  readonly intent: Parameters<CanonPort["read"]>[0];
  displayId: string;
  gate: Gate;
  display: unknown;
  secondPending: boolean;
}

export interface DecideInput {
  windowId: string;
  displayId: string;
  decision: string;
  commandInput?: unknown;
  confirmedSecond?: boolean;
}

const STALE = "대상이 바뀌었거나 연결을 확인할 수 없다";

export async function decide(input: {
  request: DecideInput;
  live: DecidingWindow | undefined;
  table: HandleTable;
  canon: CanonPort;
  submit: SubmitPort;
  now: number;
  epoch: string;
  connected: boolean;
  publish(live: DecidingWindow): void;
  invalidate(live: DecidingWindow): Promise<void>;
}): Promise<
  | { ok: true; value: SubmitReceipt }
  | { ok: false; error: { code: string; message: string } }
> {
  const live = input.live;
  if (live === undefined || live.displayId !== input.request.displayId) {
    return {
      ok: false,
      error: { code: "forbidden", message: "이 창의 표시가 아니다" },
    };
  }
  const handle = input.table.find(input.request.displayId);
  if (handle === undefined || handle.epoch !== input.epoch) {
    live.gate = { state: "stale", reason: STALE };
    input.publish(live);
    return { ok: false, error: { code: "conflict", message: "확인이 무효다" } };
  }
  const repeated = await spent(handle, live, input.submit, input.publish);
  if (repeated !== undefined) return repeated;
  const read = await input.canon.read(live.intent);
  const checked = checkSubmission({
    handle,
    decision: input.request.decision,
    confirmedSecond: input.request.confirmedSecond,
    secondPending: live.secondPending,
    now: input.now,
    connected: input.connected,
    read,
  });
  if (!checked.ok) {
    if (checked.drop) await input.invalidate(live);
    live.gate = checked.gate;
    if (checked.clearDisplay || checked.display !== null) {
      live.display = checked.display;
    }
    input.publish(live);
    return checked;
  }
  return send(handle, live, input);
}

async function spent(
  handle: LiveHandle,
  live: DecidingWindow,
  submit: SubmitPort,
  publish: (live: DecidingWindow) => void,
): Promise<
  | { ok: true; value: SubmitReceipt }
  | { ok: false; error: { code: string; message: string } }
  | undefined
> {
  if (!handle.spent) return undefined;
  if (!handle.unknown) {
    return {
      ok: false,
      error: { code: "conflict", message: "이미 제출한 확인이다" },
    };
  }
  const found = await submit.receipt(handle);
  if (found !== undefined) return { ok: true, value: found };
  live.gate = { state: "unknown" };
  publish(live);
  return {
    ok: false,
    error: { code: "unavailable", message: "제출 결과를 아직 모른다" },
  };
}

async function send(
  handle: LiveHandle,
  live: DecidingWindow,
  input: {
    request: DecideInput;
    submit: SubmitPort;
    publish(live: DecidingWindow): void;
  },
): Promise<
  | { ok: true; value: SubmitReceipt }
  | { ok: false; error: { code: string; message: string } }
> {
  handle.spent = true;
  const sent = await input.submit.submit({
    handle,
    decision: input.request.decision,
    commandInput: input.request.commandInput ?? {},
  });
  if (!sent.ok && sent.unknown) {
    handle.unknown = true;
    live.gate = { state: "unknown" };
    input.publish(live);
    return {
      ok: false,
      error: { code: "unavailable", message: "제출 결과를 아직 모른다" },
    };
  }
  if (!sent.ok) {
    live.gate = { state: "stale", reason: sent.error.message };
    input.publish(live);
    return sent;
  }
  live.gate = { state: "submitted" };
  input.publish(live);
  return sent;
}
