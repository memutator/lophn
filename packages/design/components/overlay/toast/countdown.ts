import { useEffect, useRef } from "react";
import type { Clock, Timer } from "../../_shared/shared.ts";

interface Running {
  // 만든 timer·clock으로만 지우고 잰다. 바뀐 adapter로 옛 handle을 지우지 않는다.
  timer: Timer;
  clock: Clock;
  startedAt: number;
  value: unknown;
}

export interface CountdownOptions {
  // 끝날 때까지의 전체 시간. undefined면 시간으로 끝나지 않는다(error).
  total: number | undefined;
  timer: Timer;
  clock: Clock;
  onDone: () => void;
}

// hover·focus는 각각 멈추고 둘 다 풀려야 남은 시간만 이어 간다. 전체 시간·adapter가 바뀌어도
// 이미 지난 시간은 그대로 둔다. 지운 handle의 늦은 callback은 무시한다.
export function useCountdown({
  total,
  timer,
  clock,
  onDone,
}: CountdownOptions) {
  const done = useRef(onDone);
  done.current = onDone;
  const state = useRef({
    elapsed: 0,
    total,
    timer,
    clock,
    running: undefined as Running | undefined,
    hovered: false,
    focused: false,
  });
  const pause = () => {
    const now = state.current;
    const running = now.running;
    if (!running) return;
    now.running = undefined;
    running.timer.clear(running.value);
    now.elapsed += Math.max(0, running.clock.now() - running.startedAt);
  };
  const resume = () => {
    const now = state.current;
    if (now.total === undefined || now.running || now.hovered || now.focused)
      return;
    const running: Running = {
      timer: now.timer,
      clock: now.clock,
      startedAt: now.clock.now(),
      value: undefined,
    };
    now.running = running;
    running.value = running.timer.set(
      () => {
        if (state.current.running !== running) return;
        state.current.running = undefined;
        done.current();
      },
      Math.max(0, now.total - now.elapsed),
    );
  };
  useEffect(() => {
    pause();
    Object.assign(state.current, { total, timer, clock });
    resume();
  }, [total, timer, clock]);
  useEffect(() => pause, []);
  return {
    hover(on: boolean) {
      state.current.hovered = on;
      if (on) pause();
      else resume();
    },
    focus(on: boolean) {
      state.current.focused = on;
      if (on) pause();
      else resume();
    },
  };
}
