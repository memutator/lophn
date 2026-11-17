// browser 탭 화면. 실제 Workspace가 browser 탭을 가진 layout을 읽어 그린다. page는 `<webview>`인데 gallery에는
// 없어서 webview 그릇이 빈 page 자리를 그린다. page 상태(주소, 제목, favicon, 뒤로 가기)와 bookmark는
// fake browser 통로로 정하고, 열린 menu·popover·DevTools는 mount 뒤에 사람이 하듯이 눌러 만든다.
import { useEffect, useMemo } from "react";
import { t } from "@lophn/i18n";
import { Palette } from "@lophn/ui/overlay";

import { openProject } from "../../../../../packages/shell/renderer/desktop/router.ts";
import type {
  LophnSurfaceApi,
  SurfaceControl,
} from "../../../../../packages/shell/ipc/surface.ts";
import { fakeBrowserApi } from "../../../../../packages/shell/renderer/browser/testdata/fake-browser-api.ts";
import { groupLabel } from "../../../../../packages/shell/renderer/desktop/palette/labels.ts";
import {
  type PaletteEntry,
  paletteModel,
} from "../../../../../packages/shell/renderer/desktop/palette/model.ts";
import { paletteIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import {
  type FloatSpec,
  MockDesktop,
  type PaneSpec,
  PROJECT_GROCERY,
} from "../../../mock/mock-desktop.tsx";
import {
  click,
  find,
  press,
  type,
  useDrive,
  wait,
} from "../../../mock/drive.ts";

// site favicon 대신 쓰는 작은 그림. 하나는 favicon이 없는 bookmark(Globe)로 둔다.
const svg = (fill: string) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='1' y='1' width='14' height='14' rx='3' fill='%23${fill}'/%3E%3C/svg%3E`;
const DENO_ICON = svg("1f2937");
const MDN_ICON = svg("2563eb");

const BOOKMARKS = [
  { title: "Deno", url: "https://deno.com/", favicon: DENO_ICON },
  {
    title: "MDN Web Docs",
    url: "https://developer.mozilla.org/",
    favicon: MDN_ICON,
  },
  { title: "Grocery dev server", url: "http://localhost:5173/" },
] as const;

const NOTES = {
  key: "/home/mina/Documents/grocery/notes.md",
  kind: "document_editor",
  title: "notes.md",
} as const;
const DENO = {
  key: "browser-deno",
  kind: "browser",
  title: "deno.com",
  url: "https://deno.com/",
} as const;
const BLANK = {
  key: "browser-blank",
  kind: "browser",
  title: "Browser",
  url: "",
} as const;
const GOOGLE = {
  key: "browser-google",
  kind: "browser",
  title: "accounts.google.com",
  url: "https://accounts.google.com/",
} as const;

const TERM = { key: "term_1", kind: "terminal", title: "grocery" } as const;
const VITE = {
  key: "browser-vite",
  kind: "browser",
  title: "Vite + React",
  url: "http://localhost:5173/",
} as const;

const DENO_PANES: readonly PaneSpec[] = [
  { tabs: [NOTES, DENO], selected: DENO.key },
];
const BLANK_PANES: readonly PaneSpec[] = [
  { tabs: [NOTES, BLANK], selected: BLANK.key },
];
// terminal이 낸 주소를 bridge가 연 모양. split이면 terminal 옆 반쪽, 아니면 terminal 바로 뒤다.
const BRIDGE_PANES: readonly PaneSpec[] = [
  { tabs: [TERM], selected: TERM.key },
  { tabs: [VITE], selected: VITE.key },
];
const BRIDGE_ONE_PANE: readonly PaneSpec[] = [
  { tabs: [NOTES, TERM, VITE], selected: VITE.key },
];
// 로그인 page가 크기를 준 window.open(width=500,height=600)으로 뜬 작은 패널.
const OAUTH_FLOAT: FloatSpec = {
  tab: GOOGLE,
  rect: { x: 360, y: 90, width: 500, height: 600 },
};

type Fake = ReturnType<typeof fakeBrowserApi>;

// page의 browser 통로. bookmark는 mount 전에 넣어 둔다.
function useFake(
  bookmarks: readonly { title: string; url: string; favicon?: string }[] = [],
  corrupt = false,
): Fake {
  return useMemo(() => {
    const fake = fakeBrowserApi({ corrupt });
    for (const bookmark of bookmarks) void fake.api.bookmarks.add(bookmark);
    return fake;
  }, []);
}

// gallery의 탭은 `<webview>` 대신 빈 자리라서 그릇이 주는 session이 `fake-wv-<탭 key>`다.
const session = (key: string) => `fake-wv-${key}`;

/** 탭의 page 상태를 main이 미는 것처럼 정한다. 주소를 차례로 열면 앞의 것이 뒤로 가기 기록이 된다. */
async function showPage(
  fake: Fake,
  key: string,
  urls: readonly string[],
  title: string,
): Promise<void> {
  await find("[data-browser-address]");
  await wait(60);
  for (const url of urls) {
    await fake.api.navigate({ view_session: session(key), input: url });
  }
  fake.set({ title });
  await wait(30);
}

const showDeno = (fake: Fake) =>
  showPage(
    fake,
    DENO.key,
    ["https://deno.com/blog", "https://deno.com/"],
    "Deno, the next-generation JavaScript runtime",
  );

function DenoTab({ fake, then }: { fake: Fake; then?: () => Promise<void> }) {
  useDrive(async () => {
    await showDeno(fake);
    await then?.();
  });
  return (
    <MockDesktop
      route={openProject(PROJECT_GROCERY)}
      panes={DENO_PANES}
      browser={fake.api}
    />
  );
}

/** https page를 연 browser 탭. 머리 줄 하나(card 머리 겸 주소 칸)와 page 자리, 탭 이름은 page title, 아이콘은 favicon이다. */
export function BrowserTabPage() {
  return <DenoTab fake={useFake()} />;
}

/** 새 탭 menu의 Browser로 연 빈 주소 칸. 주소 칸에 focus가 있고 bookmark가 없다. */
export function BrowserBlank() {
  const fake = useFake();
  return (
    <MockDesktop
      route={openProject(PROJECT_GROCERY)}
      panes={BLANK_PANES}
      browser={fake.api}
    />
  );
}

function BridgeTab({ panes }: { panes: readonly PaneSpec[] }) {
  const fake = useFake();
  useDrive(() => showPage(fake, VITE.key, [VITE.url], VITE.title));
  return (
    <MockDesktop
      route={openProject(PROJECT_GROCERY)}
      panes={panes}
      openTerminal={TERM.key}
      browser={fake.api}
    />
  );
}

/** terminal의 vite 주소를 Ctrl/Cmd-click하거나 `$BROWSER`가 불러 terminal 옆에 browser 탭이 split으로 열렸다. */
export const BrowserBridgePane = () => <BridgeTab panes={BRIDGE_PANES} />;

/** split이 아니면 terminal 바로 뒤에 browser 탭을 열고 그 탭을 고른다. */
export const BrowserBridgeOnePane = () => <BridgeTab panes={BRIDGE_ONE_PANE} />;

// 안내 toast는 2초 뒤 스스로 닫힌다. gallery에서 보이도록 같은 사건을 그보다 자주 다시 보낸다.
const BLOCKED_AGAIN_MS = 1500;

/** page가 사용자 입력 없이 연 popup을 거절했다는 한 줄 안내(탭 위쪽 toast). */
export function BrowserPopupBlocked() {
  const fake = useFake();
  useEffect(() => {
    const push = () =>
      fake.push({ kind: "popup-blocked", view_session: session(DENO.key) });
    const timer = setInterval(push, BLOCKED_AGAIN_MS);
    return () => clearInterval(timer);
  }, [fake]);
  return <DenoTab fake={fake} />;
}

/** 로그인 page가 크기를 준 popup을 열어 작은 floated browser 탭으로 떴다. */
export function BrowserOauthPopup() {
  const fake = useFake();
  useDrive(async () => {
    await showDeno(fake);
    await showPage(fake, GOOGLE.key, [GOOGLE.url], "Sign in – Google Accounts");
  });
  return (
    <MockDesktop
      route={openProject(PROJECT_GROCERY)}
      panes={DENO_PANES}
      floats={[OAUTH_FLOAT]}
      browser={fake.api}
    />
  );
}

/** 크기 없는 popup(target=_blank)은 거절되고 연 탭 바로 뒤에 새 browser 탭으로 열린다. */
export function BrowserPopupNewTab() {
  const fake = useFake();
  return (
    <DenoTab
      fake={fake}
      then={() => {
        fake.push({
          kind: "open-tab",
          opener: session(DENO.key),
          url: "https://github.com/denoland/deno",
        });
        return wait(60);
      }}
    />
  );
}

const openMore = () => press("[data-tab-menu]");

/** card 머리의 ⋯ menu. 맨 위 묶음이 DevTools이고 닫혀 있으면 Inspector 하나다. */
export function BrowserOverflowMenu() {
  return <DenoTab fake={useFake()} then={openMore} />;
}

const openDevtools = async () => {
  await openMore();
  await click('[role="menuitem"]', "Inspector");
  await wait(60);
};

const placeDevtools = (label: string) => async () => {
  await openDevtools();
  await openMore();
  await click('[role="menuitem"]', label);
  await wait(60);
};

/** Inspector로 연 DevTools가 page 오른쪽에 붙었다. 가운데 경계를 끌어 크기를 바꾼다. */
export function BrowserDevtoolsRight() {
  return <DenoTab fake={useFake()} then={openDevtools} />;
}

/** DevTools를 page 아래에 붙였다. */
export function BrowserDevtoolsBottom() {
  return (
    <DenoTab fake={useFake()} then={placeDevtools("Dock DevTools to bottom")} />
  );
}

/** DevTools만 떼어 workspace 위 floated 패널로 띄웠다. 패널 bar에서 다시 page 옆으로 붙인다. */
export function BrowserDevtoolsFloat() {
  return (
    <DenoTab
      fake={useFake()}
      then={placeDevtools("Open DevTools in floating panel")}
    />
  );
}

/** DevTools가 열려 있을 때의 ⋯ menu의 맨 위 묶음. 자리 고르기와 닫기이고 지금 자리는 잠겨 있다. */
export function BrowserDevtoolsMenu() {
  return (
    <DenoTab
      fake={useFake()}
      then={async () => {
        await openDevtools();
        await openMore();
      }}
    />
  );
}

/** 새 탭(+) menu의 Browser. */
export function NewTabMenuBrowser() {
  const fake = useFake();
  useDrive(async () => {
    await find("[data-new-tab]");
    await wait(60);
    await press("[data-new-tab]");
  });
  return (
    <MockDesktop
      route={openProject(PROJECT_GROCERY)}
      panes={[{ tabs: [NOTES], selected: NOTES.key }]}
      browser={fake.api}
    />
  );
}

/** 아직 bookmark가 아닌 page. 주소 칸 끝의 별이 비어 있다. */
export function BrowserStarEmpty() {
  return <DenoTab fake={useFake()} />;
}

/** bookmark인 page. 채운 별을 누르면 title을 고치는 popover와 [Remove]가 열린다. */
export function BrowserStarFilled() {
  return (
    <DenoTab
      fake={useFake(BOOKMARKS)}
      then={() => press('[aria-label="Edit bookmark"]')}
    />
  );
}

/** 머리 줄의 bookmark 단추 menu. 더한 순서대로 title이고 favicon이 없는 것은 Globe다. */
export function BrowserBookmarkMenu() {
  return (
    <DenoTab
      fake={useFake(BOOKMARKS)}
      then={() => press('[aria-label="Bookmarks"]')}
    />
  );
}

/** 빈 주소 칸으로 연 새 탭이 page 자리에 bookmark 목록을 보인다. */
export function BrowserNewTabBookmarks() {
  const fake = useFake(BOOKMARKS);
  return (
    <MockDesktop
      route={openProject(PROJECT_GROCERY)}
      panes={BLANK_PANES}
      browser={fake.api}
    />
  );
}

// 팔레트는 앱에서 overlay로 뜬다. gallery에는 overlay가 없어 Workspace가 보내는 것과 같은 행을 같은
// Palette에 그린다.
function BookmarkPalette({ typed }: { typed: string }) {
  useDrive(() => type('[role="dialog"] input', typed), [typed]);
  const entries: PaletteEntry<string>[] = BOOKMARKS.map((bookmark, n) => ({
    group: "bookmarks",
    key: `bookmark:${n}`,
    label: bookmark.title,
    detail: bookmark.url,
    icon: "bookmark",
    ...("favicon" in bookmark ? { image: bookmark.favicon } : {}),
    target: bookmark.url,
  }));
  const { model } = paletteModel(
    t("common.title.palette-workspace"),
    entries,
    0,
    groupLabel,
  );
  return (
    <Palette
      open
      onOpenChange={() => {}}
      title={model.label}
      items={model.choices.map((choice) => ({
        id: choice.id,
        label: choice.label,
        group: choice.group,
        detail: choice.detail,
        icon: choice.icon ? paletteIcons[choice.icon] : undefined,
        image: choice.image,
      }))}
      onSelect={() => {}}
    />
  );
}

/** Ctrl+K 팔레트에 bookmark 이름을 쳤다. Bookmarks 묶음에서 고르면 새 browser 탭에서 열린다. */
export function BrowserPaletteBookmark() {
  const fake = useFake(BOOKMARKS);
  return (
    <>
      <DenoTab fake={fake} />
      <BookmarkPalette typed="d" />
    </>
  );
}

// agent가 `lophn tab open --url`로 연 탭이다. key가 `host:<tab id>`라서 탭이 main에 view를 알리고 take control 상태를 받는다.
const HOST_TAB = "tab_01hzzzzzzzzzzzzzzzzzzzzzzz";
const AGENT = {
  key: `host:${HOST_TAB}`,
  kind: "browser",
  title: "deno.com",
  url: "https://deno.com/",
} as const;
const AGENT_PANES: readonly PaneSpec[] = [
  { tabs: [NOTES, AGENT], selected: AGENT.key },
];

// shell main을 흉내 낸 surface 통로. view를 알리면 agent가 다루는 중이라고 답하고, 가져오기와 돌려주기를 받아 되돌린다.
function useFakeSurface(): void {
  useMemo(() => {
    let listener: ((control: SurfaceControl) => void) | undefined;
    let held = false;
    const push = () => listener?.({ tab: HOST_TAB, agent: true, held });
    const surface: LophnSurfaceApi = {
      on: () => () => {},
      ack: async () => {},
      workspace: async () => {},
      report: async (input) => {
        if ("bind" in input) queueMicrotask(push);
      },
      control(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      take: async () => {
        held = true;
        push();
      },
      release: async () => {
        held = false;
        push();
      },
      emulate: async () => ({ ok: true }),
      emulationLost: () => () => {},
    };
    (globalThis as { lophnSurface?: LophnSurfaceApi }).lophnSurface = surface;
  }, []);
  useEffect(
    () => () => {
      delete (globalThis as { lophnSurface?: LophnSurfaceApi }).lophnSurface;
    },
    [],
  );
}

function AgentTab({ held }: { held: boolean }) {
  const fake = useFake();
  useFakeSurface();
  useDrive(async () => {
    await showPage(
      fake,
      AGENT.key,
      ["https://deno.com/"],
      "Deno, the next-generation JavaScript runtime",
    );
    if (held) await click("[data-agent-control] button", "Take control");
  });
  return (
    <MockDesktop
      route={openProject(PROJECT_GROCERY)}
      panes={AGENT_PANES}
      browser={fake.api}
    />
  );
}

/** agent가 연 탭. 머리에 "Agent is controlling this tab"과 [Take control]이 선다. */
export const BrowserAgentControl = () => <AgentTab held={false} />;

/** [Take control]을 눌러 사람이 가져왔다. "You have control"과 [Hand back]이 서고, 그동안 agent의 쓰기는 conflict다. */
export const BrowserAgentHeld = () => <AgentTab held />;
