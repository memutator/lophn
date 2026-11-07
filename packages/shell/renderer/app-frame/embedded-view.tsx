// 앱 화면의 자리. 앱 공간·탭 패널·세션 카드가 본문 경계에 이 자리를 두면 창의 <webview> 그릇이 state의
// src로 그 화면을 이 자리 위에 그린다. 앱은 자기 page를 그리고 바깥 크롬은 이 자리 밖의 shell이 그린다.
// 앱 UI 코드는 여기 import하지 않는다.
//
// view를 여는 일은 main이 한다(openApp). main이 만든 src가 바뀌면(열기, crash 뒤 다시 열기) 그릇이 같은
// 자리에서 element를 새로 만든다. view_session은 main이 미는 state로 갱신된다.
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { t } from "@lophn/i18n";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";

import type {
  AppFrameViewState,
  AppViewOpen,
  LophnShellViewsApi,
} from "../../ipc/app-frame.ts";
import { type ShellHead, useAppTabHead } from "./app-tab-head.tsx";
import { createViewKeeps, type ViewKeeps } from "./view-keeps.ts";
import {
  useViewLayer,
  useWebviewHost,
  useWebviewSlot,
} from "./webview-host.tsx";
import styles from "./embedded-view.module.css";

const ViewKeepsContext = createContext<ViewKeeps | null>(null);

/**
 * 창(Workspace)마다 하나. keepKey를 준 EmbeddedView는 unmount돼도 view를 닫지 않고 여기 숨겨
 * 두었다가 같은 key로 다시 mount하면 같은 view를 쓴다. 없으면 keepKey는 무시된다.
 */
export const ViewKeepsProvider = ViewKeepsContext.Provider;
export { createViewKeeps };

type Phase = "opening" | "ready" | "failed";

interface EmbeddedViewProps extends AppViewOpen {
  /** shell preload의 view 통로. */
  views: LophnShellViewsApi;
  /** 오류 문구에 쓰는 사람 말 이름. */
  label: string;
  /** false면 view를 남긴 채 숨긴다(다른 탭·다른 공간). */
  shown?: boolean;
  onState?(state: AppFrameViewState): void;
  /**
   * 탭 key처럼 mount가 바뀌어도 같은 view를 이어 쓸 이름. 주면 unmount할 때 view를 닫지 않고
   * 숨겨 보관하며, 닫는 일은 보관소의 주인이 한다. ViewKeepsProvider가 없으면 무시된다.
   */
  keepKey?: string;
  /**
   * 열기 실패를 그 자리 안내로 바꾼다. code는 main이 준 거절 code다. null이면 기본 오류와
   * 다시 열기를 둔다.
   */
  renderFailure?(code: string, retry: () => void): ReactNode | null;
  /** 열기가 거절됐다. code는 main이 준 거절 code다. */
  onFailed?(code: string): void;
  /** 앱이 올린 탭 머리 줄을 이 자리가 선 card 칸의 머리 줄에 그린다. 탭 하나를 차지하는 화면만 준다. */
  tabHead?: boolean;
  /** tabHead일 때 shell이 머리 줄에 더하는 것(app-tab-head.tsx의 ShellHead). */
  shellHead?: ShellHead;
}

export function EmbeddedView(props: EmbeddedViewProps) {
  const { views, app, mode, release, screen, place, label, onState } = props;
  // 값이 같으면 같은 view다. 객체가 render마다 새로 만들어져도 다시 열지 않는다.
  const paramsJson =
    props.params === undefined ? "" : JSON.stringify(props.params);
  const workspaceJson =
    props.workspace === undefined ? "" : JSON.stringify(props.workspace);
  const cardMessage = props.card?.message;
  const cardBlock = props.card?.block;
  const shown = props.shown ?? true;
  const host = useWebviewHost();
  const layer = useViewLayer();
  const ref = useRef<HTMLDivElement | null>(null);
  const keeps = useContext(ViewKeepsContext);
  const keepKey = keeps === null ? undefined : props.keepKey;
  const [viewSession, setViewSession] = useState<string | null>(null);
  const [viewSrc, setViewSrc] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("opening");
  const [failure, setFailure] = useState("unavailable");
  const [attempt, setAttempt] = useState(0);
  const stateListener = useRef(onState);
  stateListener.current = onState;
  const failedListener = useRef(props.onFailed);
  failedListener.current = props.onFailed;
  // 보관할 때 함께 넘길 마지막 state.
  const lastState = useRef<AppFrameViewState | null>(null);

  // main이 민 state를 화면과 자리에 반영한다. src가 바뀌면 그릇이 element를 새로 만든다.
  const apply = (state: AppFrameViewState) => {
    lastState.current = state;
    setViewSession(state.view_session);
    setViewSrc(state.src);
    setPhase("ready");
    stateListener.current?.(state);
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // 여는 동안 이 자리가 사라지면 늦게 온 view를 바로 닫는다(keepKey가 있으면 보관한다).
  useEffect(() => {
    let alive = true;
    setPhase("opening");
    lastState.current = null;
    const input: AppViewOpen = {
      app,
      mode,
      screen,
      place,
      ...(paramsJson === "" ? {} : { params: JSON.parse(paramsJson) }),
      ...(workspaceJson === "" ? {} : { workspace: JSON.parse(workspaceJson) }),
      ...(release === undefined ? {} : { release }),
      ...(cardMessage === undefined || cardBlock === undefined
        ? {}
        : { card: { message: cardMessage, block: cardBlock } }),
    };
    const signature = [
      app,
      mode,
      release,
      screen,
      place,
      paramsJson,
      workspaceJson,
    ].join("\n");
    const dispose = (state: AppFrameViewState) => {
      if (keepKey !== undefined && keeps !== null) {
        keeps.put(keepKey, {
          session: state.view_session,
          signature,
          state,
        });
      } else {
        void views
          .closeView({ view_session: state.view_session })
          .catch(() => {});
        host?.release(state.view_session);
      }
    };
    const kept =
      keepKey === undefined || keeps === null
        ? undefined
        : keeps.take<AppFrameViewState>(keepKey, signature);
    if (kept !== undefined) {
      applyRef.current(kept.state);
    } else {
      views.openApp(input).then(
        (state) => {
          if (!alive) {
            dispose(state);
            return;
          }
          if (keepKey !== undefined && keeps !== null) {
            keeps.track(keepKey, {
              session: state.view_session,
              signature,
              state,
            });
          }
          applyRef.current(state);
        },
        (error: unknown) => {
          if (!alive) return;
          const code = error instanceof Error ? error.message : "unavailable";
          setFailure(code);
          setPhase("failed");
          failedListener.current?.(code);
        },
      );
    }
    return () => {
      alive = false;
      setViewSession(null);
      setViewSrc(null);
      if (lastState.current !== null) {
        dispose(lastState.current);
      }
    };
  }, [
    views,
    keeps,
    keepKey,
    host,
    app,
    mode,
    release,
    screen,
    place,
    paramsJson,
    workspaceJson,
    cardMessage,
    cardBlock,
    attempt,
  ]);

  useEffect(() => {
    if (viewSession === null) return;
    return views.subscribeViewState((state) => {
      if (state.view_session === viewSession) applyRef.current(state);
    });
  }, [views, viewSession]);

  // 숨겨 둔 동안의 state도 보관소가 받는다. mount된 view의 tracked state도 여기서 갱신된다.
  useEffect(() => {
    if (keepKey !== undefined) keeps?.watch(views.subscribeViewState);
  }, [views, keeps, keepKey]);

  // view_session이 바뀌면(다시 열기) 이전 session의 element는 새 그릇 자리가 없다. 닫는 쪽이 놓는다.
  const elementKey = keepKey ?? viewSession ?? "";
  const previousKey = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousKey.current;
    if (previous !== null && previous !== elementKey) {
      host?.release(previous);
    }
    previousKey.current = elementKey === "" ? null : elementKey;
  }, [host, elementKey]);

  const slotEnabled = host !== null && elementKey !== "" && viewSrc !== null;
  useWebviewSlot({
    host,
    kind: "app",
    enabled: slotEnabled,
    key: elementKey,
    src: viewSrc ?? "",
    ref,
    shown: shown && phase === "ready",
    layer,
  });
  useAppTabHead({
    host,
    viewKey: elementKey,
    enabled: slotEnabled && props.tabHead === true,
    label,
    shellHead: props.shellHead,
  });

  const retry = () => setAttempt((count) => count + 1);

  return (
    <div
      ref={ref}
      className={styles.region}
      data-phase={phase}
      data-shown={shown}
    >
      {host === null ? (
        <p className={styles.unavailable}>{t("common.empty.not-ready")}</p>
      ) : phase === "failed" ? (
        (props.renderFailure?.(failure, retry) ?? (
          <ErrorState target={label} onRetry={retry} />
        ))
      ) : (
        <Loading
          loading={phase === "opening"}
          placeholder={
            <div className={styles.placeholder} aria-busy="true">
              <Skeleton lines={3} />
            </div>
          }
        >
          {null}
        </Loading>
      )}
    </div>
  );
}
