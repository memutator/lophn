// 메모리로 도는 LophnBrowserApi. gallery와 dev:mock이 쓴다. 주소 정리는 흉내만 낸다.
import type {
  Bookmark,
  BrowserEvent,
  BrowserViewState,
  LophnBrowserApi,
} from "../../../ipc/browser.ts";

/** `corrupt`면 목록 파일이 깨진 것처럼 읽기는 `corrupt` 상태이고 쓰기는 거절된다. */
export function fakeBrowserApi(options: { corrupt?: boolean } = {}): {
  api: LophnBrowserApi;
  push(event: BrowserEvent): void;
  set(patch: Partial<BrowserViewState>): void;
} {
  const states = new Map<string, BrowserViewState>();
  const stateListeners = new Set<(state: BrowserViewState) => void>();
  const eventListeners = new Set<(event: BrowserEvent) => void>();
  const bookmarkListeners = new Set<() => void>();
  const bookmarks: Bookmark[] = [];
  const history = new Map<string, { urls: string[]; at: number }>();
  // 아직 열린 view가 없을 때 set한 값은 다음에 열리는 view의 바탕이 된다.
  let template: Partial<BrowserViewState> = {};
  let latest: string | null = null;
  let count = 0;

  const emit = (state: BrowserViewState) => {
    states.set(state.view_session, state);
    for (const listener of stateListeners) listener(state);
  };
  const need = (view_session: string) => {
    const state = states.get(view_session);
    if (state === undefined) throw new Error("not_found");
    return state;
  };
  // 이동 기록의 위치에 맞춰 url과 앞뒤 가능 여부를 맞춘다.
  const at = (view_session: string, index: number) => {
    const record = history.get(view_session)!;
    record.at = index;
    const state = need(view_session);
    const next = {
      ...state,
      url: record.urls[index] ?? "",
      canGoBack: index > 0,
      canGoForward: index < record.urls.length - 1,
    };
    emit(next);
    return next;
  };

  const api: LophnBrowserApi = {
    open({ url }) {
      count += 1;
      const view_session = `fake-view-${count}`;
      const state: BrowserViewState = {
        view_session,
        url,
        title: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        health: "ok",
        ...template,
      };
      history.set(view_session, { urls: [state.url], at: 0 });
      latest = view_session;
      states.set(view_session, state);
      return Promise.resolve(state);
    },
    adopt({ view_session }) {
      return Promise.resolve(need(view_session));
    },
    navigate({ view_session, input }) {
      const text = input.trim();
      if (text === "" || /\s/.test(text)) {
        return Promise.reject(new Error("invalid_input"));
      }
      const record = history.get(view_session);
      need(view_session);
      const url = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
      record!.urls = [...record!.urls.slice(0, record!.at + 1), url];
      return Promise.resolve(at(view_session, record!.urls.length - 1));
    },
    command({ view_session, command }) {
      const record = history.get(view_session);
      need(view_session);
      if (command === "back") at(view_session, Math.max(0, record!.at - 1));
      else if (command === "forward") {
        at(view_session, Math.min(record!.urls.length - 1, record!.at + 1));
      } else if (command === "reload") {
        emit({ ...need(view_session), health: "ok" });
      }
      return Promise.resolve();
    },
    clearData: () => Promise.resolve(),
    subscribeState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    bookmarks: {
      list: () =>
        Promise.resolve(
          options.corrupt
            ? { state: "corrupt" }
            : { state: "ok", bookmarks: [...bookmarks] },
        ),
      add(input) {
        if (options.corrupt) return Promise.reject(new Error("corrupt"));
        if (input.title.trim() === "") {
          return Promise.reject(new Error("title"));
        }
        if (bookmarks.some((item) => item.url === input.url)) {
          return Promise.reject(new Error("duplicate"));
        }
        const bookmark: Bookmark = {
          id: `fake-bookmark-${bookmarks.length + 1}`,
          created_at: new Date(0).toISOString(),
          ...input,
        };
        bookmarks.push(bookmark);
        for (const listener of bookmarkListeners) listener();
        return Promise.resolve(bookmark);
      },
      update(input) {
        if (options.corrupt) return Promise.reject(new Error("corrupt"));
        if (input.title?.trim() === "") {
          return Promise.reject(new Error("title"));
        }
        const index = bookmarks.findIndex((item) => item.id === input.id);
        if (index < 0) return Promise.reject(new Error("missing"));
        const { id: _id, ...patch } = input;
        bookmarks[index] = { ...bookmarks[index]!, ...patch };
        for (const listener of bookmarkListeners) listener();
        return Promise.resolve(bookmarks[index]!);
      },
      remove({ id }) {
        if (options.corrupt) return Promise.reject(new Error("corrupt"));
        const index = bookmarks.findIndex((item) => item.id === id);
        if (index >= 0) bookmarks.splice(index, 1);
        for (const listener of bookmarkListeners) listener();
        return Promise.resolve();
      },
      subscribe(listener) {
        bookmarkListeners.add(listener);
        return () => bookmarkListeners.delete(listener);
      },
    },
  };

  return {
    api,
    push(event) {
      for (const listener of eventListeners) listener(event);
    },
    set(patch) {
      template = { ...template, ...patch };
      if (latest !== null) emit({ ...need(latest), ...patch });
    },
  };
}
