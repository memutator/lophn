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
import { useAppViews } from "./app-views.tsx";
import { createViewKeeps, type ViewKeeps } from "./view-keeps.ts";
import { createWebviewHost, type WebviewHost } from "./webview-host.tsx";
import styles from "./workspace-views.module.css";

/** 창마다 살려 두는 background page의 상한. 넘치면 가장 오래 안 본 것부터 놓는다. */
export const MAX_KEPT_PAGES = 6;

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
}

interface Pool extends WorkspaceViewPool {
  mounted: boolean;
  /** 떠나서 살려 둔 화면. mount된 동안은 비어 있다. */
  parked: Set<string>;
  carry: string[];
}

export interface WorkspaceViews {
  /** workspace의 화면 그릇과 보관소. 돌아오면 두고 간 것이 그대로 있다. */
  acquire(workspace: string): WorkspaceViewPool;
  setLayer(node: HTMLElement | null): void;
  /** guest session의 탭이 download를 받기 시작했거나 끝났다. 떠난 workspace의 탭도 맞춘다. */
  downloading(session: string, active: boolean): void;
}

export function createWorkspaceViews(
  close: (session: string) => void,
  max = MAX_KEPT_PAGES,
): WorkspaceViews {
  const pools = new Map<string, Pool>();
  let layer: HTMLElement | null = null;
  let order = 0;
  // 호스트를 가로질러 "최근에 본 순서"를 비교한다.
  const tick = () => ++order;

  function drop(workspace: string, pool: Pool, key: string): void {
    pool.webviews.release(key);
    pool.keeps.release(key);
    pool.parked.delete(key);
    if (!pool.mounted && pool.parked.size === 0) pools.delete(workspace);
  }

  function enforceCap(): void {
    const all = [...pools].flatMap(([workspace, pool]) =>
      [...pool.parked].map((key) => ({
        workspace,
        pool,
        key,
        at: pool.webviews.shownAt(key),
      })),
    );
    all.sort((a, b) => a.at - b.at);
    for (const item of all.slice(0, Math.max(0, all.length - max))) {
      drop(item.workspace, item.pool, item.key);
    }
  }

  function create(workspace: string): Pool {
    const webviews = createWebviewHost(tick);
    webviews.attach(layer);
    const keeps = createViewKeeps(close);
    const pool: Pool = {
      webviews,
      keeps,
      mounted: true,
      parked: new Set(),
      carry: [],
      leave(tabKeys) {
        pool.mounted = false;
        queueMicrotask(() => {
          if (pool.mounted) return;
          pool.parked = new Set(webviews.park(tabKeys()));
          for (const key of keeps.keys()) {
            if (!pool.parked.has(key)) keeps.release(key);
          }
          if (pool.parked.size === 0) pools.delete(workspace);
          enforceCap();
        });
      },
      carried: () => pool.carry,
    };
    return pool;
  }

  return {
    acquire(workspace) {
      const existing = pools.get(workspace);
      if (existing === undefined) {
        const pool = create(workspace);
        pools.set(workspace, pool);
        return pool;
      }
      existing.mounted = true;
      existing.carry = [...existing.parked];
      existing.parked = new Set();
      return existing;
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
  const [views] = useState(() =>
    createWorkspaceViews((session) => closeRef.current(session)),
  );
  const browser = useBrowserApi();
  useEffect(
    () =>
      browser?.subscribeEvents((event) => {
        if (event.kind === "download") {
          views.downloading(event.view_session, event.active);
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
