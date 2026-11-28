// 창마다 하나인 workspace view 보관. workspace를 바꾸면 WorkspaceWindow가 다시 mount되고 그 안의 <webview>는
// DOM에서 빠지는 순간 guest가 사라져 page가 다시 load된다. 그래서 그릇(layer)은 WorkspaceWindow 밖(창)에 한 번만
// 두고, 떠나는 workspace의 화면 가운데 page가 살려 둘 이유(app-frame/webview-host.tsx의 `park`)를 켠 것만 그 그릇에
// 숨겨 남긴다. 나머지는 떠날 때 놓는다(돌아오면 다시 load한다).
// WorkspaceWindow의 본문은 그릇과 같은 stacking context(`.context`)에 portal로 그려야 한다. 그릇이 본문 밖
// context에 있으면 pane 화면이 패널·menu 위로 올라온다.
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { useBrowserApi } from "../browser/browser-api.tsx";
import { SURFACE_RELEASE_ID } from "../../ipc/surface.ts";
import type { TabRelation } from "../../../protocol/lophn-agent/host-queue.ts";
import { useMachineHub } from "../desktop/machines/scope.tsx";
import { type WorkspaceRef, workspaceKey } from "../shell/desk-model.ts";
import { releaseStored } from "../workspace/hand.ts";
import { hostTabOf } from "../workspace/model.ts";
import { surfaceApi } from "../workspace/use-surface-requests.ts";
import { browserPartition } from "../../../protocol/shell/browser-profiles.ts";
import { useAppViews } from "./app-views.tsx";
import { createViewKeeps, type ViewKeeps } from "./view-keeps.ts";
import { createWebviewHost, type WebviewHost } from "./webview-host.tsx";
import styles from "./workspace-views.module.css";

/** 창마다 살려 두는 background page의 상한. 넘치면 가장 오래 안 본 것부터 놓는다. */
export const MAX_KEPT_PAGES = 6;
/** 창마다 둘 수 있는 agent가 다루는 browser page(agent가 연 탭, 사람이 넘긴 탭)의 상한(위 상한과 따로 센다). */
export const MAX_AGENT_PAGES = 12;

/** workspace가 mount되지 않은 동안 page만 만들어 둔 agent 탭의 자리. mount되면 `openAt()`이 정한다. */
export interface HostPlacement {
  tab: string;
  url: string;
  /** core가 연 session의 agent 정의로 고른 browser profile(core가 알려진 목록에서 고른 값). null은 기본이다. */
  profile: string | null;
  relation: TabRelation | null;
  source: string | null;
  /** 탭의 주인 session. null은 사람의 탭이다. */
  owner: string | null;
}

/** mount되지 않은 workspace에서 일어난 일. 그 workspace가 mount되면 layout에 맞춘다. */
export interface PendingHost {
  opens: HostPlacement[];
  /** layout에 이미 있는데 page가 없어진 탭 key. */
  closes: string[];
  /** 상한으로 page를 놓은 넘긴 탭 key. 사람의 탭이라 layout에 두고 주인만 지운다. */
  released: string[];
}

export interface WorkspaceViewPool {
  readonly webviews: WebviewHost;
  readonly keeps: ViewKeeps;
  /**
   * workspace를 떠난다. 한 틱 뒤(자식의 cleanup이 view를 keeps에 넣은 뒤)에 살려 둘 것만 두고 나머지 화면과 view를
   * 닫는다. `tabKeys`는 그때 layout에 있는 탭 key다. 그 사이 다시 mount했으면 아무것도 하지 않는다.
   */
  leave(tabKeys: () => ReadonlySet<string>): void;
  /** 앞서 떠나며 살려 둔 화면의 key. 돌아온 창이 layout을 읽은 뒤 지금 탭과 맞춘다. */
  carried(): readonly string[];
  /** mount되지 않은 사이 agent가 연 탭의 자리와 page가 없어진 탭. 가져가면 비운다. */
  takePending(): PendingHost;
}

interface Pool extends WorkspaceViewPool {
  /** 이 pool의 workspace. 상한으로 놓은 넘긴 탭을 저장된 layout에서 사람의 탭으로 돌릴 때 쓴다. */
  ref: WorkspaceRef;
  mounted: boolean;
  /** mount되기 전에 만든 agent page의 bind를 알리는 구독. mount되면 탭이 알리므로 푼다. */
  offBind: Map<string, () => void>;
  /** 떠나서 살려 둔 화면. mount된 동안은 비어 있다. */
  parked: Set<string>;
  carry: string[];
}

export interface WorkspaceViews {
  /** workspace의 화면 그릇과 보관소. 돌아오면 두고 간 것이 그대로 있다. */
  acquire(workspace: WorkspaceRef): WorkspaceViewPool;
  setLayer(node: HTMLElement | null): void;
  /** guest session의 탭이 download를 받기 시작했거나 끝났다. 떠난 workspace의 탭도 맞춘다. */
  downloading(session: string, active: boolean): void;
  /** 이 창이 그 workspace를 mount하고 있는가. */
  mounted(workspace: string): boolean;
  /** agent가 그 core 탭의 page를 방금 썼다. 모든 pool에서 찾아 쓴 때를 갱신한다. */
  touch(tab: string): void;
  /** workspace 상관없이 이 창의 어느 pool에든 있는 page가 agent가 다루는 page면 그 core 탭 id. */
  tabOf(session: string): string | undefined;
  /**
   * mount되지 않은 workspace에 숨은 넘긴 탭의 page가 window.close()로 부서졌다. 탭은 사람의 것이라 같은 자리에서 page를 새로 열고
   * 새 guest를 다시 bind한다. mount된 workspace의 탭은 BrowserTab이 한다.
   */
  renewHanded(session: string): void;
  /** mount되지 않은 workspace에 agent가 연 browser page를 만들어 두고 자리는 mount될 때로 미룬다. */
  hostPage(workspace: WorkspaceRef, placement: HostPlacement): void;
  /**
   * mount되지 않은 workspace의 agent 탭 page를 놓는다. `layout`이면 탭이 닫힌 것이라 mount될 때 layout에서도 뺀다.
   * 아니면 다른 창이 page를 이어받은 것이라 layout은 건드리지 않는다.
   */
  hostGone(workspace: string, key: string, layout: boolean): void;
}

/** agent page와 창 사이의 통로. 창이 아닌 쪽(main)이 core 표를 맞춘다. */
export interface HostPageHooks {
  /** page가 붙었다(bind). */
  bound(tab: string, session: string): void;
  /** 상한 때문에 page를 놓았다. */
  gone(tab: string): void;
  /** 상한 때문에 넘긴 탭의 page를 놓았다. 저장된 layout에서도 그 탭의 주인을 지운다. */
  released(workspace: WorkspaceRef, key: string): void;
}

export function createWorkspaceViews(
  close: (session: string) => void,
  hooks: HostPageHooks,
  max = MAX_KEPT_PAGES,
  maxAgent = MAX_AGENT_PAGES,
): WorkspaceViews {
  const pools = new Map<string, Pool>();
  const pending = new Map<string, PendingHost>();
  const pendingOf = (workspace: string) => {
    let found = pending.get(workspace);
    if (found === undefined) {
      found = { opens: [], closes: [], released: [] };
      pending.set(workspace, found);
    }
    return found;
  };
  // 놓은 agent 탭을 mount될 때 layout에서도 뺀다(`layout`). 한 번도 mount되지 않아 자리를 못 받은 탭은 자리를 버리기만 한다.
  function forget(workspace: string, key: string, layout = true): void {
    const found = pendingOf(workspace);
    const placed = found.opens.findIndex((item) => `host:${item.tab}` === key);
    if (placed >= 0) found.opens.splice(placed, 1);
    else if (layout && !found.closes.includes(key)) found.closes.push(key);
  }
  let layer: HTMLElement | null = null;
  let order = 0;
  // 호스트를 가로질러 "최근에 본 순서"를 비교한다.
  const tick = () => ++order;

  function drop(workspace: string, pool: Pool, key: string): void {
    const tab = pool.webviews.hostTab(key);
    if (tab !== null) {
      // 넘긴 탭은 사람의 탭이라 layout에서 빼지 않고 mount될 때 주인만 지운다. agent가 연 탭(key가 곧 id)은 layout에서도 뺀다.
      if (hostTabOf({ key }) === null) {
        pendingOf(workspace).released.push(key);
        hooks.released(pool.ref, key);
      } else forget(workspace, key);
      hooks.gone(tab);
    }
    pool.offBind.get(key)?.();
    pool.offBind.delete(key);
    pool.webviews.release(key);
    pool.keeps.release(key);
    pool.parked.delete(key);
    if (!pool.mounted && pool.parked.size === 0) pools.delete(workspace);
  }

  // agent가 다루는 page(agent가 연 탭, 사람이 넘긴 탭)는 따로 센다: 사람이 켠 Keep alive 상한에 밀려 agent의 page가 사라지면 안 된다.
  // guest가 붙은 page만 센다: 느린 site의 page는 열기가 시간 초과로 끝나 어차피 놓이므로, 그 page 때문에 멀쩡한 탭을 놓지 않는다.
  // 붙지 못한 page가 나중에 붙으면 그때 다시 센다.
  function enforceCap(): void {
    const all = [...pools].flatMap(([workspace, pool]) =>
      [...pool.parked]
        .filter((key) => pool.webviews.isBound(key))
        .map((key) => ({
          workspace,
          pool,
          key,
          agent: pool.webviews.hostTab(key) !== null,
          at: pool.webviews.shownAt(key),
        })),
    );
    all.sort((a, b) => a.at - b.at);
    for (const agent of [false, true]) {
      const group = all.filter((item) => item.agent === agent);
      const limit = agent ? maxAgent : max;
      for (const item of group.slice(0, Math.max(0, group.length - limit))) {
        drop(item.workspace, item.pool, item.key);
      }
    }
  }

  function create(ref: WorkspaceRef, mounted: boolean): Pool {
    const workspace = workspaceKey(ref);
    const webviews = createWebviewHost(tick);
    webviews.attach(layer);
    const keeps = createViewKeeps(close);
    const pool: Pool = {
      ref,
      webviews,
      keeps,
      mounted,
      parked: new Set(),
      carry: [],
      offBind: new Map(),
      takePending() {
        const found = pending.get(workspace) ?? {
          opens: [],
          closes: [],
          released: [],
        };
        pending.delete(workspace);
        return found;
      },
      leave(tabKeys) {
        pool.mounted = false;
        queueMicrotask(() => {
          if (pool.mounted) return;
          // 자리를 아직 받지 못한 agent page는 layout에 없어도 놓지 않는다.
          const unplaced = (pending.get(workspace)?.opens ?? []).map(
            (item) => `host:${item.tab}`,
          );
          pool.parked = new Set(
            webviews.park(new Set([...tabKeys(), ...unplaced])),
          );
          for (const key of keeps.keys()) {
            if (!pool.parked.has(key)) keeps.release(key);
          }
          if (pool.parked.size === 0) pools.delete(workspace);
          for (const key of pool.parked) {
            if (pool.webviews.isBound(key) || pool.offBind.has(key)) continue;
            // 늦게 붙은 page는 방금 쓴 것으로 센다. 안 그러면 가장 오래된 것으로 보여 붙자마자 놓인다.
            pool.offBind.set(
              key,
              pool.webviews.onSession(key, () => {
                pool.webviews.touch(key);
                enforceCap();
              }),
            );
          }
          enforceCap();
        });
      },
      carried: () => pool.carry,
    };
    return pool;
  }

  return {
    acquire(ref) {
      const workspace = workspaceKey(ref);
      const existing = pools.get(workspace);
      if (existing === undefined) {
        const pool = create(ref, true);
        pools.set(workspace, pool);
        return pool;
      }
      existing.mounted = true;
      // 자리를 아직 받지 못한 agent page는 layout에 없다. 맞추기에서 놓이지 않게 가져온 목록에서 뺀다.
      const unplaced = new Set(
        pending.get(workspace)?.opens.map((item) => `host:${item.tab}`),
      );
      existing.carry = [...existing.parked].filter((key) => !unplaced.has(key));
      existing.parked = new Set();
      for (const off of existing.offBind.values()) off();
      existing.offBind.clear();
      return existing;
    },
    mounted: (workspace) => pools.get(workspace)?.mounted === true,
    touch(tab) {
      for (const pool of pools.values()) {
        const key = pool.webviews.keyOfHostTab(tab);
        if (key !== undefined) pool.webviews.touch(key);
      }
    },
    renewHanded(session) {
      for (const pool of pools.values()) {
        if (pool.mounted) continue;
        const key = pool.webviews.keyOf(session);
        const tab = key === undefined ? null : pool.webviews.hostTab(key);
        // 넘긴 탭(사람의 key)과 준 agent 탭만 page를 새로 연다. 그 밖의 agent 탭은 page와 같이 닫힌다.
        if (
          key === undefined ||
          tab === null ||
          (hostTabOf({ key }) !== null && !pool.webviews.isGiven(key))
        ) {
          continue;
        }
        pool.webviews.renew(key);
        pool.offBind.get(key)?.();
        pool.offBind.set(
          key,
          pool.webviews.onSession(key, (fresh) => hooks.bound(tab, fresh)),
        );
      }
    },
    tabOf(session) {
      for (const pool of pools.values()) {
        const key = pool.webviews.keyOf(session);
        if (key === undefined) continue;
        return pool.webviews.hostTab(key) ?? undefined;
      }
      return undefined;
    },
    hostPage(ref, placement) {
      const workspace = workspaceKey(ref);
      let pool = pools.get(workspace);
      if (pool === undefined) {
        pool = create(ref, false);
        pools.set(workspace, pool);
      }
      const key = `host:${placement.tab}`;
      const found = pendingOf(workspace);
      if (found.opens.some((item) => item.tab === placement.tab)) return;
      found.opens.push(placement);
      pool.webviews.ensure(
        key,
        placement.url,
        "browser",
        browserPartition(placement.profile),
      );
      pool.parked.add(key);
      pool.offBind.set(
        key,
        pool.webviews.onSession(key, (session) => {
          hooks.bound(placement.tab, session);
          // 늦게 붙은 page는 방금 쓴 것으로 센다(만든 때가 아니라 붙은 때). 안 그러면 가장 오래된 것으로 보여 붙자마자 놓인다.
          pool.webviews.touch(key);
          enforceCap();
        }),
      );
    },
    hostGone(workspace, key, layout) {
      const pool = pools.get(workspace);
      forget(workspace, key, layout);
      if (pool === undefined) return;
      pool.offBind.get(key)?.();
      pool.offBind.delete(key);
      pool.webviews.release(key);
      pool.keeps.release(key);
      pool.parked.delete(key);
      if (!pool.mounted && pool.parked.size === 0) pools.delete(workspace);
    },
    downloading(session, active) {
      for (const pool of pools.values()) {
        const key = pool.webviews.keyOf(session);
        if (key !== undefined) pool.webviews.setDownloading(key, active);
      }
    },
    setLayer(node) {
      layer = node;
      for (const pool of pools.values()) pool.webviews.attach(node);
    },
  };
}

interface Value {
  views: WorkspaceViews;
  /** WorkspaceWindow 본문을 portal로 그릴 곳. */
  context: HTMLElement;
}

const WorkspaceViewsContext = createContext<Value | null>(null);

/** 없으면(테스트, gallery, detached 창) WorkspaceWindow가 자기 그릇을 쓴다. */
export function useWorkspaceViews(): Value | null {
  return useContext(WorkspaceViewsContext);
}

/**
 * 창에 한 번 둔다. 그릇과 본문 context를 먼저 만든 뒤 아래를 그린다(아래 WorkspaceWindow가 첫 render부터 portal 자리를
 * 알아야 해서).
 */
export function WorkspaceViewsProvider(props: { children: ReactNode }) {
  const appViews = useAppViews();
  const closeRef = useRef<(session: string) => void>(() => {});
  closeRef.current = (session) =>
    void appViews?.views.closeView({ view_session: session }).catch(() => {});
  // 이 컴퓨터의 layout 저장(넘긴 탭은 이 컴퓨터의 것이다). hub가 없으면(gallery) 메모리의 목록만 쓴다.
  const hub = useMachineHub();
  const layoutRef = useRef(hub?.get(null).workspace.layout);
  layoutRef.current = hub?.get(null).workspace.layout;
  const [views] = useState(() =>
    createWorkspaceViews((session) => closeRef.current(session), {
      bound: (tab, session) =>
        void surfaceApi()?.report({ bind: { tab, view_session: session } }),
      gone: (tab) => void surfaceApi()?.report({ tab, state: "closed" }),
      released: (workspace, key) => {
        const layout = layoutRef.current;
        if (layout !== undefined) void releaseStored(layout, workspace, key);
      },
    }),
  );
  const browser = useBrowserApi();
  // agent가 연 browser 탭은 그 workspace가 이 창에 mount되어 있지 않아도 이 창이 page를 만들어 둔다. 창 단위 receiver라
  // 다른 workspace나 Settings가 보여도 받는다. mount된 workspace의 요청은 WorkspaceWindow가 연다.
  useEffect(() => {
    const surface = surfaceApi();
    if (surface === null) return;
    return surface.on(({ request }) => {
      const workspace = workspaceKey(request.workspace);
      if (views.mounted(workspace)) return;
      if (
        request.kind === "tab_open" &&
        "browser" in request.payload.target &&
        request.payload.from_terminal === undefined
      ) {
        const { tab, target, relation, source, owner } = request.payload;
        views.hostPage(request.workspace, {
          tab,
          url: target.browser.url,
          profile: target.browser.profile ?? null,
          relation,
          source,
          owner: owner ?? null,
        });
      } else if (request.kind === "tab_close") {
        views.hostGone(
          workspace,
          `host:${request.payload.tab}`,
          request.id !== SURFACE_RELEASE_ID,
        );
      } else return;
      void surface.ack({ request: request.id, opened: true });
    });
  }, [views]);
  // agent가 browser 호출을 할 때마다 main이 알린다. 쓴 page는 상한에서 나중에 놓인다.
  useEffect(
    () => surfaceApi()?.control((control) => views.touch(control.tab)),
    [views],
  );
  // agent가 다루는 browser 탭(agent가 연 탭, 사람이 넘긴 탭)의 상태. page는 workspace가 mount되지 않아도 사니 창 단위로 받는다.
  // 넘기지 않은 사람의 탭은 core 탭 id가 없어 알리지 않는다.
  useEffect(() => {
    const surface = surfaceApi();
    if (surface === null || browser === null) return;
    return browser.subscribeState((state) => {
      const tab = views.tabOf(state.view_session);
      if (tab === undefined) return;
      void surface.report({
        tab,
        state: { url: state.url, title: state.title, loading: state.loading },
      });
    });
  }, [browser, views]);
  useEffect(
    () =>
      browser?.subscribeEvents((event) => {
        if (event.kind === "download") {
          views.downloading(event.view_session, event.active);
        } else if (event.kind === "close") {
          views.renewHanded(event.view_session);
        }
      }),
    [browser, views],
  );
  const [context, setContext] = useState<HTMLElement | null>(null);
  const value = useRef<Value | null>(null);
  if (context !== null && value.current?.context !== context) {
    value.current = { views, context };
  }
  return (
    <WorkspaceViewsContext.Provider value={value.current}>
      <div
        ref={setContext}
        className={styles.context}
        data-workspace-context=""
      >
        <div ref={views.setLayer} className={styles.layer} />
      </div>
      {context === null ? null : props.children}
    </WorkspaceViewsContext.Provider>
  );
}
