// core의 browser profile 목록(`browser_profiles/list`)의 살아 있는 사본. core가 준비되면 읽고, `StateChanged`의
// `browser_profiles`가 오면 다시 읽는다. partition을 붙일 때(어느 partition이 알려진 browser profile인가)와 driver가 읽는다.
// 목록과 함께 오는 `clear`는 다른 컴퓨터에서 지워진 profile이다: browser 영역이 그 partition data를 지운다.
import {
  type BrowserProfile,
  browserProfileSchema,
} from "../../../../protocol/shell/browser-profiles.ts";

type CallResult = { ok: true; value: unknown } | { ok: false; error: unknown };

export interface BrowserProfiles {
  /** 사람이 만든 profile 목록. 아직 읽지 못했으면 undefined다. */
  list(): readonly BrowserProfile[] | undefined;
  /** partition data를 지울 profile id. 목록에 다시 선 profile(되살아남)은 들지 않는다. */
  clear(): readonly string[];
  /** 읽을 때마다 부른다. 해제는 반환 함수다. */
  watch(listener: () => void): () => void;
  refresh(): void;
}

export function createBrowserProfiles(
  read: () => Promise<CallResult>,
): BrowserProfiles {
  let profiles: readonly BrowserProfile[] | undefined;
  let clear: readonly string[] = [];
  const listeners = new Set<() => void>();
  let latest = 0;
  return {
    list: () => profiles,
    clear: () => clear,
    watch(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh() {
      const seq = ++latest;
      void read().then((listed) => {
        // 늦게 온 옛 답은 버린다. 읽지 못하면 지금 값을 둔다(다음 준비나 event가 다시 읽는다).
        if (seq !== latest || !listed.ok) return;
        const value = listed.value as { profiles: unknown[]; clear: string[] };
        profiles = value.profiles.flatMap((one) => {
          const parsed = browserProfileSchema.safeParse(one);
          return parsed.success ? [parsed.data] : [];
        });
        const live = new Set(profiles.map((one) => one.id));
        clear = value.clear.filter((id) => !live.has(id));
        for (const listener of listeners) listener();
      });
    },
  };
}
