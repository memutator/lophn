// browser 탭 kind. url·favicon·browser profile만 저장하고 title은 page가 알려 주는 대로 탭 이름에 쓴다.
// 탭에서 연 탭과 popup은 연 탭의 profile을 그대로 따른다.
import { t } from "@lophn/i18n";

import {
  type BrowserProfile,
  browserProfileIdSchema,
} from "../../../../protocol/shell/browser-profiles.ts";
import type { BrowserViewState } from "../../../ipc/browser.ts";
import { BrowserTab, KEEP_SIGNATURE } from "../../browser/browser-tab.tsx";
import { Favicon } from "../../browser/favicon.tsx";
import { browserIcons } from "../../icons/mod.ts";
import { readDevtools, setDevtools } from "./browser-devtools.tsx";
import { takeBack } from "../hand.ts";
import { hostTabOf, type TabItem } from "../model.ts";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

const MAX_URL = 8192;
const MAX_FAVICON = 65536;

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

/** 탭 값의 browser profile. bpf id 꼴이 아니면 기본 profile(undefined)이다. */
function profileOf(value: unknown): string | undefined {
  const parsed = browserProfileIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function profileField(profile: string | undefined): { profile?: string } {
  return profile === undefined ? {} : { profile };
}

/** 탭 머리에 보일 profile. browser 탭이 아니거나 기본 profile이거나 목록에 없는 profile이면 undefined다. */
export function shownProfile(
  tab: TabItem,
  known: readonly BrowserProfile[],
): BrowserProfile | undefined {
  if (tab.kind !== "browser") return undefined;
  const profile = profileOf(tab.fields?.profile);
  return profile === undefined
    ? undefined
    : known.find((one) => one.id === profile);
}

/**
 * 새 browser 탭. 빈 url이면 빈 주소 칸으로 열린다. agent가 연 탭은 `open`으로 key와 자리와 주인을 주고, 고르지 않고
 * 열며 float이면 떠 있는 패널로 연다. `profile`이 없으면 기본 profile이다.
 */
export function openBrowserTab(
  host: TabHost,
  url?: string,
  open?: {
    readonly key?: string;
    readonly options?: Parameters<TabHost["openTab"]>[1];
    readonly float?: boolean;
    readonly profile?: string;
    readonly owner?: string;
  },
): void {
  const tab = {
    key: open?.key ?? newKey(),
    kind: "browser",
    title: nameOf("", url ?? ""),
    ...(open?.owner === undefined ? {} : { owner: open.owner }),
    fields: { url: url ?? "", ...profileField(open?.profile) },
  };
  if (open?.float === true) host.openFloat(tab, undefined, open.options);
  else host.openTab(tab, open?.options);
}

export const browserKind: TabKindDef = {
  thisComputerOnly: true,
  kind: "browser",
  labelKey: "browser.label.kind",
  icon: browserIcons.globe,
  anyWorkspace: true,
  noGlobal: (tab) => tab.fields?.native === true,
  // page favicon(main이 준 data URL). 접힌 float과 다른 desk의 탭은 mount하지 않아 이 값이 유일한
  // 출처라 layout에 저장하고, BrowserTab이 다시 mount될 때 이어 받으며, 접힌 동안 온 favicon은
  // WorkspaceWindow가 받아 적는다.
  iconOf(tab) {
    const favicon = tab.fields?.favicon;
    return <Favicon src={typeof favicon === "string" ? favicon : undefined} />;
  },
  fromStored(stored, { key }) {
    const { url, favicon, keep_alive, profile } = stored;
    if (typeof url !== "string" || url.length > MAX_URL) return null;
    return {
      key,
      kind: "browser",
      title: nameOf("", url),
      fields: {
        url,
        ...profileField(profileOf(profile)),
        ...(typeof favicon === "string" ? { favicon } : {}),
        ...(keep_alive === true ? { keepAlive: true } : {}),
      },
    };
  },
  toStored(tab) {
    const url = tab.fields?.url;
    if (typeof url !== "string" || url.length > MAX_URL) return null;
    const favicon = tab.fields?.favicon;
    // main schema가 받지 않는 값은 빼고 저장한다. 탭 전체를 잃지 않게 한다.
    const keep =
      typeof favicon === "string" &&
      favicon.startsWith("data:image/") &&
      favicon.length <= MAX_FAVICON;
    return {
      kind: "browser",
      key: tab.key,
      url,
      ...profileField(profileOf(tab.fields?.profile)),
      ...(keep ? { favicon } : {}),
      ...(tab.fields?.keepAlive === true ? { keep_alive: true } : {}),
    };
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
    const favicon = tab.fields?.favicon;
    const profile = profileOf(tab.fields?.profile);
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
        {...profileField(profile)}
        owner={tab.owner}
        hostTab={hostTabOf(tab)}
        {...(tab.handedTab === undefined
          ? {}
          : {
              onTakeBack: () =>
                takeBack((key, patch) => host.patchTab(key, patch), tab.key),
            })}
        adopt={typeof adopt === "string" ? adopt : undefined}
        favicon={typeof favicon === "string" ? favicon : undefined}
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
              fields: {
                url: "",
                adopt: event.view_session,
                native: true,
                ...profileField(profile),
              },
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
              fields: { url: next, ...profileField(profile) },
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
        keepAlive={tab.fields?.keepAlive === true}
        onKeepAlive={(on) =>
          host.patchTab(tab.key, (current) => ({
            fields: { ...current.fields, keepAlive: on ? true : undefined },
          }))
        }
        // 넘긴 탭은 page가 스스로 닫지 못한다: page의 window.close()는 그 page를 다루는 agent가 부를 수 있고, 넘긴 탭은 사람의 것이라
        // agent가 닫지 못한다. 사람은 탭의 X와 단축키로 닫는다.
        onCloseRequested={() => {
          if (tab.handedTab === undefined) host.removeTab(tab.key);
        }}
        onOpenInNewTab={(next) =>
          openBrowserTab(host, next, profileField(profile))
        }
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
