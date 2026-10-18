// browser 탭 kind. url만 저장하고 title은 page가 알려 주는 대로 탭 이름에 쓴다.
import { t } from "@lophn/wording";

import { BrowserTab } from "../../browser/browser-tab.tsx";
import { Favicon } from "../../browser/favicon.tsx";
import { browserIcons } from "../../icons/mod.ts";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

const MAX_URL = 8192;

let browserCount = 0;

/** 탭 이름: page title, 없으면 url의 host, 그것도 없으면 종류 이름. */
function nameOf(title: string, url: string): string {
  if (title !== "") return title;
  try {
    const host = new URL(url).host;
    if (host !== "") return host;
  } catch {
    // 주소가 아니면 종류 이름이다.
  }
  return t("browser.label.kind");
}

function newKey(): string {
  return `browser-${Date.now().toString(36)}-${++browserCount}`;
}

/** 사람이 연 새 browser 탭. 빈 url이면 빈 주소 칸으로 열린다. */
export function openBrowserTab(host: TabHost, url?: string): void {
  host.openTab({
    key: newKey(),
    kind: "browser",
    title: nameOf("", url ?? ""),
    fields: { url: url ?? "" },
  });
}

export const browserKind: TabKindDef = {
  kind: "browser",
  labelKey: "browser.label.kind",
  icon: browserIcons.globe,
  // page favicon(main이 준 data URL). 저장하지 않으므로 다시 열면 page가 다시 알린다.
  iconOf(tab) {
    const favicon = tab.fields?.favicon;
    return <Favicon src={typeof favicon === "string" ? favicon : undefined} />;
  },
  fromStored(stored, { key }) {
    const { url } = stored;
    if (typeof url !== "string" || url.length > MAX_URL) return null;
    return {
      key,
      kind: "browser",
      title: nameOf("", url),
      fields: { url },
    };
  },
  toStored(tab) {
    const url = tab.fields?.url;
    if (typeof url !== "string" || url.length > MAX_URL) return null;
    return { kind: "browser", key: tab.key, url };
  },
  // 다른 탭으로 가도 page가 살아 있도록 keep만 쓴다. 숨김은 BrowserTab이 shown으로 맡는다.
  keep(tab, shown, host) {
    const url = tab.fields?.url;
    const adopt = tab.fields?.adopt;
    // floated 탭의 층(floats index + 1). pane 탭은 0이다.
    const layer =
      host.view.floats.findIndex((item) => item.tab.key === tab.key) +
      1;
    return (
      <BrowserTab
        url={typeof url === "string" ? url : ""}
        adopt={typeof adopt === "string" ? adopt : undefined}
        native={tab.fields?.native === true}
        layer={layer}
        shown={shown}
        keeps={host.viewKeeps}
        keepKey={tab.key}
        onAdopted={() =>
          host.patchTab(tab.key, (current) => ({
            fields: { ...current.fields, adopt: undefined },
          }))}
        // 크기를 준 popup만 native view로 floated 탭에 뜬다(opener를 지킨다). 크기 없는 것은 main이
        // 거절하고 open-tab으로 알린다.
        onPopup={(event) => {
          host.openFloat({
            key: newKey(),
            kind: "browser",
            title: nameOf("", ""),
            fields: { url: "", adopt: event.view_session, native: true },
            transient: true,
          }, event.placement.kind === "floated" ? event.placement : undefined);
        }}
        onOpenTab={(next) =>
          host.openTab({
            key: newKey(),
            kind: "browser",
            title: nameOf("", next),
            fields: { url: next },
          }, { after: tab.key })}
        // native popup을 dock하면 지금 주소의 webview 탭으로 다시 연다(page가 다시 load된다).
        onDocked={() =>
          host.patchTab(tab.key, (current) => ({
            fields: { ...current.fields, adopt: undefined, native: undefined },
          }))}
        onCloseRequested={() => host.removeTab(tab.key)}
        onOpenInNewTab={(next) => openBrowserTab(host, next)}
        onState={(state) =>
          host.patchTab(tab.key, (current) => ({
            title: nameOf(state.title, state.url),
            fields: {
              ...current.fields,
              url: state.url,
              favicon: state.favicon,
            },
          }), { later: true })}
      />
    );
  },
};
