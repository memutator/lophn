// 프로젝트 작업대의 앱 패널 탭. 선언이 panel
// 크기를 선언한 화면만 탭에 열고, 전체 화면만 선언한 앱은 앱 공간으로 열기를 안내한다. 탭의
// 앱 view는 앱 공간과 같은 앱·판·mode 신원과 격리로 main이 열고(size만 panel), 크롬은 이 탭의
// shell renderer가 그린다. 탭이 안 보이거나 다시 mount돼도 view는 남겨 숨기고, 탭이
// layout에서 사라지면 폐기한다.
import { useEffect, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { List, ListItem } from "@lophn/ui/data";
import { EmptyState, ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { actionIcons, workspaceIcons } from "../icons/mod.ts";
import { t } from "@lophn/i18n";

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

/**
 * 앱 화면 목록 읽기. 앱 패널 picker와 activity bar가 같이 쓴다. `enabled`가 false면 읽지 않는다.
 * null은 읽는 중이다.
 */
export function useScreensRead(enabled = true): {
  read: ScreensRead | null;
  retry: () => void;
} {
  const deps = useAppViews();
  const [read, setRead] = useState<ScreensRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
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
  }, [deps, attempt, enabled]);
  return { read, retry: () => setAttempt((count) => count + 1) };
}

/** 고를 수 있는 (앱, panel 화면) 목록. label은 "앱 · 화면"이다. picker와 activity bar의 + menu가 같이 쓴다. */
export function panelChoices(
  apps: readonly AppScreens[],
): readonly (PanelChoice & { readonly label: string })[] {
  return apps.flatMap((app) =>
    panelScreens(app).map((screen) => ({
      app: app.app,
      screen: screen.key,
      title: app.name,
      label: t("app-panel.label.screen", {
        app: app.name,
        screen: screen.label,
      }),
    })),
  );
}

interface AppPanelPickerProps {
  onChoose: (choice: PanelChoice) => void;
  /** 앱 공간 열기. 없으면 안내 글만 둔다. */
  onOpenAppSpace?: (app: string) => void;
  onClose: () => void;
}

/** 앱을 아직 고르지 않은 앱 패널 탭의 본문. 앱 화면 없이 shell이 다 그린다. */
export function AppPanelPicker({
  onChoose,
  onOpenAppSpace,
  onClose,
}: AppPanelPickerProps) {
  const { read, retry } = useScreensRead();

  let body;
  if (read !== null && !read.ok) {
    body = (
      <ErrorState
        target={t("project-workspace.label.choose-app")}
        onRetry={retry}
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
      <Loading loading={read === null} placeholder={<Skeleton lines={4} />}>
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
                      trailingIcon={actionIcons.open}
                      onClick={() => onOpenAppSpace(app.app)}
                    >
                      {t("app-panel.button.open-app-space")}
                    </Button>
                  )}
                </li>,
              ];
            }
            return panelChoices([app]).map((choice) => (
              <ListItem
                key={`${choice.app}:${choice.screen}`}
                title={choice.label}
                onSelect={() =>
                  onChoose({
                    app: choice.app,
                    screen: choice.screen,
                    title: choice.title,
                  })
                }
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

interface AppPanelTabProps {
  app: string;
  screen: string;
  /** 칸에 보이는 고른 탭인지. false면 view를 남긴 채 숨긴다. */
  shown: boolean;
  /** Float·Dock·접기로 다시 mount해도 view를 이어 쓰는 이름(탭 key). */
  keepKey?: string;
  onOpenAppSpace?: (app: string) => void;
}

type Facts = AppRead | null;

/** 고른 앱 화면 하나를 panel 크기로 연 탭 본문. */
export function AppPanelTab({
  app,
  screen,
  shown,
  keepKey,
  onOpenAppSpace,
}: AppPanelTabProps) {
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

  const notice = (message: string, space: boolean) => (
    <div className={styles.notice} data-app-panel-notice="">
      <p className={styles.note}>{message}</p>
      {space && onOpenAppSpace !== undefined ? (
        <Button
          size="sm"
          trailingIcon={actionIcons.open}
          onClick={() => onOpenAppSpace(app)}
        >
          {t("app-panel.button.open-app-space")}
        </Button>
      ) : null}
    </div>
  );

  if (deps === null) return notice(t("common.empty.not-ready"), false);
  if (facts === null) {
    return (
      <Loading loading placeholder={<Skeleton lines={3} />}>
        {null}
      </Loading>
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
  // 탭 이름이 이미 앱 이름이라 평소에는 크롬 줄을 두지 않는다. 탭 줄과 앱 화면 사이에 다른 바탕의 줄이
  // 끼면 탭과 본문이 한 면으로 이어지지 않는다. 화면이 멈추거나 앱이 멈췄을 때만 상태와 [Open again]을 띄운다.
  const troubled =
    (state?.viewHealth !== undefined && state.viewHealth !== "ok") ||
    state?.connectionState === "stopped" ||
    state?.connectionState === "unavailable";
  return (
    <div className={styles.panel} data-app-panel={app} data-screen={screen}>
      {troubled ? (
        <ViewChrome
          name={facts.value.name}
          mode="live"
          connection={state?.connectionState ?? null}
          viewSession={state?.view_session ?? null}
          health={state?.viewHealth}
          onReopen={(view_session) =>
            void deps.views.reopenView({ view_session }).catch(() => {})
          }
        />
      ) : null}
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
          keepKey={keepKey}
          onState={setState}
          renderFailure={(code) =>
            // 패널을 선언하지 않은 화면은 줄여 열지 않고 앱 공간으로 안내한다.
            code === "invalid_input" || code === "forbidden"
              ? notice(t("app-panel.notice.not-panel"), true)
              : null
          }
        />
      </div>
    </div>
  );
}
