// 프로젝트 작업대의 앱 패널 탭. blueprint가 panel
// 크기를 선언한 화면만 탭에 열고, 전체 화면만 선언한 앱은 앱 공간으로 열기를 안내한다. 탭의
// 앱 view는 앱 공간과 같은 앱·판·mode 신원과 격리로 main이 열고(size만 panel), 크롬은 이 탭의
// shell renderer가 그린다. 탭이 안 보이면 view를 남긴 채 숨기고, 닫으면 폐기한다.
import { useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  ErrorState,
  List,
  ListItem,
  Loading,
  Skeleton,
} from "@lophn/design/components";
import { workspaceIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import type { AppFrameViewState } from "../../ipc/app-frame.ts";
import {
  type AppRead,
  type AppScreens,
  type ScreensRead,
  useAppViews,
} from "../app-frame/app-views.tsx";
import { EmbeddedView } from "../app-frame/embedded-view.tsx";
import { ViewChrome } from "../app-frame/view-chrome.tsx";
import styles from "./app-panel-tab.module.css";

/** 탭에 고른 앱 화면. 제목은 사람이 지은 앱 이름이다. */
export interface PanelChoice {
  readonly app: string;
  readonly screen: string;
  readonly title: string;
}

/** 패널을 선언한 화면만 고를 수 있다. 하나도 없으면 앱 공간으로 열기를 안내한다. */
export function panelScreens(app: AppScreens): AppScreens["screens"] {
  return app.screens.filter((screen) => screen.sizes.includes("panel"));
}

export interface AppPanelPickerProps {
  onChoose: (choice: PanelChoice) => void;
  /** 앱 공간 열기. 없으면 안내 글만 둔다. */
  onOpenAppSpace?: (app: string) => void;
  onClose: () => void;
}

/** 앱을 아직 고르지 않은 앱 패널 탭의 본문. native view가 없어 shell이 다 그린다. */
export function AppPanelPicker(
  { onChoose, onOpenAppSpace, onClose }: AppPanelPickerProps,
) {
  const deps = useAppViews();
  const [read, setRead] = useState<ScreensRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setRead(null);
    if (deps?.screens === undefined) {
      setRead({ ok: false });
      return;
    }
    void deps.screens().then((value) => {
      if (live) setRead(value);
    });
    return () => {
      live = false;
    };
  }, [deps, attempt]);

  let body;
  if (read !== null && !read.ok) {
    body = (
      <ErrorState
        target={t("project-workspace.label.choose-app")}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    );
  } else if (read !== null && read.value.length === 0) {
    body = (
      <EmptyState
        icon={workspaceIcons.appPanel}
        message={t("app-panel.empty.no-apps")}
        action={{ label: t("common.button.close"), onSelect: onClose }}
      />
    );
  } else {
    body = (
      <Loading
        loading={read === null}
        placeholder={<Skeleton lines={4} />}
      >
        <List>
          {(read?.ok ? read.value : []).flatMap((app) => {
            const screens = panelScreens(app);
            if (screens.length === 0) {
              return [
                <li
                  key={app.app}
                  className={styles.spaceOnly}
                  data-app-space-only={app.app}
                >
                  <span className={styles.note}>
                    {t("app-panel.notice.app-space-only", { app: app.name })}
                  </span>
                  {onOpenAppSpace === undefined ? null : (
                    <Button
                      size="sm"
                      onClick={() => onOpenAppSpace(app.app)}
                    >
                      {t("app-panel.button.open-app-space")}
                    </Button>
                  )}
                </li>,
              ];
            }
            return screens.map((screen) => (
              <ListItem
                key={`${app.app}:${screen.key}`}
                title={t("app-panel.label.screen", {
                  app: app.name,
                  screen: screen.label,
                })}
                onSelect={() =>
                  onChoose({
                    app: app.app,
                    screen: screen.key,
                    title: app.name,
                  })}
              />
            ));
          })}
        </List>
      </Loading>
    );
  }
  return (
    <div className={styles.picker} data-app-panel-picker="">
      <h1 className={styles.heading}>{t("app-panel.title.choose")}</h1>
      {body}
    </div>
  );
}

export interface AppPanelTabProps {
  app: string;
  screen: string;
  /** 칸에 보이는 고른 탭인지. false면 view를 남긴 채 숨긴다. */
  shown: boolean;
  onOpenAppSpace?: (app: string) => void;
  /** 이 탭이 연 view의 session. view가 서면 알리고 내려가면 null이다(현재 보기 힌트가 쓴다). */
  onSession?: (view_session: string | null) => void;
}

type Facts = AppRead | null;

/** 고른 앱 화면 하나를 panel 크기로 연 탭 본문. */
export function AppPanelTab(
  { app, screen, shown, onOpenAppSpace, onSession }: AppPanelTabProps,
) {
  const deps = useAppViews();
  const [facts, setFacts] = useState<Facts>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AppFrameViewState | null>(null);
  useEffect(() => {
    if (deps === null) return;
    let live = true;
    setFacts(null);
    void deps.app(app).then((read) => {
      if (live) setFacts(read);
    });
    return () => {
      live = false;
    };
  }, [deps, app, attempt]);

  const session = state?.view_session ?? null;
  useEffect(() => {
    onSession?.(session);
    return () => onSession?.(null);
  }, [session]);

  const notice = (message: string, space: boolean) => (
    <div className={styles.notice} data-app-panel-notice="">
      <p className={styles.note}>{message}</p>
      {space && onOpenAppSpace !== undefined
        ? (
          <Button
            size="sm"
            onClick={() => onOpenAppSpace(app)}
          >
            {t("app-panel.button.open-app-space")}
          </Button>
        )
        : null}
    </div>
  );

  if (deps === null) return notice(t("common.empty.not-ready"), false);
  if (facts === null) {
    return (
      <Loading loading placeholder={<Skeleton lines={3} />}>{null}</Loading>
    );
  }
  if (!facts.ok && facts.code === "unavailable") {
    return (
      <ErrorState
        target={t("project-workspace.label.kind-app-panel")}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    );
  }
  if (!facts.ok || facts.value.archived) {
    return notice(t("app-panel.notice.app-gone"), false);
  }
  const release = facts.value.release;
  if (release === null) return notice(t("app-panel.notice.no-version"), false);
  return (
    <div className={styles.panel} data-app-panel={app} data-screen={screen}>
      <ViewChrome
        name={facts.value.name}
        mode="live"
        connection={state?.connectionState ?? null}
        viewSession={state?.view_session ?? null}
        onReport={deps.report}
        health={state?.viewHealth}
        onReopen={(view_session) =>
          void deps.views.reopenView({ view_session }).catch(() => {})}
      />
      <div className={styles.view}>
        <EmbeddedView
          views={deps.views}
          app={app}
          mode="live"
          release={release}
          screen={screen}
          size="panel"
          label={facts.value.name}
          shown={shown}
          onState={setState}
          renderFailure={(code) =>
            // 패널을 선언하지 않은 화면은 줄여 열지 않고 앱 공간으로 안내한다.
            code === "invalid_input" || code === "forbidden"
              ? notice(t("app-panel.notice.not-panel"), true)
              : null}
        />
      </div>
    </div>
  );
}
