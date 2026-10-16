// 창 닫기 guard. 창 닫기는 OS가 하는 일이라 main이 먼저 막고 그 창의 renderer에
// 묻는다. renderer는 마지막 고침을 보내 편집을 끝내고, 쓰기 실패·불명·충돌이 남으면 사람에게
// overlay dialog로 묻는다. legacy close-guard의 규칙을 따른다:
// - renderer가 답하지 않으면(멈춤·다시 불러옴) 기한 뒤 닫는다. 창이 영원히 닫히지 않게 하지 않는다.
// - renderer가 사람에게 묻는 중이라고 답하면 기한을 멈춘다. 사람이 고르는 동안 닫지 않는다.
// - 질문이 나가 있는 동안 온 닫기는 다시 묻지 않고 삼킨다(중복 질문 억제).
// 각 창 renderer가 알린 저장 중 수는 끄기 확인(desktop quit의 pendingSaves)이 함께 읽는다.
import type { CloseAnswer, FileCounts } from "../../ipc/files.ts";

/** 답이 오기 전에 기다리는 한도(ms). */
export const CLOSE_GUARD_TIMEOUT_MS = 15_000;

export interface GuardTimer {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimer: GuardTimer = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface CloseGuardOptions {
  /** 그 창의 renderer에 묻는다. request는 이 질문의 번호다. */
  send(request: number): void;
  log?: (message: string) => void;
  timer?: GuardTimer;
  timeoutMs?: number;
}

/** 창 하나의 guard. */
export class CloseGuard {
  #counts: FileCounts = { unsettled: 0, open: 0 };
  #request = 0;
  #resolve: ((allow: boolean) => void) | null = null;
  #timer: unknown = null;
  readonly #options: CloseGuardOptions;

  constructor(options: CloseGuardOptions) {
    this.#options = options;
  }

  /** renderer가 알린 이 창의 편집 수. */
  setCounts(counts: FileCounts): void {
    this.#counts = counts;
  }

  get counts(): FileCounts {
    return this.#counts;
  }

  /** 질문이 나가 있다. 이때 온 닫기는 삼킨다. */
  get busy(): boolean {
    return this.#resolve !== null;
  }

  /**
   * 물을 것이 없으면 null(닫기를 그대로 통과시킨다). 이미 묻는 중이어도 null이고 호출자는
   * busy로 구별해 닫기를 삼킨다. promise는 renderer 답이나 기한으로 한 번만 풀린다.
   */
  ask(): Promise<boolean> | null {
    if (this.busy) return null;
    if (this.#counts.unsettled === 0 && this.#counts.open === 0) return null;
    this.#request += 1;
    const request = this.#request;
    const done = new Promise<boolean>((resolve) => {
      this.#resolve = resolve;
    });
    this.#arm();
    this.#options.send(request);
    return done;
  }

  /** renderer의 답. 지금 질문의 번호만 받는다. 기한 뒤 늦은 답은 버린다. */
  answer(request: number, answer: CloseAnswer): void {
    if (request !== this.#request || !this.busy) return;
    if (answer === "asking") {
      this.#disarm();
      return;
    }
    this.#settle(answer === "allow");
  }

  /** 창이 사라졌다. 기다리던 질문은 닫지 않음으로 끝난다. */
  dispose(): void {
    this.#counts = { unsettled: 0, open: 0 };
    this.#settle(false);
  }

  #arm(): void {
    const timer = this.#options.timer ?? realTimer;
    this.#timer = timer.set(() => {
      this.#timer = null;
      (this.#options.log ?? defaultLog)(
        "close guard: renderer가 답하지 않아 창을 닫는다",
      );
      this.#settle(true);
    }, this.#options.timeoutMs ?? CLOSE_GUARD_TIMEOUT_MS);
  }

  #disarm(): void {
    if (this.#timer === null) return;
    (this.#options.timer ?? realTimer).clear(this.#timer);
    this.#timer = null;
  }

  #settle(allow: boolean): void {
    const resolve = this.#resolve;
    if (!resolve) return;
    this.#resolve = null;
    this.#disarm();
    resolve(allow);
  }
}

/** 창마다의 guard. 끄기 확인은 모든 창의 저장 중 수를 더해 읽는다. */
export class CloseGuards {
  readonly #guards = new Map<number, CloseGuard>();

  add(id: number, guard: CloseGuard): void {
    this.#guards.set(id, guard);
  }

  get(id: number): CloseGuard | undefined {
    return this.#guards.get(id);
  }

  remove(id: number): void {
    this.#guards.get(id)?.dispose();
    this.#guards.delete(id);
  }

  /** 디스크·결과 확인이 끝나지 않은 파일 저장 수(desktop QuitWork.pendingSaves). */
  pendingSaves(): number {
    let total = 0;
    for (const guard of this.#guards.values()) total += guard.counts.unsettled;
    return total;
  }
}

export interface ClosableWindow {
  onClose(listener: (event: { preventDefault(): void }) => void): void;
  close(): void;
  isDestroyed(): boolean;
}

/** 앱 끄기와 창 닫기 guard의 연결. */
export interface QuitLink {
  /** tray Quit처럼 사람이 이미 확인한 끄기다. 묻지 않고 닫는다. */
  quitting(): boolean;
  /** 앱 끄기(OS 끄기·app.quit)가 이 닫기를 불렀다. guard가 막으면 끄기는 멈춘다. */
  quitRequested(): boolean;
  /** renderer가 허락하면 멈춘 앱 끄기를 다시 잇는다. */
  resumeQuit(): void;
  /** 사람이 남기를 골라 앱 끄기가 멈췄다. */
  quitCancelled(): void;
}

/**
 * 창의 close event에 guard를 건다. 물을 것이 없거나 끄는 중이면 그대로 닫는다. 물으면 닫기를
 * 막고, renderer가 허락하면 한 번만 다시 닫는다. 앱 끄기가 부른 닫기면 창 대신 끄기를 다시 잇는다.
 */
export function guardWindowClose(
  window: ClosableWindow,
  guard: CloseGuard,
  quit: QuitLink,
): void {
  let allowed = false;
  window.onClose((event) => {
    if (allowed || quit.quitting()) return;
    const asked = guard.ask();
    if (asked === null) {
      if (guard.busy) event.preventDefault();
      return;
    }
    event.preventDefault();
    const quitting = quit.quitRequested();
    void asked.then((allow) => {
      if (window.isDestroyed()) return;
      if (!allow) {
        if (quitting) quit.quitCancelled();
        return;
      }
      allowed = true;
      if (quitting) quit.resumeQuit();
      else window.close();
    });
  });
}

function defaultLog(message: string): void {
  console.log(`[lophn] ${message}`);
}
