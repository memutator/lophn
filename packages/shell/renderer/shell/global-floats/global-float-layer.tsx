// 전역 float 층. Desktop이 `{space}` 옆에 한 번 놓는다(workspace 창 밖이라 workspace를 바꿔도 다시 mount되지 않고, 그 안의
// <webview> page도 다시 load되지 않는다). 본문은 앱 panel 탭 그대로이고, 바깥을 누르면 고정 안 한 펼친 것이 접힌다.

import { useObservedSize } from "@lophn/ui/shared";
import { useRef } from "react";

import { AppTabIcon } from "../../app-frame/app-icon.tsx";
import { ViewKeepsProvider } from "../../app-frame/embedded-view.tsx";
import {
  WebviewHostProvider,
  WebviewLayer,
} from "../../app-frame/webview-host.tsx";
import { AppPanelTab } from "../../workspace/app-panel-tab.tsx";
import { TabBoundary } from "../../workspace/tab-boundary.tsx";
import { FloatLayer } from "../float-layer.tsx";
import styles from "./global-float-layer.module.css";
import { useGlobalFloats, useGlobalFloatsHost } from "./global-floats.tsx";

export function GlobalFloatLayer({
  onOpenApp,
}: {
  /** 앱 panel을 선언하지 않은 화면을 앱 공간으로 안내하는 길. */
  onOpenApp?: (app: string) => void;
}) {
  const floats = useGlobalFloats();
  const host = useGlobalFloatsHost();
  const ref = useRef<HTMLDivElement>(null);
  const size = useObservedSize(ref);
  if (host === null) return null;
  // 0이면 못 잰 것과 같다(0x0으로 가둔 rect는 저장이 거절된다).
  const area =
    size !== undefined && size.width > 0 && size.height > 0 ? size : undefined;
  return (
    <div className={styles.layer} data-global-floats="">
      <ViewKeepsProvider value={host.keeps}>
        <WebviewHostProvider value={host.webviews}>
          <WebviewLayer host={host.webviews} />
          <FloatLayer
            layerRef={ref}
            area={area}
            floats={floats.floats
              .filter((item) => !item.minimized)
              .map((item) => ({
                key: item.key,
                title: item.title,
                icon: <AppTabIcon app={item.app} />,
                rect: item.rect,
                pinned: item.pinned,
                global: true,
                appHead: true,
                body: (
                  <TabBoundary key={item.key}>
                    <AppPanelTab
                      app={item.app}
                      screen={item.screen}
                      shown
                      keepKey={item.key}
                      onOpenAppSpace={onOpenApp}
                    />
                  </TabBoundary>
                ),
              }))}
            onRaise={floats.expand}
            onRect={floats.setRect}
            onMinimize={floats.minimize}
            {...(floats.canMoveToDesk ? { onGlobal: floats.moveToDesk } : {})}
            onClose={floats.close}
            onPin={floats.pin}
            onOutside={floats.minimizeLoose}
          />
        </WebviewHostProvider>
      </ViewKeepsProvider>
    </div>
  );
}
