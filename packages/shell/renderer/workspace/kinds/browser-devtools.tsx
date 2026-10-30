// browser 탭의 DevTools 자리. 자리는 browser 탭의 `fields.devtools`가 정하고(탭 안 오른쪽·아래, floated
// 패널, 따로 뜬 창), 열고 닫고 창으로 옮기는 일은 그 browser 탭이 한다. 이 파일은 그 값을 바꾸는 길과
// floated 패널로 뜬 DevTools만 그리는 transient 탭 kind다(저장하지 않는다).
import { useEffect, useRef } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import { useAppViews } from "../../app-frame/app-views.tsx";
import { useBrowserApi } from "../../browser/browser-api.tsx";
import { DevtoolsPane } from "../../browser/devtools-pane.tsx";
import styles from "../../browser/browser-tab.module.css";
import { browserIcons } from "../../icons/mod.ts";
import { findTab, type TabItem } from "../model.ts";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

export type DevtoolsPlace = "right" | "bottom" | "float" | "window";

export interface DevtoolsState {
  readonly session: string;
  readonly place: DevtoolsPlace;
  /** 탭 안 자리의 폭(오른쪽)이나 높이(아래). CSS px. */
  readonly size: number;
}

const PLACES: readonly DevtoolsPlace[] = ["right", "bottom", "float", "window"];
const FLOAT_SIZE = { width: 720, height: 480 };

export function readDevtools(value: unknown): DevtoolsState | null {
  if (typeof value !== "object" || value === null) return null;
  const { session, place, size } = value as Record<string, unknown>;
  if (
    typeof session !== "string" ||
    typeof size !== "number" ||
    !PLACES.includes(place as DevtoolsPlace)
  )
    return null;
  return { session, place: place as DevtoolsPlace, size };
}

function floatKey(target: string): string {
  return `browser-devtools-${target}`;
}

/**
 * browser 탭(target)의 DevTools 값을 바꾼다. 자리가 float이면 DevTools 패널 탭을 열고, 아니면 닫는다.
 * 실제 DevTools 열기·닫기·창 옮기기는 값이 바뀐 것을 본 browser 탭이 한다.
 */
export function setDevtools(
  host: TabHost,
  target: string,
  next: DevtoolsState | null,
  options?: { readonly later?: boolean },
): void {
  host.patchTab(
    target,
    (current) => ({
      fields: { ...current.fields, devtools: next ?? undefined },
    }),
    options,
  );
  if (next?.place === "float") {
    host.openFloat(
      {
        key: floatKey(target),
        kind: "browser_devtools",
        title: t("browser.label.devtools"),
        fields: { devtools_session: next.session, target },
        transient: true,
      },
      FLOAT_SIZE,
    );
  } else {
    host.removeTab(floatKey(target));
  }
}

function targetOf(tab: TabItem): string {
  const target = tab.fields?.target;
  return typeof target === "string" ? target : "";
}

function devtoolsOf(host: TabHost, target: string): DevtoolsState | null {
  return readDevtools(findTab(host.view, target)?.fields?.devtools);
}

function DevtoolsFloat(props: { tab: TabItem; shown: boolean; host: TabHost }) {
  const { tab, host } = props;
  const views = useAppViews()?.views;
  const browser = useBrowserApi();
  const session = tab.fields?.devtools_session;
  const target = targetOf(tab);
  const latest = useRef(host);
  latest.current = host;

  // target page가 사라지면(탭이 닫혀) 그 browser 탭이 없으니 이 패널이 스스로 닫는다.
  useEffect(() => {
    if (browser === null || typeof session !== "string") return;
    return browser.subscribeEvents((event) => {
      if (
        event.kind === "devtools-closed" &&
        event.devtools_session === session
      ) {
        latest.current.removeTab(tab.key);
      }
    });
  }, [browser, session, tab.key]);

  if (views === undefined || typeof session !== "string") return null;
  const move = (place: DevtoolsPlace) => {
    const current = devtoolsOf(host, target);
    if (current !== null) setDevtools(host, target, { ...current, place });
  };
  return (
    <div className={styles.devtoolsFloat}>
      <div className={styles.devtoolsBar}>
        <IconButton
          icon={browserIcons.devtoolsRight}
          label={t("browser.button.devtools-dock")}
          size="sm"
          onClick={() => move("right")}
        />
        <IconButton
          icon={browserIcons.devtoolsWindow}
          label={t("browser.button.devtools-window")}
          size="sm"
          onClick={() => move("window")}
        />
      </div>
      <DevtoolsPane views={views} session={session} shown={props.shown} />
    </div>
  );
}

export const browserDevtoolsKind: TabKindDef = {
  kind: "browser_devtools",
  labelKey: "browser.label.devtools",
  icon: browserIcons.inspect,
  // 닫으면 DevTools도 닫는다. 다시 열 수 있는 page 상태가 아니다.
  noReopen: true,
  // 대상 browser 탭의 fields.devtools에 묶여, 따로 떼면 대상 탭을 바꿀 수 없다.
  noDetach: true,
  fromStored: () => null,
  toStored: () => null,
  keep: (tab, shown, host) => (
    <DevtoolsFloat tab={tab} shown={shown} host={host} />
  ),
  // 사람이 패널을 닫으면 browser 탭의 값을 지운다. 그 탭이 DevTools를 닫는다.
  beforeClose(tab, host) {
    setDevtools(host, targetOf(tab), null);
    return null;
  },
};
