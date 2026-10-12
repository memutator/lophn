// coding TUI의 첫 prompt 전달.
// argv 방식은 harness가 스스로 submit하므로 PTY에 입력을 쓰지 않는다. stdin_after_ready는 plan의
// readiness 신호를 spawn부터 deadline_ms 안에 보면 정확히 한 번만 쓴다. 쓰기를 시도한 뒤에는 결과를
// 확인하지 못하므로 재전송·재spawn·resume이 없다. 이 module은 contracts를 import하지 않는다.

import type { PromptDeliveryInput } from "./coding-types.ts";
import type { PromptOutcome } from "../ipc/terminal.ts";

/** ms 뒤에 fire를 한 번 부른다. 돌려준 함수가 취소다. 테스트가 끼운다. */
export type PromptTimer = (ms: number, fire: () => void) => () => void;

export type PromptDeliveryRun = {
  outcome(): PromptOutcome;
  /** PTY spawn 직후. 기한은 여기서부터 센다. */
  start(): void;
  /** PTY 출력 chunk. readiness를 찾는 데만 쓰고 꼬리만 잠깐 둔다. */
  output(chunk: string): void;
  /** process가 끝났다. 준비 전이면 전달하지 못한 것이다. */
  exited(): void;
};

// readiness를 찾기 전에 CSI·OSC·2글자 제어열을 지운다.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI = new RegExp(
  `${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-Z\\\\-_]`,
  "g",
);

// 붙여 넣기 구간으로 한 번에 쓰면 prompt 안의 줄바꿈이 제출이 되지 않는다. 제출은 마지막 CR 하나다.
const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";

export function createPromptDelivery(options: {
  delivery: PromptDeliveryInput;
  prompt: string;
  write(text: string): void;
  timer: PromptTimer;
  onChange?(outcome: PromptOutcome): void;
}): PromptDeliveryRun {
  const { delivery } = options;
  let state: PromptOutcome = delivery.mode === "argv" ? "none" : "pending";
  let cancel: (() => void) | undefined;
  let tail = "";

  function settle(next: PromptOutcome): void {
    if (state !== "pending") return;
    state = next;
    cancel?.();
    cancel = undefined;
    options.onChange?.(state);
  }

  function deliver(): void {
    if (state !== "pending") return;
    let wrote = false;
    try {
      options.write(`${PASTE_START}${options.prompt}${PASTE_END}\r`);
      wrote = true;
    } catch {
      // 쓰기가 실패했는지 일부만 갔는지 모른다.
    }
    // 쓰기를 한 번 시도한 뒤에는 어떤 경로도 다시 쓰지 않는다.
    settle(wrote ? "delivered" : "unknown");
  }

  return {
    outcome: () => state,
    start() {
      if (delivery.mode !== "stdin_after_ready" || state !== "pending") return;
      cancel = options.timer(delivery.deadline_ms, () => {
        settle("not_delivered");
      });
    },
    output(chunk) {
      if (delivery.mode !== "stdin_after_ready" || state !== "pending") return;
      const signal = delivery.readiness;
      tail = (tail + chunk.replace(ANSI, "")).slice(
        -Math.max(4096, signal.length * 2),
      );
      if (tail.includes(signal)) {
        tail = "";
        deliver();
      }
    },
    exited() {
      settle("not_delivered");
    },
  };
}
