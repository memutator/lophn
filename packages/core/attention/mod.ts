// 주의(attention): host가 보고한 presence와 Bus event로 `unseen`을 들고, 사람을 기다리는 일이 생기면 기기마다 push가 필요한지 정한다.
// 기기 목록과 push 보내기는 port이고 `bindPush`를 부르기 전에는 아무것도 보내지 않는다.
import type { Clock } from "../../base/mod.ts";
import type { BusEvent } from "../../protocol/events/mod.ts";
import { decide } from "./decide.ts";
import type { PushPorts, SessionLookup } from "./ports.ts";
import { createPresence } from "./presence.ts";
import {
  causeOf,
  type Cause,
  signalCause,
  type TerminalSignal,
  terminalSession,
  turnEndKind,
} from "./triggers.ts";
import { createUnseen } from "./unseen.ts";

export type { Attention, PushPorts, SessionLookup } from "./ports.ts";
export type { PushDevice, PushMessage, PushPrefs } from "./ports.ts";

export function createAttention(deps: {
  clock: Clock;
  lookup: SessionLookup;
  // 기기 principal의 kind. 보고를 받을 때 부른다(사람과 모르는 principal은 null).
  deviceKind(principal: string): "phone" | "desktop" | null;
  // `unseen`이 서거나 꺼졌다.
  unseenChanged(session: string): void;
}) {
  const presence = createPresence(deps.clock, deps.deviceKind);
  const unseen = createUnseen({
    clock: deps.clock,
    presence: presence.table,
    changed: deps.unseenChanged,
  });
  let push: PushPorts | undefined;
  // 읽기가 끝나는 순서가 event 순서를 뒤집지 않게 한 줄로 처리한다(TurnEnded 뒤 TurnStarted).
  let queue: Promise<void> = Promise.resolve();

  function notify(cause: Cause): void {
    if (push === undefined) return;
    const messages = decide({
      cause,
      devices: push.devices(),
      presence: presence.table,
      now: deps.clock.nowMs(),
      host: push.host(),
    });
    for (const message of messages) void push.send(message).catch(() => {});
  }

  async function handle(event: BusEvent): Promise<void> {
    if (event.type === "TurnStarted" || event.type === "SessionEnded") {
      unseen.clear(event.session);
      return;
    }
    // 제목·agent 이름·app이 연 session인지는 이 셋만 읽는다. 모르는 session의 계기는 버린다.
    let info: Awaited<ReturnType<SessionLookup>> = null;
    if (
      event.type === "TurnRequestOpened" ||
      event.type === "QuestionAsked" ||
      event.type === "TurnEnded"
    ) {
      info = await deps.lookup(event.session);
      if (info === null) return;
    }
    if (event.type === "TurnEnded" && info !== null && !info.opened_by_app) {
      const kind = turnEndKind(event.payload.outcome);
      if (kind !== null) unseen.ended(event.session, kind);
    }
    const cause = causeOf(event, info);
    if (cause !== null) notify(cause);
  }

  return {
    bindPush(ports: PushPorts): void {
      push = ports;
    },
    forgetReporter: presence.forget,
    event(event: BusEvent): Promise<void> {
      queue = queue.then(() => handle(event)).catch(() => {});
      return queue;
    },
    report(
      reporter: string,
      report: { focused: boolean; idle_ms?: number; looking: string[] },
    ): void {
      presence.report(reporter, report);
      // 앞에 있는 host가 새로 보는 session은 못 본 것이 아니다.
      if (presence.present(reporter)) unseen.seen(report.looking);
    },
    signal(signal: TerminalSignal): void {
      const session = terminalSession(signal);
      if (signal.kind === "waiting") {
        unseen.clear(session);
      } else {
        unseen.ended(session, signal.kind);
      }
      const cause = signalCause(signal);
      if (cause !== null) notify(cause);
    },
    unseenList: unseen.list,
    dismiss: unseen.clear,
  };
}

export type AttentionCore = ReturnType<typeof createAttention>;
