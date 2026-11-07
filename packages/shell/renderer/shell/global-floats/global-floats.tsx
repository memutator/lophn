// 전역 float(workspace를 넘는 앱 panel 화면) 목록과 그 조작. Desktop 창에 하나이고, workspace 창(WorkspaceWindow)은
// 이 목록을 읽어 tab 줄에 chip을 그리고 desk float과 서로 옮긴다. <webview> 그릇과 view 보관소를 여기서 들고 있어서
// workspace 창이 다시 mount돼도 전역 float의 page는 남는다.

import { t } from "@lophn/i18n";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useAppViews } from "../../app-frame/app-views.tsx";
import { useOptionalEventClient } from "../../desktop/connection/events/hooks.tsx";
import { createViewKeeps, type ViewKeeps } from "../../app-frame/view-keeps.ts";
import {
  createWebviewHost,
  type WebviewHost,
} from "../../app-frame/webview-host.tsx";
import {
  closeFloat,
  type FloatRect,
  minimizeFloat,
  minimizeLooseFloats,
  openFloatTab,
  pinFloat,
  restoreFloat,
  setFloatRect,
} from "../desk-model.ts";
import {
  createGlobalFloatsStore,
  type GlobalFloatsBridge,
  globalBridge,
  globalKey,
} from "./store.ts";

export interface GlobalFloatView {
  /** chip과 패널이 쓰는 key. `global:<app>:<screen>`이다. */
  readonly key: string;
  readonly app: string;
  readonly screen: string;
  /** 앱 이름. 읽기 전에는 일반 이름이다. */
  readonly title: string;
  readonly rect: FloatRect;
  readonly minimized: boolean;
  readonly pinned: boolean;
}

/** workspace 창이 전역 float을 받아 자기 desk의 float으로 만든다. 못 만들면 false다. */
export type DeskMover = (float: GlobalFloatView) => boolean;

export interface GlobalFloatsApi {
  /** false면 전역 float을 쓰지 않는다(Provider 없음, detached 창, 앱 전용 창). */
  readonly enabled: boolean;
  /** 아래에서 위 순서. 마지막이 맨 위다. */
  readonly floats: readonly GlobalFloatView[];
  find(app: string, screen: string): GlobalFloatView | undefined;
  /** 앱 panel 화면을 전역 float로 만든다. 같은 화면이 이미 있으면 바꿔 맨 위에 둔다. 못 만들면(상한) false다. */
  add(float: {
    app: string;
    screen: string;
    rect: FloatRect;
    minimized: boolean;
    pinned: boolean;
    title?: string;
  }): boolean;
  /** 펼쳐 맨 위로 올린다. */
  expand(key: string): void;
  minimize(key: string): void;
  /** 펼쳐 있으면 접고 접혀 있으면 펼친다. chip이 누른다. */
  toggle(key: string): void;
  pin(key: string, pinned: boolean): void;
  setRect(key: string, rect: FloatRect): void;
  close(key: string): void;
  /** 고정 안 한 펼친 것을 모두 접는다(`inside`는 남긴다). 바깥을 눌렀을 때다. */
  minimizeLoose(inside?: string): void;
  /** workspace 창이 자기 desk로 받는 길을 등록한다. 돌려주는 함수로 푼다. */
  registerDesk(mover: DeskMover): () => void;
  /** 받는 workspace 창이 있어 "이 desk로"가 가능하다. */
  readonly canMoveToDesk: boolean;
  moveToDesk(key: string): void;
}

/** 층(`global-float-layer.tsx`)이 쓰는 그릇과 view 보관소. */
export interface GlobalFloatsHost {
  readonly webviews: WebviewHost;
  readonly keeps: ViewKeeps;
}

const NONE: GlobalFloatsApi = {
  enabled: false,
  floats: [],
  find: () => undefined,
  add: () => false,
  expand: () => {},
  minimize: () => {},
  toggle: () => {},
  pin: () => {},
  setRect: () => {},
  close: () => {},
  minimizeLoose: () => {},
  registerDesk: () => () => {},
  canMoveToDesk: false,
  moveToDesk: () => {},
};

const Context = createContext<GlobalFloatsApi>(NONE);
const HostContext = createContext<GlobalFloatsHost | null>(null);

/** Provider가 없으면 전역 float이 없는 것처럼 동작한다(`enabled`가 false). */
export function useGlobalFloats(): GlobalFloatsApi {
  return useContext(Context);
}

export function useGlobalFloatsHost(): GlobalFloatsHost | null {
  return useContext(HostContext);
}

export function GlobalFloatsProvider({
  enabled = true,
  bridge = globalBridge,
  children,
}: {
  /** false면 읽지도 쓰지도 않는다(detached 창, 앱 전용 창). */
  enabled?: boolean;
  bridge?: () => GlobalFloatsBridge | undefined;
  children: ReactNode;
}) {
  const appViews = useAppViews();
  const [store] = useState(() => createGlobalFloatsStore(bridge));
  const state = useSyncExternalStore(store.subscribe, store.get);
  const moverRef = useRef<DeskMover | null>(null);
  const [canMove, setCanMove] = useState(false);
  const registerDesk = useCallback((run: DeskMover) => {
    moverRef.current = run;
    setCanMove(true);
    return () => {
      if (moverRef.current !== run) return;
      moverRef.current = null;
      setCanMove(false);
    };
  }, []);
  const webviews = useMemo(createWebviewHost, []);
  const closeViewRef = useRef<(session: string) => void>(() => {});
  closeViewRef.current = (session) =>
    void appViews?.views.closeView({ view_session: session }).catch(() => {});
  const keeps = useMemo(
    () => createViewKeeps((session) => closeViewRef.current(session)),
    [],
  );

  // 창이 뜰 때 읽고, 다른 창이 바꾼 값은 창 focus 때 다시 읽는다.
  useEffect(() => {
    if (!enabled) return;
    void store.load();
    const reload = () => void store.load();
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("focus", reload);
      store.flush();
    };
  }, [enabled, store]);

  // 앱이 영구히 지워지면 그 앱의 전역 float을 닫는다(없는 앱의 화면은 열려 있어도 쓸모가 없다).
  const events = useOptionalEventClient();
  useEffect(() => {
    if (!enabled || events === null) return;
    return events.subscribe({ types: ["AppRemoved"] }, (message) => {
      if (message.kind !== "event" || message.event.type !== "AppRemoved")
        return;
      const removed = message.event.subject;
      store.commit((desk) =>
        desk.floats
          .filter((item) => item.tab.app === removed)
          .reduce((next, item) => closeFloat(next, item.tab.key), desk),
      );
    });
  }, [enabled, events, store]);

  // 앱 이름은 저장하지 않고 앱 목록에서 한 번 읽는다.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const item of state.desk.floats) {
      const app = item.tab.app;
      if (app === undefined || asked.current.has(app)) continue;
      asked.current.add(app);
      void appViews?.app(app).then((read) => {
        if (read.ok) store.setName(app, read.value.name);
      });
    }
  }, [state.desk, appViews, store]);

  // 목록에서 사라진 float의 view를 닫는다. 자식의 cleanup이 view를 보관소에 넣은 뒤에 도는 effect다.
  const liveKeys = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set(state.desk.floats.map((item) => item.tab.key));
    for (const key of keeps.keys()) if (!live.has(key)) keeps.release(key);
    for (const key of webviews.keys()) {
      if (liveKeys.current.has(key) && !live.has(key)) webviews.release(key);
    }
    liveKeys.current = live;
  }, [state.desk, keeps, webviews]);
  useEffect(
    () => () => {
      queueMicrotask(() => {
        for (const key of keeps.keys()) keeps.release(key);
      });
    },
    [keeps],
  );

  const api = useMemo<GlobalFloatsApi>(() => {
    const floats = state.desk.floats.flatMap((item): GlobalFloatView[] =>
      item.tab.app === undefined || item.tab.screen === undefined
        ? []
        : [
            {
              key: item.tab.key,
              app: item.tab.app,
              screen: item.tab.screen,
              title:
                state.names[item.tab.app] ??
                t("project-workspace.label.kind-app-panel"),
              rect: item.rect,
              minimized: item.minimized,
              pinned: item.pinned,
            },
          ],
    );
    const act = (change: Parameters<typeof store.commit>[0]) => {
      store.commit(change);
    };
    return {
      enabled: true,
      floats,
      find: (app, screen) =>
        floats.find((item) => item.app === app && item.screen === screen),
      add(input) {
        const key = globalKey(input.app, input.screen);
        if (input.title !== undefined) store.setName(input.app, input.title);
        const next = store.commit((desk) => {
          let moved = openFloatTab(
            closeFloat(desk, key),
            {
              key,
              kind: "app_panel",
              title: "",
              app: input.app,
              screen: input.screen,
            },
            input.rect,
          );
          if (input.pinned) moved = pinFloat(moved, key, true);
          return input.minimized ? minimizeFloat(moved, key) : moved;
        });
        return next.floats.some((item) => item.tab.key === key);
      },
      expand: (key) => act((desk) => restoreFloat(desk, key)),
      minimize: (key) => act((desk) => minimizeFloat(desk, key)),
      toggle: (key) =>
        act((desk) =>
          desk.floats.some((item) => item.tab.key === key && !item.minimized)
            ? minimizeFloat(desk, key)
            : restoreFloat(desk, key),
        ),
      pin: (key, pinned) => act((desk) => pinFloat(desk, key, pinned)),
      setRect: (key, rect) => act((desk) => setFloatRect(desk, key, rect)),
      close: (key) => act((desk) => closeFloat(desk, key)),
      minimizeLoose: (inside) =>
        act((desk) => minimizeLooseFloats(desk, inside)),
      registerDesk,
      canMoveToDesk: canMove,
      moveToDesk(key) {
        const float = floats.find((item) => item.key === key);
        if (float !== undefined && moverRef.current?.(float)) {
          act((desk) => closeFloat(desk, key));
        }
      },
    };
  }, [state, store, canMove, registerDesk]);

  const host = useMemo(() => ({ webviews, keeps }), [webviews, keeps]);
  return (
    <Context.Provider value={enabled ? api : NONE}>
      <HostContext.Provider value={enabled ? host : null}>
        {children}
      </HostContext.Provider>
    </Context.Provider>
  );
}
