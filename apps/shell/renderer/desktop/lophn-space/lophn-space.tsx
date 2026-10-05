import { useEffect, useRef, useState } from "react";
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
import type { Catalog, LophnSource } from "./source.ts";
import { LophnSidebar } from "./sidebar/sidebar.tsx";
import {
  DocumentsScreen,
  type ReaderRequest,
} from "./documents/documents-screen.tsx";
import {
  PaletteButton,
  usePaletteEnv,
  usePaletteScope,
} from "../palette/host.tsx";
import { lophnScope } from "../palette/lophn-scope.ts";
import styles from "./lophn-space.module.css";

export interface LophnSpaceProps {
  source: LophnSource;
  /** 처음 보일 형제. 없으면 documents다(desktop#R1). */
  screen?: LophnScreen;
  /** 창 폭. 테스트가 고정하고 화면은 관측값을 쓴다. */
  windowWidth: number;
  onLauncher: () => void;
  /** 프로젝트 작업대로 간다. 창 팔레트의 프로젝트 행이 쓴다. */
  onProject?: (project: string) => void;
  /** 상대 시각의 기준. 테스트가 고정한다. */
  now?: () => number;
}

const EMPTY_CATALOG: Catalog = { projects: [], apps: [], contexts: [] };

// lophn 공간. 왼쪽 sidebar의 일곱 형제 중 하나를 본문에 연다. 대화는 이 화면에 기대지 않는다.
export function LophnSpace(
  { source, screen, windowWidth, onLauncher, onProject, now }: LophnSpaceProps,
) {
  const [current, setCurrent] = useState<LophnScreen>(screen ?? DEFAULT_SCREEN);
  const [sidebar, setSidebar] = useState<SidebarState>({
    chosenWidth: SIDEBAR_WIDTH,
    collapsedByUser: false,
  });
  const frameRef = useRef<HTMLDivElement>(null);
  const frameSize = useObservedSize(frameRef);
  const shown = sidebarView(frameSize?.width ?? windowWidth, sidebar, false);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [reading, setReading] = useState<ReaderRequest | undefined>();

  // 창 팔레트의 프로젝트·컨텍스트·앱 행. 팔레트가 있는 창만 읽고, 읽지 못하면 그 묶음만 빈다.
  const palette = usePaletteEnv();
  useEffect(() => {
    if (!palette.available) return;
    let live = true;
    void source.catalog().then((loaded) => {
      if (live && loaded.ok) setCatalog(loaded.value);
    });
    return () => {
      live = false;
    };
  }, [source, palette.available]);

  // 창 팔레트의 lophn 공간 행(desktop#R30). 고르면 지금 탐색 대상으로만 간다.
  usePaletteScope(() =>
    lophnScope({
      catalog,
      platform: palette.platform,
      search: palette.search
        ? (query) => palette.search!(query, null)
        : undefined,
      go: (target) => {
        if (target.kind === "launcher") onLauncher();
        else if (target.kind === "project") onProject?.(target.id);
        else if (target.kind === "screen") setCurrent(target.screen);
        else if (target.kind === "context") setCurrent("contexts");
        else if (target.kind === "app") setCurrent("apps");
        else {
          setCurrent("documents");
          setReading((last) => ({
            document: target.document,
            version: target.version,
            serial: (last?.serial ?? 0) + 1,
          }));
        }
      },
    })
  );

  return (
    <div
      className={styles.space}
      data-space="lophn"
      data-current-screen={current}
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
            trailing={<PaletteButton />}
          />
        </div>
        <div className={styles.content}>
          {current === "documents"
            ? <DocumentsScreen source={source} now={now} reading={reading} />
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
