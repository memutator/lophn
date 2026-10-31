// DevTools 자리. DevTools는 main이 page에 붙인 native view라(<webview>는 DevTools를 담지 못한다) 이
// 자리는 사각형만 main에 보낸다. 자리를 옮겨도 main이 같은 view를 옮길 뿐 다시 열지 않는다.
import { useRef } from "react";

import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import { useViewBounds } from "./native-bounds.ts";
import styles from "./browser-tab.module.css";

export function DevtoolsPane(props: {
  views: LophnShellViewsApi;
  session: string;
  shown: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useViewBounds({
    views: props.views,
    viewSession: props.session,
    shown: props.shown,
    ref,
  });
  return <div ref={ref} className={styles.devtools} data-devtools="" />;
}
