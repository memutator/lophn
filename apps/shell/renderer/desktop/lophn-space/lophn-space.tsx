import { useRef, useState } from "react";
import { useObservedSize } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { TopBar } from "../top-bar/top-bar.tsx";
import { LauncherButton } from "../../workspace/launcher-button.tsx";
import { Breadcrumbs } from "../../workspace/top-path/breadcrumbs.tsx";
import {
  SIDEBAR_WIDTH,
  type SidebarState,
  sidebarView,
} from "../../workspace/model.ts";
import { DEFAULT_SCREEN, type LophnScreen } from "./model.ts";
import { screenLabel } from "./screens.ts";
import type { LophnSource } from "./source.ts";
import { LophnSidebar } from "./sidebar/sidebar.tsx";
import { DocumentsScreen } from "./documents/documents-screen.tsx";
import styles from "./lophn-space.module.css";

export interface LophnSpaceProps {
  source: LophnSource;
  /** 처음 보일 형제. 없으면 documents다(desktop#R1). */
  screen?: LophnScreen;
  /** 창 폭. 테스트가 고정하고 화면은 관측값을 쓴다. */
  windowWidth: number;
  onLauncher: () => void;
  /** 상대 시각의 기준. 테스트가 고정한다. */
  now?: () => number;
}

// lophn 공간. 왼쪽 sidebar의 일곱 형제 중 하나를 본문에 연다. 대화는 이 화면에 기대지 않는다.
export function LophnSpace(
  { source, screen, windowWidth, onLauncher, now }: LophnSpaceProps,
) {
  const [current, setCurrent] = useState<LophnScreen>(screen ?? DEFAULT_SCREEN);
  const [sidebar, setSidebar] = useState<SidebarState>({
    chosenWidth: SIDEBAR_WIDTH,
    collapsedByUser: false,
  });
  const frameRef = useRef<HTMLDivElement>(null);
  const frameSize = useObservedSize(frameRef);
  const shown = sidebarView(frameSize?.width ?? windowWidth, sidebar, false);

  return (
    <div
      className={styles.space}
      data-space="lophn"
      data-screen={current}
      ref={frameRef}
    >
      <LophnSidebar
        mode={shown.mode}
        width={shown.width}
        current={current}
        onLauncher={onLauncher}
        onToggle={() =>
          setSidebar((state) => ({
            ...state,
            collapsedByUser: shown.mode !== "collapsed",
          }))}
        onOpen={setCurrent}
      />
      <div className={styles.main}>
        <div className={styles.topBar}>
          <TopBar
            leading={
              <span className={styles.leading}>
                {shown.launcherInTopBar
                  ? <LauncherButton onLauncher={onLauncher} />
                  : null}
                <Breadcrumbs
                  crumbs={[
                    { label: t("common.label.lophn-space") },
                    { label: screenLabel(current) },
                  ]}
                />
              </span>
            }
          />
        </div>
        <div className={styles.content}>
          {current === "documents"
            ? <DocumentsScreen source={source} now={now} />
            : (
              <p className={styles.notReady} data-not-ready={current}>
                {t("common.empty.not-ready")}
              </p>
            )}
        </div>
      </div>
    </div>
  );
}
