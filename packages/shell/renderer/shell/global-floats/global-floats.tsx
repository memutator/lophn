// 전역 float(workspace를 넘는 떠 있는 탭) 목록과 그 조작. Desktop 창에 하나이고, workspace 창(WorkspaceWindow)은
// 이 목록을 읽어 tab 줄에 chip을 그리고 desk float과 서로 옮긴다. <webview> 그릇과 view 보관소를 여기서 들고 있어서
// workspace 창이 다시 mount돼도 전역 float의 page는 남는다. 탭은 나온 workspace를 지니고 그 workspace의 통로로 그려진다.

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

import type { TabTransfer } from "../../../ipc/detached.ts";
import { useAppViews } from "../../app-frame/app-views.tsx";
import { useOptionalEventClient } from "../../desktop/connection/events/hooks.tsx";
import { createViewKeeps, type ViewKeeps } from "../../app-frame/view-keeps.ts";
import {
  createWebviewHost,
  type WebviewHost,
} from "../../app-frame/webview-host.tsx";
import type { TabHost } from "../../workspace/kinds/host.ts";
import { tabKindOf } from "../../workspace/kinds/registry.ts";
import type { TabItem } from "../../workspace/model.ts";
import {
  closeFloat,
  type Desk,
  emptyDesk,
  type FloatRect,
  minimizeFloat,
  minimizeLooseFloats,
  openFloatTab,
  pinFloat,
  restoreFloat,
  setFloatRect,
  type WorkspaceRef,
  workspaceKey,
} from "../desk-model.ts";
import { tabToStored } from "../layout-source.ts";
import {
  createGlobalFloatsStore,
  type GlobalFloatsBridge,
  globalBridge,
  globalKey,
} from "./store.ts";

export interface GlobalFloatView {
  /** chip과 패널이 쓰는 key. 앱 panel은 `global:<app>:<screen>`이고 다른 kind는 탭 key 그대로다. */
  readonly key: string;
  readonly tab: TabItem;
  /** 탭이 나온 workspace. 본문은 이 workspace의 통로로 그린다. */
  readonly workspace: WorkspaceRef;
  /** 앱 panel은 앱 이름(읽기 전에는 일반 이름), 다른 kind는 탭 이름이다. */
  readonly title: string;
  readonly rect: FloatRect;
  readonly minimized: boolean;
  readonly pinned: boolean;
}

/** 전역 float을 받는 workspace 창. `take`는 float을 자기 desk의 float으로 만든다. 못 만들면 false다. */
export interface DeskTarget {
  readonly workspace: WorkspaceRef;
  take(float: GlobalFloatView, transfer: TabTransfer): boolean;
}

/**
 * 전역 float으로 올릴 수 있는 탭인지. kind가 Detach를 막거나(`noDetach`) 이 탭만 막거나(`noGlobal`), layout 파일로
 * 저장하지 못하는 탭(앱을 아직 고르지 않은 앱 panel)이면 아니다. 저장하지 않는 kind(Agent 탭)는 이 창 메모리의 전역 float으로
 * 살고 파일에는 쓰지 않으므로 저장 검사를 건너뛴다.
 */
export function canGoGlobal(tab: TabItem): boolean {
  const def = tabKindOf(tab.kind);
  return (
    def !== undefined &&
    def.noDetach !== true &&
    def.noGlobal?.(tab) !== true &&
    tab.transient !== true &&
    // 층은 본문을 이 창의 범위에서 그린다. 다른 기계의 탭은 층이 탭의 기계를 볼 때까지 올리지 않는다.
    tab.machine === undefined &&
    (def.toStored === undefined || tabToStored(tab) !== null)
  );
}

export interface GlobalFloatsApi {
  /** false면 전역 float을 쓰지 않는다(Provider 없음, detached 창, 앱 전용 창). */
  readonly enabled: boolean;
  /** 아래에서 위 순서. 마지막이 맨 위다. */
  readonly floats: readonly GlobalFloatView[];
  /** floats만 가진 desk. 본문의 TabHost가 `desk`로 읽는다. */
  readonly desk: Desk;
  /** 마지막 저장이 거절됐다(store가 기한 뒤 다시 쓴다). */
  readonly saveFailed: boolean;
  /** 앱 panel 화면의 전역 float. */
  find(app: string, screen: string): GlobalFloatView | undefined;
  /**
   * 탭을 전역 float로 만든다. 앱 panel은 같은 화면이 이미 있으면 바꿔 맨 위에 두고, 다른 kind는 같은 key가 있으면 그것을
   * 바꾼다. 못 만들면(상한) false다. `transfer`는 본문이 처음 그리기 전에 한 번 `receive`로 받는다.
   */
  add(float: {
    tab: TabItem;
    workspace: WorkspaceRef;
    rect: FloatRect;
    minimized: boolean;
    pinned: boolean;
    /** 앱 panel의 앱 이름. */
    title?: string;
    transfer?: TabTransfer;
  }): boolean;
  /** key의 탭 필드를 바꾸고 저장한다. */
  patch(
    key: string,
    patch: Partial<TabItem> | ((current: TabItem) => Partial<TabItem>),
  ): void;
  /** `add`가 맡긴 transfer를 꺼낸다(한 번만). */
  takeTransfer(key: string): TabTransfer | undefined;
  /** 본문이 자기 TabHost를 알린다(transfer와 닫기 확인이 쓴다). 돌려주는 함수로 푼다. */
  registerHost(key: string, host: () => TabHost): () => void;
  /** 펼쳐 맨 위로 올린다. */
  expand(key: string): void;
  minimize(key: string): void;
  /** 펼쳐 있으면 접고 접혀 있으면 펼친다. chip이 누른다. */
  toggle(key: string): void;
  pin(key: string, pinned: boolean): void;
  setRect(key: string, rect: FloatRect): void;
  /** kind의 닫기 확인(`beforeClose`)을 거친다. 사람이 취소하면 그대로다. */
  close(key: string): void;
  /** 확인 없이 뺀다(본문이 자기 탭을 지우는 길). */
  remove(key: string): void;
  /** 고정 안 한 펼친 것을 모두 접는다(`inside`는 남긴다). 바깥을 눌렀을 때다. */
  minimizeLoose(inside?: string): void;
  /** workspace 창이 자기 desk로 받는 길을 등록한다. 돌려주는 함수로 푼다. */
  registerDesk(target: DeskTarget): () => void;
  /** 받는 workspace 창이 있고 이 float이 그 desk로 올 수 있다("이 desk로"). */
  canMoveToDesk(float: GlobalFloatView): boolean;
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
  desk: emptyDesk("global", "Global"),
  saveFailed: false,
  find: () => undefined,
  add: () => false,
  patch: () => {},
  takeTransfer: () => undefined,
  registerHost: () => () => {},
  expand: () => {},
  minimize: () => {},
  toggle: () => {},
  pin: () => {},
  setRect: () => {},
  close: () => {},
  remove: () => {},
  minimizeLoose: () => {},
  registerDesk: () => () => {},
  canMoveToDesk: () => false,
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
  keep,
  children,
}: {
  /** false면 읽지도 쓰지도 않는다(detached 창, 앱 전용 창). */
  enabled?: boolean;
  bridge?: () => GlobalFloatsBridge | undefined;
  /** 파일에서 읽은 float 가운데 둘 것. 창의 터미널 store가 모르는 터미널(PTY가 없다)을 뺀다. */
  keep?: (tab: TabItem) => boolean;
  children: ReactNode;
}) {
  const appViews = useAppViews();
  const [store] = useState(() => createGlobalFloatsStore(bridge, keep));
  const state = useSyncExternalStore(store.subscribe, store.get);
  const targetRef = useRef<DeskTarget | null>(null);
  // 받는 창이 있는지와 그 창의 workspace. 바뀌면 "이 desk로" 단추가 따라 바뀐다.
  const [deskWorkspace, setDeskWorkspace] = useState<string | null>(null);
  const registerDesk = useCallback((target: DeskTarget) => {
    targetRef.current = target;
    setDeskWorkspace(workspaceKey(target.workspace));
    return () => {
      if (targetRef.current !== target) return;
      targetRef.current = null;
      setDeskWorkspace(null);
    };
  }, []);
  const hostsRef = useRef(new Map<string, () => TabHost>());
  const registerHost = useCallback((key: string, host: () => TabHost) => {
    hostsRef.current.set(key, host);
    return () => {
      if (hostsRef.current.get(key) === host) hostsRef.current.delete(key);
    };
  }, []);
  const transfers = useRef(new Map<string, TabTransfer>());
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
      const workspaces = store.get().workspaces;
      store.commit((desk) =>
        desk.floats
          .filter((item) => {
            const from = workspaces[item.tab.key];
            return (
              ((item.tab.kind === "app_panel" ||
                item.tab.kind === "app_screen") &&
                item.tab.app === removed) ||
              (from?.kind === "app" && from.id === removed)
            );
          })
          .reduce((next, item) => closeFloat(next, item.tab.key), desk),
      );
    });
  }, [enabled, events, store]);

  // 앱 이름은 저장하지 않고 앱 목록에서 한 번 읽는다.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const item of state.desk.floats) {
      const app = item.tab.kind === "app_panel" ? item.tab.app : undefined;
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
    const floats = state.desk.floats.map(
      (item): GlobalFloatView => ({
        key: item.tab.key,
        tab: item.tab,
        workspace: state.workspaces[item.tab.key] ?? { kind: "home" },
        title:
          item.tab.kind === "app_panel" && item.tab.app !== undefined
            ? (state.names[item.tab.app] ??
              t("project-workspace.label.kind-app-panel"))
            : item.tab.title,
        rect: item.rect,
        minimized: item.minimized,
        pinned: item.pinned,
      }),
    );
    const act = (
      change: Parameters<typeof store.commit>[0],
      attach?: Parameters<typeof store.commit>[1],
    ) => {
      store.commit(change, attach);
    };
    const closeNow = (key: string) => act((desk) => closeFloat(desk, key));
    return {
      enabled: true,
      floats,
      desk: state.desk,
      saveFailed: state.saveFailed,
      find: (app, screen) =>
        floats.find(
          (item) =>
            item.tab.kind === "app_panel" &&
            item.tab.app === app &&
            item.tab.screen === screen,
        ),
      add(input) {
        const panel =
          input.tab.kind === "app_panel" &&
          input.tab.app !== undefined &&
          input.tab.screen !== undefined
            ? { app: input.tab.app, screen: input.tab.screen }
            : null;
        const key =
          panel === null ? input.tab.key : globalKey(panel.app, panel.screen);
        const tab: TabItem = { ...input.tab, key };
        if (panel !== null && input.title !== undefined) {
          store.setName(panel.app, input.title);
        }
        if (input.transfer !== undefined) {
          transfers.current.set(key, input.transfer);
        }
        const next = store.commit(
          (desk) => {
            let moved = openFloatTab(closeFloat(desk, key), tab, input.rect);
            if (input.pinned) moved = pinFloat(moved, key, true);
            return input.minimized ? minimizeFloat(moved, key) : moved;
          },
          { key, workspace: input.workspace },
        );
        const added = next.floats.some((item) => item.tab.key === key);
        if (!added) transfers.current.delete(key);
        return added;
      },
      patch: (key, patch) =>
        act((desk) => ({
          ...desk,
          floats: desk.floats.map((item) =>
            item.tab.key === key
              ? {
                  ...item,
                  tab: {
                    ...item.tab,
                    ...(typeof patch === "function" ? patch(item.tab) : patch),
                  },
                }
              : item,
          ),
        })),
      takeTransfer(key) {
        const found = transfers.current.get(key);
        transfers.current.delete(key);
        return found;
      },
      registerHost,
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
      close(key) {
        const item = floats.find((float) => float.key === key);
        const host = hostsRef.current.get(key)?.();
        const confirm =
          item === undefined || host === undefined
            ? null
            : tabKindOf(item.tab.kind)?.beforeClose?.(item.tab, host);
        if (!confirm) closeNow(key);
        else void confirm.then((close) => close && closeNow(key));
      },
      remove: closeNow,
      minimizeLoose: (inside) =>
        act((desk) => minimizeLooseFloats(desk, inside)),
      registerDesk,
      canMoveToDesk: (float) =>
        deskWorkspace !== null &&
        (tabKindOf(float.tab.kind)?.anyWorkspace === true ||
          workspaceKey(float.workspace) === deskWorkspace),
      async moveToDesk(key) {
        const float = floats.find((item) => item.key === key);
        const target = targetRef.current;
        if (float === undefined || target === null) return;
        const def = tabKindOf(float.tab.kind);
        const host = hostsRef.current.get(key)?.();
        const transfer =
          def?.transfer !== undefined && host !== undefined
            ? await def.transfer(float.tab, host)
            : { value: null, views: [] };
        if (transfer === null) return;
        // transfer가 탭을 바꿨을 수 있고 그 사이 float이 닫혔을 수 있다.
        const current = store
          .get()
          .desk.floats.find((item) => item.tab.key === key);
        if (current === undefined) return;
        if (target.take({ ...float, tab: current.tab }, transfer)) {
          closeNow(key);
        }
      },
    };
  }, [state, store, deskWorkspace, registerDesk, registerHost]);

  const host = useMemo(() => ({ webviews, keeps }), [webviews, keeps]);
  return (
    <Context.Provider value={enabled ? api : NONE}>
      <HostContext.Provider value={enabled ? host : null}>
        {children}
      </HostContext.Provider>
    </Context.Provider>
  );
}
