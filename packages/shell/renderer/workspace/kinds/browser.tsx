// browser 탭 kind. url만 저장하고 title은 page가 알려 주는 대로 탭 이름에 쓴다.
import { t } from "@lophn/i18n";

import type { BrowserViewState } from "../../../ipc/browser.ts";
import { BrowserTab, KEEP_SIGNATURE } from "../../browser/browser-tab.tsx";
import { Favicon } from "../../browser/favicon.tsx";
import { browserIcons } from "../../icons/mod.ts";
import { readDevtools, setDevtools } from "./browser-devtools.tsx";
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
  // 보통 탭은 옮길 상태가 없다(받는 창이 저장된 url을 다시 load한다). 크기 준 popup의 native view는
  // 닫지 않고 옮겨 window.opener를 지킨다.
  transfer(tab, host) {
    const devtools = readDevtools(tab.fields?.devtools);
    if (tab.fields?.native !== true) {
      // DevTools frontend는 옛 page가 사라지면 끊기므로 같이 닫는다.
      if (devtools !== null) setDevtools(host, tab.key, null);
      return Promise.resolve({ value: null, views: [] });
    }
    // 아직 adopt 중이면 옮길 view가 없으니 탭을 그대로 둔다.
    const kept = host.viewKeeps.lookup<BrowserViewState>(tab.key);
    if (kept === undefined) return Promise.resolve(null);
    const views = [kept.session];
    if (devtools !== null) {
      views.push(devtools.session);
      // floated DevTools 패널은 대상 탭과 같은 창에 있어야 해서 탭 안으로 바꿔 옮긴다.
      if (devtools.place === "float") {
        setDevtools(host, tab.key, { ...devtools, place: "right" });
      }
    }
    return Promise.resolve({ value: { state: kept.state }, views });
  },
  // 받는 창의 BrowserTab이 mount될 때 take로 이 view를 이어 쓴다. DevTools는 탭의 fields.devtools가 이끈다.
  receive(tab, transfer, host) {
    const [session] = transfer.views;
    const state = (transfer.value as { state?: BrowserViewState } | null)
      ?.state;
    if (
      tab.fields?.native !== true ||
      session === undefined ||
      state?.view_session !== session
    )
      return;
    host.viewKeeps.put(tab.key, { session, signature: KEEP_SIGNATURE, state });
  },
  // 다른 탭으로 가도 page가 살아 있도록 keep만 쓴다. 숨김은 BrowserTab이 shown으로 맡는다.
  keep(tab, shown, host) {
    const url = tab.fields?.url;
    const adopt = tab.fields?.adopt;
    // floated 탭의 층(FloatLayer에 가는 펴진 float의 index + 1). detached 창의 탭은 1(그 창의 유일한 view라
    // card의 탭으로 오인돼 dock되지 않게 한다). card의 탭은 0이다.
    const floated =
      host.desk.floats
        .filter((item) => !item.minimized)
        .findIndex((item) => item.tab.key === tab.key) + 1;
    const layer =
      floated > 0 ||
      !host.desk.detached.some((item) => item.tab.key === tab.key)
        ? floated
        : 1;
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
          }))
        }
        // 크기를 준 popup만 native view로 floated 탭에 뜬다(opener를 지킨다). 크기 없는 것은 main이
        // 거절하고 open-tab으로 알린다.
        onPopup={(event) => {
          host.openFloat(
            {
              key: newKey(),
              kind: "browser",
              title: nameOf("", ""),
              fields: { url: "", adopt: event.view_session, native: true },
              transient: true,
            },
            event.placement.kind === "floated" ? event.placement : undefined,
          );
        }}
        onOpenTab={(next) =>
          host.openTab(
            {
              key: newKey(),
              kind: "browser",
              title: nameOf("", next),
              fields: { url: next },
            },
            { after: tab.key },
          )
        }
        // native popup을 dock하면 지금 주소의 webview 탭으로 다시 연다(page가 다시 load된다).
        onDocked={() =>
          host.patchTab(tab.key, (current) => ({
            fields: { ...current.fields, adopt: undefined, native: undefined },
          }))
        }
        onCloseRequested={() => host.removeTab(tab.key)}
        onOpenInNewTab={(next) => openBrowserTab(host, next)}
        // DevTools 자리는 fields에 둔다(저장하지 않는다). Float·Dock으로 다시 mount되어도 남는다.
        devtools={readDevtools(tab.fields?.devtools)}
        onDevtools={(next, later) =>
          setDevtools(host, tab.key, next, { later: later === true })
        }
        onState={(state) =>
          host.patchTab(
            tab.key,
            (current) => ({
              title: nameOf(state.title, state.url),
              fields: {
                ...current.fields,
                url: state.url,
                favicon: state.favicon,
              },
            }),
            { later: true },
          )
        }
      />
    );
  },
};
