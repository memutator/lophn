// 앱 native view의 자리. 앱 공간·탭 패널·세션 카드가 본문 경계에 이 자리를 두면 main이 그
// 경계 안에 앱 view를 붙인다. 앱은 자기 페이지 머리부터 그리고 바깥 크롬은 이 자리 밖의 shell이
// 그린다. 앱 UI 코드는 여기 import하지 않는다.
//
// 순서: 안 보이게 되면(탭 전환·공간 이동·닫기) cleanup에서 바로 숨기거나 닫는다. React는
// 한 commit에서 옛 effect의 cleanup을 새 effect보다 먼저 돌리므로 새 view의 열기·bounds보다
// 옛 view 숨김이 먼저 main에 간다. 새 view는 main이 준비를 확인한 뒤에 붙인다.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";

import type {
  AppFrameViewState,
  AppViewOpen,
  LophnShellViewsApi,
} from "../../ipc/app-frame.ts";
import {
  createViewCovers,
  type Rect,
  startBoundsRelay,
  type ViewCovers,
} from "./bounds.ts";
import { createViewKeeps, type ViewKeeps } from "./view-keeps.ts";
import styles from "./embedded-view.module.css";

const ViewCoversContext = createContext<ViewCovers | null>(null);

/** 창마다 하나. 본문을 덮는 패널과 앱 view 자리가 같은 목록을 본다. */
export const ViewCoversProvider = ViewCoversContext.Provider;
export { createViewCovers };

const ViewKeepsContext = createContext<ViewKeeps | null>(null);

/**
 * 창(Workspace)마다 하나. keepKey를 준 EmbeddedView는 unmount돼도 view를 닫지 않고 여기 숨겨
 * 두었다가 같은 key로 다시 mount하면 같은 view를 쓴다. 없으면 keepKey는 무시된다.
 */
export const ViewKeepsProvider = ViewKeepsContext.Provider;
export { createViewKeeps };

const ViewLayerContext = createContext(0);

/** 이 아래 EmbeddedView의 층. 0 = pane view, 1.. = floated view(floats 배열 index + 1). 기본 0. */
export const ViewLayerProvider = ViewLayerContext.Provider;

/**
 * 좁은 창에서 본문을 덮는 패널(대화·정보·운영 패널)이 부른다. 덮는 동안 자기보다 아래 층의
 * 앱 view는 숨지 않고 덮이지 않는 영역으로 줄고, 닫으면 원래 bounds로 돌아온다. layer 기본
 * Infinity(side panel·picker 같은 overlay 성격은 늘 위). 돌려주는 함수는 cover 요소가 크기
 * 변화 없이 옮겨졌을 때 부른다.
 */
export function useViewCover(
  ref: { readonly current: Element | null },
  covering: boolean,
  layer?: number,
): () => void {
  const covers = useContext(ViewCoversContext);
  useEffect(() => {
    const element = ref.current;
    if (covers === null || element === null || !covering) return;
    return covers.add(element, layer);
  }, [covers, ref, covering, layer]);
  return useCallback(() => covers?.changed(), [covers]);
}

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
}

export function EmbeddedView(props: EmbeddedViewProps) {
  const { views, app, mode, release, screen, size, label, onState } = props;
  const project = props.project;
  const cardMessage = props.card?.message;
  const cardBlock = props.card?.block;
  const shown = props.shown ?? true;
  const ref = useRef<HTMLDivElement | null>(null);
  const covers = useContext(ViewCoversContext);
  const layer = useContext(ViewLayerContext);
  const keeps = useContext(ViewKeepsContext);
  const keepKey = keeps === null ? undefined : props.keepKey;
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const relayRef = useRef<{ refresh(): void } | null>(null);
  const fallbackCovers = useMemo(createViewCovers, []);
  const [viewSession, setViewSession] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("opening");
  const [failure, setFailure] = useState("unavailable");
  const [attempt, setAttempt] = useState(0);
  const stateListener = useRef(onState);
  stateListener.current = onState;
  const failedListener = useRef(props.onFailed);
  failedListener.current = props.onFailed;
  // 보관할 때 함께 넘길 마지막 state.
  const lastState = useRef<AppFrameViewState | null>(null);

  // 여는 동안 이 자리가 사라지면 늦게 온 view를 바로 닫는다(keepKey가 있으면 보관한다).
  useEffect(() => {
    let alive = true;
    setPhase("opening");
    lastState.current = null;
    const input: AppViewOpen = {
      app,
      mode,
      screen,
      size,
      ...(release === undefined ? {} : { release }),
      ...(project === undefined ? {} : { project }),
      ...(cardMessage === undefined || cardBlock === undefined
        ? {}
        : { card: { message: cardMessage, block: cardBlock } }),
    };
    const signature = [app, mode, release, project, screen, size].join("\n");
    const dispose = (state: AppFrameViewState) => {
      if (keepKey !== undefined && keeps !== null) {
        keeps.put(keepKey, {
          session: state.view_session,
          signature,
          state,
        });
      } else {
        void views.closeView({ view_session: state.view_session })
          .catch(() => {});
      }
    };
    const show = (state: AppFrameViewState) => {
      lastState.current = state;
      setViewSession(state.view_session);
      setPhase("ready");
      stateListener.current?.(state);
    };
    const kept = keepKey === undefined || keeps === null
      ? undefined
      : keeps.take(keepKey, signature);
    if (kept !== undefined) {
      show(kept.state);
    } else {
      views.openApp(input).then(
        (state) => {
          if (!alive) {
            dispose(state);
            return;
          }
          show(state);
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
      if (lastState.current !== null) {
        dispose(lastState.current);
      }
    };
  }, [
    views,
    keeps,
    keepKey,
    app,
    mode,
    release,
    project,
    screen,
    size,
    cardMessage,
    cardBlock,
    attempt,
  ]);

  useEffect(() => {
    if (viewSession === null) return;
    return views.subscribeViewState((state) => {
      if (state.view_session === viewSession) {
        lastState.current = state;
        stateListener.current?.(state);
      }
    });
  }, [views, viewSession]);

  // 보이는 동안만 사각형을 보낸다. 안 보이게 되면 cleanup에서 바로 숨긴다. main은 bounds를
  // 받기 전의 view를 붙이지 않으므로 처음부터 안 보이는 view는 숨길 것이 없다.
  useEffect(() => {
    const element = ref.current;
    if (viewSession === null || element === null || !shown) return;
    const hide = () =>
      void views.setViewsHidden({ view_sessions: [viewSession] })
        .catch(() => {});
    const list = covers ?? fallbackCovers;
    const relay = startBoundsRelay({
      element,
      covers: list.list,
      onCoversChange: list.subscribe,
      layer: () => layerRef.current,
      send: (bounds: Rect, layer: number) =>
        void views.setViewBounds({ view_session: viewSession, bounds, layer })
          .catch(() => {}),
      hide,
      frame: {
        request: (callback) => requestAnimationFrame(callback),
        cancel: (handle) => cancelAnimationFrame(handle),
      },
      observe(elements, callback) {
        const observer = new ResizeObserver(callback);
        for (const target of elements) observer.observe(target);
        return () => observer.disconnect();
      },
    });
    relayRef.current = relay;
    return () => {
      relayRef.current = null;
      relay.stop();
      hide();
    };
  }, [views, viewSession, shown, covers, fallbackCovers]);

  // 층만 바뀌면 view를 숨기지 않고 새 층을 다시 보낸다(effect를 다시 돌리면 hide로 깜빡인다).
  useEffect(() => {
    relayRef.current?.refresh();
  }, [layer]);

  const retry = () => setAttempt((count) => count + 1);

  return (
    <div
      ref={ref}
      className={styles.region}
      data-phase={phase}
      data-shown={shown}
    >
      {phase === "failed"
        ? (props.renderFailure?.(failure, retry) ?? (
          <ErrorState target={label} onRetry={retry} />
        ))
        : (
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
