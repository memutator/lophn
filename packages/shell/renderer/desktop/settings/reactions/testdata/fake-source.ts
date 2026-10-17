// Reactions 화면의 가짜 통로. core를 부르지 않고 고른 것을 메모리에 둔다.
import { DEFAULT_MODES } from "../model.ts";
import type { ReactionModes, ReactionsSource } from "../source.ts";

interface FakeReactionsOptions {
  modes?: Partial<ReactionModes>;
  /** 고르기가 거절되는 code. 없으면 저장된다. */
  chooseCode?: string;
  readFails?: boolean;
}

/** 화면 확인용 대표 값: 다시 열림은 묻고 context 위반은 끈다. */
export const SAMPLE_MODES: Partial<ReactionModes> = {
  ProblemReopened: "ask",
  ContextViolationFound: "off",
};

export function fakeReactions(options: FakeReactionsOptions = {}) {
  const calls: unknown[][] = [];
  let modes: ReactionModes = { ...DEFAULT_MODES, ...options.modes };
  const source: ReactionsSource = {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    modes() {
      calls.push(["modes"]);
      return Promise.resolve(
        options.readFails
          ? { ok: false, code: "unavailable" }
          : { ok: true, value: modes },
      );
    },
    choose(event, mode) {
      calls.push(["choose", event, mode]);
      if (options.chooseCode) {
        return Promise.resolve({ ok: false, code: options.chooseCode });
      }
      modes = { ...modes, [event]: mode };
      return Promise.resolve({ ok: true, value: null });
    },
  };
  return { source, calls };
}
