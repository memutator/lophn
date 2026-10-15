// Appearance 화면의 가짜 통로. core를 부르지 않고 고른 것을 메모리에 둔다.
import { APPEARANCE_DEFAULTS } from "../model.ts";
import type { AppearanceSource, AppearanceValues } from "../source.ts";

export interface FakeAppearanceOptions {
  values?: Partial<AppearanceValues>;
  /** 고르기가 거절되는 code. 없으면 저장된다. */
  chooseCode?: string;
  readFails?: boolean;
}

export function fakeAppearance(options: FakeAppearanceOptions = {}) {
  const calls: unknown[][] = [];
  let values: AppearanceValues = { ...APPEARANCE_DEFAULTS, ...options.values };
  const source: AppearanceSource = {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    values() {
      calls.push(["values"]);
      return Promise.resolve(
        options.readFails
          ? { ok: false, code: "unavailable" }
          : { ok: true, value: values },
      );
    },
    choose(id, value) {
      calls.push(["choose", id, value]);
      if (options.chooseCode) {
        return Promise.resolve({ ok: false, code: options.chooseCode });
      }
      values = { ...values, [id]: value };
      return Promise.resolve({ ok: true, value: null });
    },
  };
  return { source, calls };
}
