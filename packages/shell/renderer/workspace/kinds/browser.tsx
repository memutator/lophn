// browser 탭 kind. url만 저장하고 title은 page가 알려 주는 대로 탭 이름에 쓴다.
import { t } from "@lophn/wording";

import { BrowserTab } from "../../browser/browser-tab.tsx";
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

/** 사람이 연 새 browser 탭. 빈 url이면 빈 주소 칸으로 열린다. */
export function openBrowserTab(host: TabHost, url?: string): void {
  const key = `browser-${Date.now().toString(36)}-${++browserCount}`;
  host.openTab({
    key,
    kind: "browser",
    title: nameOf("", url ?? ""),
    fields: { url: url ?? "" },
  });
}

export const browserKind: TabKindDef = {
  kind: "browser",
  labelKey: "browser.label.kind",
  icon: browserIcons.globe,
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
  // 다른 탭으로 가도 page가 살아 있도록 keep만 쓴다. view의 숨김은 BrowserTab이 shown으로 맡는다.
  keep(tab, shown, host) {
    const url = tab.fields?.url;
    return (
      <BrowserTab
        url={typeof url === "string" ? url : ""}
        shown={shown}
        onState={(state) =>
          host.patchTab(tab.key, (current) => ({
            title: nameOf(state.title, state.url),
            fields: { ...current.fields, url: state.url },
          }), { later: true })}
      />
    );
  },
};
