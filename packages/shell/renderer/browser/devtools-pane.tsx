// DevTools 자리. DevTools는 main이 page에 붙인 native view라(<webview>는 DevTools를 담지 못한다) 이
// 자리는 사각형만 main에 보낸다. 자리를 옮겨도 main이 같은 view를 옮길 뿐 다시 열지 않는다.
import { useRef } from "react";

import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import type { OverlayApi, OverlayIdentity } from "../../ipc/overlay.ts";
import { useViewBounds } from "../app-frame/embedded-view.tsx";
import { overlayConsumer } from "../overlay/consumer.ts";
import styles from "./browser-tab.module.css";

export function DevtoolsPane(
  props: { views: LophnShellViewsApi; session: string; shown: boolean },
) {
  const ref = useRef<HTMLDivElement | null>(null);
  useViewBounds({
    views: props.views,
    viewSession: props.session,
    shown: props.shown,
    ref,
  });
  return <div ref={ref} className={styles.devtools} data-devtools="" />;
}

let drags = 0;

/**
 * DevTools 경계를 끄는 동안 창 본문 전체를 덮는 overlay drag 표면을 띄운다. 경계 옆의 page
 * `<webview>`와 DevTools native view는 shell DOM보다 먼저 pointer를 가져가서 DOM drag가 멈춘다.
 * overlay는 그 위에 그려지므로 놓을 때까지 pointer가 끊기지 않는다. 표면은 아무것도 그리지 않는다.
 * `origin`은 pointer를 잴 기준점(창 좌표, 본문 안)이다. `move`는 그 점에서 pointer까지의 거리를 받는다.
 */
export function startOverlayDrag(
  overlay: OverlayApi,
  origin: { x: number; y: number },
  drag: {
    move(dx: number, dy: number): void;
    finish(done: boolean): void;
  },
): void {
  const requestId = `devtools-drag-${++drags}`;
  let ended = false;
  let identity: OverlayIdentity | null = null;
  // 표면이 뜨기 전에 놓으면 pointerup은 shell에 온다. 그때는 표면을 닫고 끝낸다.
  const early = () => {
    if (identity !== null) void overlay.close(identity);
    end(true);
  };
  document.addEventListener("pointerup", early, { once: true });
  const end = (done: boolean) => {
    if (ended) return;
    ended = true;
    document.removeEventListener("pointerup", early);
    consumer.dispose();
    drag.finish(done);
  };
  const consumer = overlayConsumer(overlay, (result) => {
    if (result.type === "pointer") {
      drag.move(result.bounds.width, result.bounds.height);
    } else if (result.type !== "query") {
      end(result.type === "closed" && result.reason === "completed");
    }
  }, () => end(false));
  const x = Math.round(origin.x);
  const y = Math.round(origin.y);
  void consumer.open({
    requestId,
    kind: "drag",
    anchorRect: { x, y, width: 1, height: 1 },
    model: { label: "", choices: [] },
  }, document.body).then((opened) => {
    if (!opened.ok) end(false);
    else if (ended) void overlay.close(opened.value);
    else identity = opened.value;
  });
}
