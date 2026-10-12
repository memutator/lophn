import type {
  ChildMessage,
  Frame,
  KindLaunchSpec,
  ParentMessage,
} from "../../protocol/platform/mod.ts";
import type { FrameWriter } from "./frames.ts";
import { ADAPTER_MS, GROUP_CONFIRM_MS } from "./group.ts";
import { LEADER_EXIT_MS, type Spawned } from "./process.ts";

// architecture 2.3의 고정 값. 설정으로 늘리지 않는다.
export const READY_MS = 10_000;
export const STOP_MS = 5_000;
// child stdin에 frame 하나를 쓰는 기한. child가 읽지 않으면 이 안에 그 child를 끝내고 재기동 경로로 보낸다.
export const WRITE_MS = 20_000;
export const RESTART_DELAYS_MS = [1_000, 2_000, 4_000];
export const RESTART_LIMIT = RESTART_DELAYS_MS.length;
export const STDERR_LINE_MAX = 8 * 1024;
// group 종료 확인 전체 한도. adapter 호출(신호·마지막 확인)과 leader exit·group 확인 한도를 더한 것이다.
// 넘으면 그 kind를 unavailable로 막고 old handle을 보존해 겹쳐 띄우지 않는다.
export const TEARDOWN_MS = 2 * ADAPTER_MS + LEADER_EXIT_MS + GROUP_CONFIRM_MS;
// leader exit 뒤 이미 쓰인 stdout·stderr 꼬리를 읽어 들이는 한도. 손자가 pipe를 쥐고 있어도 끝난다.
export const DRAIN_MS = 1_000;

export type ChildCallbacks = {
  // 재기동은 진행 중이던 작업을 다시 보내지 않는다. 요청 보관은 호출자의 몫이다.
  onMessage(message: ChildMessage): void;
  // byte chunk frame은 제어 메시지가 아니다. entry가 채널로 받는다.
  onFrame?(frame: Frame): void;
  // stderr는 제어·성공 근거가 아니다. 줄을 넘길 뿐 supervisor가 원문을 보관하지 않는다.
  onStderr?(line: string): void;
  // 한 번의 기동이 끝났다(crash·정상 정지·교체·protocol 위반·쓰기 기한 초과). 그 child에게 보낸
  // 요청은 답이 오지 않으니 호출자가 바로 실패로 끝낸다. 기동마다 정확히 한 번, 그 child의 종료 확인
  // 시도가 시작될 때 부른다. 같은 kind의 새 child는 이 호출 뒤에 뜬다.
  onEnd?(): void;
  // 감독이 이 kind를 포기했다(재기동 한도·ready 초과·protocol 위반·종료 미확인). 정지·교체로 끝난
  // 것은 부르지 않는다. 호출자가 더 다시 띄울지 정한다. kind마다 포기당 한 번이다.
  onGiveUp?(reason: string): void;
};

// stopped: 종료가 확인된 정지. unavailable: 한도 초과·protocol 위반·종료 미확인.
export type Phase =
  | "starting"
  | "ready"
  | "stopping"
  | "stopped"
  | "unavailable";

// 한 번의 기동. 종료가 확인될 때까지 slot이 이것을 쥐고 있어 같은 kind의 새 child와 겹치지 않는다.
export type Attempt = {
  process: Spawned;
  generation: number;
  // 한 spawned handle에 하나. hello·stop·control·bytes 모두 이것 하나로만 쓴다(FIFO·fault 보존).
  writer: FrameWriter;
  // false가 되면 이 기동에서 나온 frame·메시지는 callback으로 넘기지 않는다.
  live: boolean;
  // teardown이 끝났다. 그 뒤에는 stderr 줄도 넘기지 않는다.
  closed: boolean;
  // group 종료 확인과 pipe 정리. 여러 번 불러도 같은 결과다. true만 종료 확인이다.
  teardown(): Promise<boolean>;
};

export type Slot = {
  spec: KindLaunchSpec;
  phase: Phase;
  // ready 전 실패와 ready 후 crash를 합쳐 센다. kind 전체 최대 3회다. ready는 이 수를 지우지 않는다.
  failures: number;
  reason?: string;
  generation: number;
  attempt?: Attempt;
  callbacks: ChildCallbacks;
  hello: ParentMessage;
  // 이번 기동이 ready가 됐는지, 실패로 끝났는지 첫 결과를 알린다.
  settle?: (ready: boolean) => void;
};

export function makeSlot(
  spec: KindLaunchSpec,
  hello: ParentMessage,
  callbacks: ChildCallbacks,
): Slot {
  return {
    spec,
    phase: "starting",
    failures: 0,
    generation: 1,
    callbacks,
    hello,
  };
}

export function settle(slot: Slot, ready: boolean) {
  slot.settle?.(ready);
  slot.settle = undefined;
}

export function isLive(slot: Slot, attempt: Attempt): boolean {
  return attempt.live && slot.generation === attempt.generation;
}

export function safeCall(fn: () => void) {
  try {
    fn();
  } catch { /* 안전 실패: callback 예외가 teardown·상태 변경을 막지 않는다 */ }
}
