// Browser 항목의 가짜 통로. shell을 부르지 않고 부른 일을 calls에 둔다.
import type { BrowserSettingsSource } from "../source.ts";

interface FakeBrowserSettingsOptions {
  /** 지우기가 거절되는 code. 없으면 지워진다. */
  clearCode?: string;
}

export function fakeBrowserSettings(options: FakeBrowserSettingsOptions = {}) {
  const calls: unknown[][] = [];
  const source: BrowserSettingsSource = {
    clearData() {
      calls.push(["clearData"]);
      return Promise.resolve(
        options.clearCode
          ? { ok: false, code: options.clearCode }
          : { ok: true, value: null },
      );
    },
  };
  return { source, calls };
}
