// 앱 전용 창. 앱 화면 하나만 창 본문 전체에 그린다(앱 공간·패널의 화면과 같은 <webview> 그릇).
// 위쪽 끌기 바에 앱 이름과 창 단추만 두고, 다른 공간으로 가는 길은 두지 않는다.
import { useEffect, useMemo, useState } from "react";

import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import { TopBar } from "../desktop/top-bar/top-bar.tsx";
import { useAppViews } from "./app-views.tsx";
import { EmbeddedView } from "./embedded-view.tsx";
import {
  createWebviewHost,
  WebviewHostProvider,
  WebviewLayer,
} from "./webview-host.tsx";
import styles from "./app-window.module.css";

interface AppWindowProps {
  app: string;
  release: string;
  screen: string;
  views: LophnShellViewsApi;
}

export function AppWindow({ app, release, screen, views }: AppWindowProps) {
  const deps = useAppViews();
  const [name, setName] = useState(app);
  useEffect(() => {
    if (deps === null) return;
    let live = true;
    void deps.app(app).then((read) => {
      if (live && read.ok) setName(read.value.name);
    });
    return () => {
      live = false;
    };
  }, [deps, app]);
  const webviews = useMemo(createWebviewHost, []);
  return (
    <WebviewHostProvider value={webviews}>
      <div className={styles.window} data-app-window={app}>
        <TopBar
          leading={
            <span className={styles.title} data-app-window-title="">
              {name}
            </span>
          }
        />
        <div className={styles.body}>
          <EmbeddedView
            views={views}
            app={app}
            mode="live"
            release={release}
            screen={screen}
            size="full"
            label={name}
          />
          <WebviewLayer host={webviews} />
        </div>
      </div>
    </WebviewHostProvider>
  );
}
