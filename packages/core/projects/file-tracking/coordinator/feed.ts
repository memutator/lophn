// core 안의 documents 구독자(machine:documents-feed). documents event를 받으면 root 집합과 관측
// 근거를 snapshot read로 다시 맞춘다. 2초·1초 주기 읽기를 대신한다.
// event는 깨우는 신호이고 payload로 상태를 만들지 않는다. 구독이 (다시) 열릴 때도 맞춰서,
// 구독이 닫혀 있던 동안의 변화를 놓치지 않는다.
import { DOCUMENTS_FEED_CONTEXT, isDocumentsFeedEvent } from "./events.ts";
import type { BasisSync } from "./basis.ts";
import type { SearchSync } from "../../outline-and-search/search-sync.ts";
import type { RootsWatch } from "./roots.ts";
import {
  type InternalSubscription,
  openInternalSubscription,
} from "../../../events/internal-subscription.ts";
import type { CoreRuntime } from "../../../main/daemon/runtime.ts";

export type DocumentsFeedDeps = {
  runtime: Pick<CoreRuntime, "events" | "track">;
  // 아직 없으면(documents worker를 띄우지 않은 core) 맞출 것이 없다.
  roots(): RootsWatch | undefined;
  basis(): BasisSync | undefined;
  // derived index를 따라잡게 하는 확인. 없으면(documents worker가 없는 core) 맞출 것이 없다.
  search?(): SearchSync | undefined;
  // 한 묶음의 event가 몰릴 때 한 번만 맞추는 대기.
  debounceMs?: number;
  retryMs?: number;
};

export function startDocumentsFeed(
  deps: DocumentsFeedDeps,
): InternalSubscription {
  const debounceMs = deps.debounceMs ?? 100;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  // root가 바뀌면 worker가 새 권한으로 다시 뜨고 그 뒤에 근거를 보낸다. 순서대로 한다.
  async function resync(): Promise<void> {
    if (stopped) return;
    await deps.roots()?.check();
    await deps.basis()?.check();
  }
  // index는 root·근거와 따로, 자기 자리(cursor)부터 따라잡는다. 서로를 기다리지 않는다.
  function catchUpSearch(): void {
    if (stopped) return;
    void deps.search?.()?.check();
  }
  const subscription = openInternalSubscription({
    context: DOCUMENTS_FEED_CONTEXT,
    backend: deps.runtime.events,
    track: (session) => deps.runtime.track(session),
    retryMs: deps.retryMs,
    onSubscribed: async () => {
      catchUpSearch();
      await resync();
    },
    onEvents(events) {
      // consumer는 쓰지 않는 event도 scanned_through_seq까지 cursor를 전진시킨다. 소비 대상
      // event만 깨우면 ledger 끝의 비소비 event 뒤 cursor가 basis보다 한 칸 뒤에 머문다.
      clearTimeout(searchTimer);
      searchTimer = setTimeout(catchUpSearch, debounceMs);
      if (!events.some((event) => isDocumentsFeedEvent(event.type))) return;
      clearTimeout(timer);
      timer = setTimeout(() => void resync(), debounceMs);
    },
  });
  return {
    listen: subscription.listen,
    get open() {
      return subscription.open;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(searchTimer);
      subscription.stop();
    },
  };
}
