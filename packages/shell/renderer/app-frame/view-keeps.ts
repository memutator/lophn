// 숨겨 둔 탭 native view(앱 view, browser view)의 보관소. 탭이 Float·Dock으로 다시 mount해도
// view(page 상태, 로그인 popup의 window.opener)를 닫지 않고 같은 session을 다시 쓰기 위한 것이다.
// 닫는 때는 이 보관소가 아니라 Workspace가 정한다(탭이 layout에서 사라질 때).
export interface KeptView<State = unknown> {
  readonly session: string;
  /** 열기 입력을 이은 글. 입력이 바뀐 view를 다시 쓰지 않게 한다. */
  readonly signature: string;
  /** 숨기기 직전의 state. 꺼내는 쪽(앱 view, browser view)이 자기 type으로 읽는다. */
  state: State;
}

export interface ViewKeeps {
  /** signature가 같은 보관 view를 꺼낸다(꺼내면 보관에서 빠진다). signature가 다르면 그 view를 닫고 undefined. */
  take<State>(key: string, signature: string): KeptView<State> | undefined;
  /** 같은 key에 이미 있으면 먼저 것을 닫는다. */
  put<State>(key: string, view: KeptView<State>): void;
  /** key의 view를 닫는다(보관 중이면). */
  release(key: string): void;
  /** 보관 중인 key 모두. */
  keys(): readonly string[];
  /** mount돼 있든 보관 중이든 key의 view. 없으면 undefined. state는 알린 쪽이 갱신한 최신 값이다. */
  lookup<State>(key: string): KeptView<State> | undefined;
  /**
   * view를 가진 쪽(EmbeddedView, BrowserTab)이 view를 얻었을 때(열었거나 take했을 때)와 state가
   * 바뀔 때 알린다. mount된 동안 lookup이 찾게 한다.
   */
  track<State>(key: string, view: KeptView<State>): void;
}

export function createViewKeeps(close: (session: string) => void): ViewKeeps {
  // mounted인 view는 쓰는 쪽이 들고 있다. 닫는 일도 그쪽이 한다.
  const views = new Map<string, { view: KeptView; mounted: boolean }>();
  return {
    take<State>(key: string, signature: string) {
      const item = views.get(key);
      if (item === undefined || item.mounted) return undefined;
      if (item.view.signature !== signature) {
        views.delete(key);
        close(item.view.session);
        return undefined;
      }
      item.mounted = true;
      return item.view as KeptView<State>;
    },
    put(key, view) {
      const previous = views.get(key);
      if (previous !== undefined && previous.view.session !== view.session) {
        close(previous.view.session);
      }
      views.set(key, { view, mounted: false });
    },
    release(key) {
      const item = views.get(key);
      if (item === undefined || item.mounted) return;
      views.delete(key);
      close(item.view.session);
    },
    keys: () =>
      [...views].filter(([, item]) => !item.mounted).map(([key]) => key),
    lookup: <State>(key: string) =>
      views.get(key)?.view as KeptView<State> | undefined,
    track(key, view) {
      views.set(key, { view, mounted: true });
    },
  };
}
