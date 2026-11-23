// terminal 탭 kind. 시작 폴더와 터미널 참조를 남긴다. 터미널은 core가 갖고 앱을 꺼도 돌므로, 다시 켠 앱의 탭은 그 터미널이 아직
// 살아 있으면 붙고 없으면 새 shell을 연다.

import { t } from "@lophn/i18n";
import type { ReactNode } from "react";
import { workspaceIcons } from "../../icons/mod.ts";
import { AgentFaceIcon } from "../../parts/agent-session/agent-session.tsx";
import { codingDot, codingFace } from "../../parts/agent-session/coding.ts";
import type { SessionDot } from "../../parts/agent-session/activity.ts";
import { closeTerminalTab, type TerminalDeps } from "../../terminal/deps.ts";
import {
  folderTitle,
  type RememberedName,
  terminalName,
} from "../../terminal/model.ts";
import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import { HOME_TERMINAL_PROJECT } from "../../../../protocol/coding-agent/terminals.ts";
import type { HarnessId } from "../../../../protocol/coding-agent/harness-id.ts";
import type { TerminalResume, TerminalStore } from "../../terminal/store.ts";
import { GuiSwitch, guiTitleOf } from "../../terminal/terminal-gui.tsx";
import { TerminalTab } from "../../terminal/terminal-tab.tsx";
import type { TabItem } from "../model.ts";
import { openFile } from "./document-editor.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";
import { openAt, showAfter } from "../open-policy.ts";
import type { SessionTabOpen } from "./agent.tsx";

const TAB_KEY = /^[A-Za-z0-9._:-]+$/;

let terminalCount = 0;

/** 탭의 기계 묶음의 터미널 통로. 탭이 없으면(새로 여는 탭) workspace의 기계다. 다른 기계의 터미널은 화면 사본으로 그린다. */
function terminalOf(
  tab: TabItem | null,
  host: TabHost,
): TerminalDeps | undefined {
  return host.machineData(tab?.machine ?? host.machine).terminal;
}

/** 터미널이 속하는 core의 project 값. project는 그 id, Home은 `home`이다. 앱 workspace에는 터미널이 없어 null이다. */
function terminalProjectOf(host: TabHost): string | null {
  const { workspace } = host;
  return workspace.kind === "project"
    ? workspace.id
    : workspace.kind === "home"
      ? HOME_TERMINAL_PROJECT
      : null;
}

/**
 * 사람이 누른 터미널 열기. cwd를 주지 않으면 Explorer root에서 시작한다(없으면 시작 폴더를 core가 정한다. Home은 Explorer가 없어 core가 사람의 home 폴더로 연다). 저장한 session을
 * 열 때만 폴더와 resume을 주고, 이때는 그 폴더가 우선이다. `command`는 대화 코드 블록의 실행이고 floated로 연다
 * (`openAt`의 run). `terminal`을 주면 새 shell을 열지 않고 core에 이미 있는 그 터미널(폰이나 agent가 연 것)에 붙는다.
 */
export function openTerminal(
  host: TabHost,
  options: {
    folderRef?: string;
    resume?: TerminalResume;
    cwd?: string;
    command?: string;
    /** command를 float가 아니라 tab으로 연다(New session의 coding agent). */
    docked?: boolean;
    /** agent가 연 탭의 key·자리(`host:<tab>`). 주면 그 자리에 고르지 않고 연다. */
    open?: SessionTabOpen;
    /** 이미 core에 있는 터미널의 참조. */
    terminal?: string;
    /** 터미널이 있는 기계. 없으면 workspace의 기계다. */
    machine?: string;
    /** 저장한 session을 다시 열 때 미리 채워 두는 이름(사람이 고정한 이름이나 기억한 session 제목). */
    seed?: {
      readonly harness: string;
      readonly session: string;
      readonly name?: string;
      readonly title?: string;
    };
  } = {},
): string | null {
  const terminal = host.machineData(options.machine ?? host.machine).terminal;
  if (!terminal || terminalProjectOf(host) === null) return null;
  const key =
    options.open?.key ??
    `terminal-${Date.now().toString(36)}-${++terminalCount}`;
  const auto = host.projectTitle ?? t("project-workspace.label.kind-terminal");
  const title = options.seed?.name ?? options.seed?.title ?? auto;
  // resume은 CLI가 cwd별로 session을 찾으므로 Explorer root가 아니라 주어진 폴더(없으면 첫 폴더)에서 연다.
  const cwd =
    options.cwd ??
    (options.folderRef === undefined && options.resume === undefined
      ? host.explorerRoot
      : undefined);
  if (options.terminal !== undefined) {
    terminal.store.adopt(key, {
      terminalRef: options.terminal,
      generation: 0,
      folderRef: null,
    });
  } else {
    terminal.store.request(key, options.folderRef ?? null, {
      ...(options.resume === undefined ? {} : { resume: options.resume }),
      ...(options.command === undefined ? {} : { command: options.command }),
      ...(cwd === undefined ? {} : { cwd }),
    });
  }
  const tab: TabItem = {
    key,
    kind: "terminal",
    title,
    fields: {
      auto,
      ...(options.terminal === undefined ? {} : { terminal: options.terminal }),
      ...(options.seed === undefined
        ? {}
        : {
            harness: options.seed.harness,
            ...(options.seed.name === undefined
              ? {}
              : { name: options.seed.name }),
            ...(options.seed.title === undefined
              ? {}
              : {
                  agentTitle: options.seed.title,
                  agentSession: options.seed.session,
                }),
          }),
    },
    ...(options.machine === undefined ? {} : { machine: options.machine }),
  };
  // 이미 있는 터미널은 시작 폴더를 core의 runtime에서 읽어 탭에 남긴다. 탭을 그리기 전에도 layout에 저장되어 다시 켠 앱이 붙는다.
  const attached = options.terminal;
  if (attached !== undefined) {
    void terminal.core?.list().then((list) => {
      const found = list?.find((one) => one.terminal_ref === attached);
      if (found === undefined) return;
      // GUI 탭은 xterm이 서지 않아 generation을 아는 길이 이것뿐이다.
      terminal.store.noteRuntime(found);
      host.patchTab(key, (current) =>
        current.folder === undefined
          ? startedPatch(current, {
              title: folderTitle(found.cwd_at_start),
              folderRef: found.folder_ref,
              terminalRef: attached,
            })
          : {},
      );
    });
  }
  if (options.open !== undefined) {
    if (options.open.float === true) {
      host.openFloat(tab, undefined, options.open.options);
    } else host.openTab(tab, options.open.options);
    return key;
  }
  const at = openAt(
    host.desk,
    undefined,
    options.command === undefined || options.docked === true ? "show" : "run",
  );
  if (at.kind === "float") host.openFloat(tab);
  else host.openTab(tab);
  return key;
}

/** 터미널이 시작했거나 붙었다. 시작 폴더와 터미널 참조를 탭 제목과 layout에 남긴다. */
function startedPatch(
  current: TabItem,
  info: { title: string | null; folderRef: string; terminalRef: string },
): Partial<TabItem> {
  const auto = info.title ?? autoOf(current);
  return {
    title: personOf(current) ?? rememberedOf(current)?.title ?? auto,
    folder: info.folderRef,
    fields: { ...current.fields, auto, terminal: info.terminalRef },
  };
}

// 이름의 두 입력. 사람이 붙인 이름과 자동 이름(폴더 제목)은 fields에 두고,
// tab.title은 그 둘과 agent의 제목으로 정해진 지금 보이는 이름이다.
function personOf(tab: TabItem): string | null {
  const name = tab.fields?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

/** 이 탭에서 coding agent가 돈 적이 있으면 그 harness id. */
export function harnessOf(tab: TabItem): string | null {
  const harness = tab.fields?.harness;
  return typeof harness === "string" && /^[a-z0-9_-]{1,64}$/.test(harness)
    ? harness
    : null;
}

function autoOf(tab: TabItem): string {
  const auto = tab.fields?.auto;
  return typeof auto === "string" ? auto : tab.title;
}

/** layout에 남은 터미널 참조(`trm_…`). 열린 적이 없으면 null이다. */
export function terminalRefOf(tab: TabItem): string | null {
  const ref = tab.fields?.terminal;
  return typeof ref === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(ref)
    ? ref
    : null;
}

function rememberedOf(tab: TabItem): RememberedName | null {
  const title = tab.fields?.agentTitle;
  const session = tab.fields?.agentSession;
  return typeof title === "string" && title.length > 0
    ? { title, session: typeof session === "string" ? session : null }
    : null;
}

function harnessLabel(harness: string): string {
  return harness in HARNESS_ADAPTERS
    ? HARNESS_ADAPTERS[harness as HarnessId].label
    : harness;
}

// 탭 하나의 이름 계산. 입력은 탭 field(사람 이름, GUI 제목, 기억한 이름)와 창의 terminal store(core가 알린 agent·coding session)뿐이라
// 탭을 그리지 않아도, 다른 workspace의 저장된 탭이어도 같은 답이 나온다. 규칙은 `terminalName`이다.
function namingOf(
  tab: TabItem,
  store: TerminalStore | undefined,
  person: string | null = personOf(tab),
) {
  const agent = store?.agentOf(tab.key);
  const coding = store?.codingOf(tab.key);
  const harness = agent?.harness ?? coding?.harness ?? null;
  return terminalName({
    person,
    guiTitle: store === undefined ? null : guiTitleOf(tab, store),
    agent:
      harness === null
        ? null
        : {
            session: agent?.session ?? coding?.cli_session ?? null,
            name: agent?.name ?? null,
            title: agent?.title ?? coding?.title ?? null,
            // hook만 있고 foreground가 아니면(GUI가 띄운 CLI) 터미널 제목은 shell prompt의 경로다.
            screenTitle:
              agent?.foreground === true ? (agent.screen_title ?? null) : null,
            label: harnessLabel(harness),
            gui: coding?.view === "gui",
          },
    remembered: rememberedOf(tab),
    auto: autoOf(tab),
  });
}

/** 탭에 지금 보일 이름. 이 창의 탭과 다른 workspace의 저장된 layout에서 읽은 탭이 같이 쓴다. */
export function terminalTabTitle(tab: TabItem, store: TerminalStore): string {
  return namingOf(tab, store).title;
}

/**
 * 탭의 이름과 기억한 session 이름을 지금 agent에 맞춘다. 바뀐 것이 없으면 아무것도 하지 않는다. 작업대가 store가 바뀔 때
 * 모든 터미널 탭에 부르고, 그려진 탭 화면도 부른다(작업대가 없는 detached 창).
 */
export function syncTerminalTab(
  tab: TabItem,
  store: TerminalStore,
  patchTab: TabHost["patchTab"],
): void {
  const { title, remembered } = namingOf(tab, store);
  const before = rememberedOf(tab);
  const sameMemory =
    remembered?.title === before?.title &&
    remembered?.session === before?.session;
  if (title === tab.title && sameMemory) return;
  patchTab(
    tab.key,
    (current) => {
      if (sameMemory) return { title };
      const {
        agentTitle: _title,
        agentSession: _session,
        ...rest
      } = current.fields ?? {};
      return {
        title,
        fields:
          remembered === null
            ? rest
            : {
                ...rest,
                agentTitle: remembered.title,
                ...(remembered.session === null
                  ? {}
                  : { agentSession: remembered.session }),
              },
      };
    },
    { later: true },
  );
}

/** 사람이 붙인 이름(`person`, null이면 지움)을 준 터미널 탭. 이 창의 탭과 다른 workspace의 저장된 탭이 같이 쓴다. */
export function terminalNamed(
  tab: TabItem,
  person: string | null,
  store: TerminalStore | undefined,
): TabItem {
  const { name: _, ...rest } = tab.fields ?? {};
  return {
    ...tab,
    fields: person === null ? rest : { ...rest, name: person },
    title: namingOf(tab, store, person).title,
  };
}

/** 저장한 coding agent session에도 사람의 이름을 써 고정한다. 지우면(null) 고정을 풀어 harness 이름이 다시 들어온다. */
export function pinAgentSessionName(
  terminal: TerminalDeps,
  project: string,
  key: string,
  person: string | null,
): void {
  const agent = terminal.store.agentOf(key);
  const coding = terminal.store.codingOf(key);
  const harness = agent?.harness ?? coding?.harness;
  const externalSession = agent?.session ?? coding?.cli_session ?? undefined;
  if (
    terminal.core === null ||
    harness === undefined ||
    externalSession === undefined
  ) {
    return;
  }
  void terminal.core.renameSaved({
    project,
    harness,
    external_session: externalSession,
    name: person?.slice(0, 200) ?? null,
  });
}

// 사람이 plain 터미널에서 직접 띄운 coding agent도 core가 알려 주면 그 제품 아이콘을 쓴다. 모르는 제품은 kind 아이콘이다.
function agentTabIcon(tab: TabItem, host: TabHost): ReactNode | null {
  const agent = terminalOf(tab, host)?.store.agentOf(tab.key);
  if (agent === undefined) return null;
  const face = codingFace(agent.harness);
  return face.vendor === undefined ? null : (
    <AgentFaceIcon face={face} vendorSize={14} />
  );
}

function agentTabDot(tab: TabItem, host: TabHost): SessionDot | null {
  const agent = terminalOf(tab, host)?.store.agentOf(tab.key);
  return agent === undefined ? null : codingDot(agent);
}

// 탭의 터미널 참조. 옮길 때(transfer)와 detached 창이 조용히 닫힌 뒤 다시 열릴 때(resume) 같은 값을 쓴다. GUI view는 core가
// 들고 있어 받는 창이 목록에서 읽는다.
function runtimeOf(tab: TabItem, host: TabHost) {
  const entry = terminalOf(tab, host)?.store.get(tab.key);
  return entry?.terminalRef == null
    ? null
    : {
        terminal_ref: entry.terminalRef,
        generation: entry.generation,
        folder_ref: entry.folderRef,
      };
}

let linkCount = 0;

/** 터미널에서 Ctrl/Cmd-click한 link를 그 터미널 탭 옆 browser 탭으로 연다. */
function openLinkTab(host: TabHost, terminalKey: string, url: string): void {
  let title = url;
  try {
    title = new URL(url).host || title;
  } catch {
    // 주소로 읽히지 않으면 url 그대로 이름이다.
  }
  host.openTab(
    {
      key: `browser-link-${Date.now().toString(36)}-${++linkCount}`,
      kind: "browser",
      title,
      fields: { url },
    },
    showAfter(host.desk, terminalKey),
  );
}

export const terminalKind: TabKindDef = {
  kind: "terminal",
  labelKey: "project-workspace.label.kind-terminal",
  icon: workspaceIcons.terminal,
  paletteIcon: "terminal",
  noReopen: true,
  iconOf: agentTabIcon,
  dotOf: agentTabDot,
  rename(tab, name, host) {
    const person = name?.trim() || null;
    const terminal = terminalOf(tab, host);
    host.patchTab(tab.key, (current) =>
      terminalNamed(current, person, terminal?.store),
    );
    const project = terminalProjectOf(host);
    if (terminal !== undefined && project !== null) {
      pinAgentSessionName(terminal, project, tab.key, person);
    }
  },
  fromStored(stored, { key }) {
    const person = typeof stored.name === "string" ? stored.name : null;
    const folder = stored.project_folder;
    if (typeof folder !== "string" || folder.length < 1) return null;
    const auto = typeof stored.title === "string" ? stored.title : "";
    return {
      key,
      kind: "terminal",
      title: person ?? auto,
      folder,
      fields: {
        auto,
        ...(person === null ? {} : { name: person }),
        ...(typeof stored.harness === "string"
          ? { harness: stored.harness }
          : {}),
        ...(typeof stored.agent_title === "string"
          ? { agentTitle: stored.agent_title }
          : {}),
        ...(typeof stored.agent_session === "string"
          ? { agentSession: stored.agent_session }
          : {}),
        ...(typeof stored.terminal_ref === "string"
          ? { terminal: stored.terminal_ref }
          : {}),
      },
    };
  },
  toStored(tab) {
    if (
      tab.folder === undefined ||
      tab.folder.length < 1 ||
      tab.folder.length > 4096 ||
      !TAB_KEY.test(tab.key)
    )
      return null;
    const auto = autoOf(tab);
    const person = personOf(tab);
    const harness = harnessOf(tab);
    // 기억한 session 이름은 탭의 지금 이름에서 다시 만들지 않고 그대로 남긴다. 지금 이름으로 만들면 이름이 잠깐 자동
    // 이름인 순간의 저장이 기억을 지운다.
    const remembered = rememberedOf(tab);
    const terminal = terminalRefOf(tab);
    return {
      kind: "terminal",
      key: tab.key,
      project_folder: tab.folder,
      ...(terminal === null ? {} : { terminal_ref: terminal }),
      ...(auto.length < 1 ? {} : { title: auto.slice(0, 200) }),
      ...(person === null ? {} : { name: person.slice(0, 200) }),
      ...(harness === null ? {} : { harness }),
      ...(remembered === null
        ? {}
        : {
            agent_title: remembered.title.slice(0, 200),
            ...(remembered.session === null
              ? {}
              : { agent_session: remembered.session.slice(0, 200) }),
          }),
    };
  },
  // PTY는 core가 쥐고 있어 참조만 넘긴다. 받는 창이 snapshot을 0부터 받아 다시 그린다.
  // 보내는 창의 store 항목은 보내기가 실패해 탭이 남을 수 있어 지우지 않는다.
  transfer(tab, host) {
    return Promise.resolve({ value: runtimeOf(tab, host), views: [] });
  },
  resume: runtimeOf,
  receive(tab, { value }, host) {
    const moved = value as Record<string, unknown> | null;
    if (
      typeof moved?.terminal_ref !== "string" ||
      typeof moved.generation !== "number"
    )
      return;
    const store = terminalOf(tab, host)?.store;
    // 같은 창 안에서 옮길 때(전역 float)는 store가 이미 이 runtime을 가졌다. adopt가 phase를 opening으로 되돌리면 붙어 있는 display가 다시 snapshot을 받지 않아 멈춘다.
    const have = store?.get(tab.key);
    if (
      have?.terminalRef === moved.terminal_ref &&
      have.generation === moved.generation
    )
      return;
    store?.adopt(tab.key, {
      terminalRef: moved.terminal_ref,
      generation: moved.generation,
      folderRef: typeof moved.folder_ref === "string" ? moved.folder_ref : null,
    });
  },
  render(tab, active, host) {
    const terminal = terminalOf(tab, host);
    const project = terminalProjectOf(host);
    if (!terminal || project === null) return null;
    const body = (
      <TerminalTab
        key={tab.key}
        tabKey={tab.key}
        project={project}
        folderRef={tab.folder ?? null}
        attach={terminalRefOf(tab)}
        active={active}
        deps={terminal}
        onAgentChange={() =>
          syncTerminalTab(tab, terminal.store, host.patchTab)
        }
        onStarted={(info) =>
          host.patchTab(tab.key, (current) => startedPatch(current, info))
        }
        openLinkTab={(url) => openLinkTab(host, tab.key, url)}
        // 경로가 디스크의 파일일 때만 link다. 부모 폴더 한 단계를 읽어 본다. 다른 기계의 경로는 이 컴퓨터의 file이 아니다.
        paths={
          (tab.machine ?? host.machine) !== null
            ? undefined
            : {
                exists: async (path) => {
                  const cut = path.lastIndexOf("/");
                  const read = await host.props.source.list(
                    path.slice(0, cut) || "/",
                  );
                  const name = path.slice(cut + 1);
                  return (
                    read.ok &&
                    read.value.some(
                      (entry) => entry.kind === "file" && entry.name === name,
                    )
                  );
                },
                open: (path, line) =>
                  openFile(host, path, {
                    from: tab.key,
                    ...(line === undefined ? {} : { line }),
                  }),
              }
        }
      />
    );
    // core가 이 터미널을 GUI view로 두면 xterm 대신 채팅 화면을 그린다. PTY와 xterm은 그대로 산다.
    return (
      <GuiSwitch tab={tab} active={active} host={host} deps={terminal}>
        {body}
      </GuiSwitch>
    );
  },
  // 살아 있는 터미널은 사람이 확인해야 닫는다. 취소하면 탭과 shell을 유지한다.
  beforeClose(tab, host, options) {
    const terminal = terminalOf(tab, host);
    return terminal
      ? closeTerminalTab(terminal, tab.key, options?.confirmed === true)
      : null;
  },
};
