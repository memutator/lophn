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
import styles from "./embedded-view.module.css";

const ViewCoversContext = createContext<ViewCovers | null>(null);

/** 창마다 하나. 본문을 덮는 패널과 앱 view 자리가 같은 목록을 본다. */
export const ViewCoversProvider = ViewCoversContext.Provider;
export { createViewCovers };

/**
 * 좁은 창에서 본문을 덮는 패널(대화·정보·운영 패널)이 부른다. 덮는 동안 앱 view는 숨지 않고
 * 덮이지 않는 영역으로 줄고, 닫으면 원래 bounds로 돌아온다.
 */
export function useViewCover(
  ref: { readonly current: Element | null },
  covering: boolean,
): void {
  const covers = useContext(ViewCoversContext);
  useEffect(() => {
    const element = ref.current;
    if (covers === null || element === null || !covering) return;
    return covers.add(element);
  }, [covers, ref, covering]);
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
  const fallbackCovers = useMemo(createViewCovers, []);
  const [viewSession, setViewSession] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("opening");
  const [failure, setFailure] = useState("unavailable");
  const [attempt, setAttempt] = useState(0);
  const stateListener = useRef(onState);
  stateListener.current = onState;
  const failedListener = useRef(props.onFailed);
  failedListener.current = props.onFailed;

  // 여는 동안 이 자리가 사라지면 늦게 온 view를 바로 닫는다.
  useEffect(() => {
    let alive = true;
    let opened: string | null = null;
    setPhase("opening");
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
    views.openApp(input).then(
      (state) => {
        if (!alive) {
          void views.closeView({ view_session: state.view_session })
            .catch(() => {});
          return;
        }
        opened = state.view_session;
        setViewSession(state.view_session);
        setPhase("ready");
        stateListener.current?.(state);
      },
      (error: unknown) => {
        if (!alive) return;
        const code = error instanceof Error ? error.message : "unavailable";
        setFailure(code);
        setPhase("failed");
        failedListener.current?.(code);
      },
    );
    return () => {
      alive = false;
      setViewSession(null);
      if (opened !== null) {
        void views.closeView({ view_session: opened }).catch(() => {});
      }
    };
  }, [
    views,
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
      send: (bounds: Rect) =>
        void views.setViewBounds({ view_session: viewSession, bounds })
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
    return () => {
      relay.stop();
      hide();
    };
  }, [views, viewSession, shown, covers, fallbackCovers]);

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
