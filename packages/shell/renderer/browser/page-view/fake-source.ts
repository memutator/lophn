// gallery가 쓰는 PageViewSource. 준 목록과 snapshot을 그대로 답하고 쓰기는 받기만 한다(상태를 바꾸지 않는다).
import type { PageRow, PageSnapshot, PageViewSource } from "./source.ts";

const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });

export function fakePageViewSource(options: {
  readonly pages: readonly PageRow[];
  /** 탭 id마다의 snapshot. 없는 탭은 not_found다. */
  readonly snapshots: Readonly<Record<string, PageSnapshot>>;
}): PageViewSource {
  return {
    list: () => ok(options.pages),
    snapshot: (tab) => {
      const found = options.snapshots[tab];
      return found === undefined
        ? Promise.resolve({ ok: false, code: "not_found" })
        : ok(found);
    },
    watch: () => ok(null),
    input: () => ok(null),
    control: () => ok(null),
    open: () => ok(options.pages[0]?.tab ?? "tab_fake"),
  };
}
