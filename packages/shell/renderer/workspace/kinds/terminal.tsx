// terminal 탭 kind. 시작 폴더 참조만 남기고 PTY는 복원하지 않는다.

import { t } from "@lophn/i18n";
import type { ReactNode } from "react";
import type { TerminalResume } from "../../../ipc/terminal.ts";
import { workspaceIcons } from "../../icons/mod.ts";
import { AgentFaceIcon } from "../../parts/agent-session/agent-session.tsx";
import { codingDot, codingFace } from "../../parts/agent-session/coding.ts";
import type { TabDot } from "../../parts/tab-state-dot/tab-state-dot.tsx";
import { closeTerminalTab, type TerminalDeps } from "../../terminal/deps.ts";
import { type RememberedName, terminalName } from "../../terminal/model.ts";
import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import type { HarnessId } from "../../../../protocol/coding-agent/harness-id.ts";
import type { TerminalStore } from "../../terminal/store.ts";
import {
  GuiSwitch,
  guiOf,
  guiTitleOf,
  viewOf,
} from "../../terminal/terminal-gui.tsx";
import { TerminalTab } from "../../terminal/terminal-tab.tsx";
import type { TabItem } from "../model.ts";
import { openFile } from "./document-editor.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";
import { openAt } from "../open-policy.ts";
import type { SessionTabOpen } from "./agent.tsx";

const TAB_KEY = /^[A-Za-z0-9._:-]+$/;

let terminalCount = 0;

/**
 * 사람이 누른 터미널 열기. cwd를 주지 않으면 Explorer root에서 시작한다(없으면 시작 폴더를 탭 화면이 main에
 * 묻는다). 저장한 session을 열 때만 폴더와 resume을 주고, 이때는 그 폴더가 우선이다. `command`는 대화 코드 블록의 실행이고 floated로 연다
 * (`openAt`의 run).
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
  } = {},
): string | null {
  const terminal = host.props.terminal;
  // Home에는 터미널이 없다.
  if (!terminal || host.projectId === null) return null;
  const key =
    options.open?.key ??
    `terminal-${Date.now().toString(36)}-${++terminalCount}`;
  const title = host.projectTitle ?? t("project-workspace.label.kind-terminal");
  // resume은 CLI가 cwd별로 session을 찾으므로 Explorer root가 아니라 주어진 폴더(없으면 첫 폴더)에서 연다.
  const cwd =
    options.cwd ??
    (options.folderRef === undefined && options.resume === undefined
      ? host.explorerRoot
      : undefined);
  terminal.store.request(key, options.folderRef ?? null, {
    ...(options.resume === undefined ? {} : { resume: options.resume }),
    ...(options.command === undefined ? {} : { command: options.command }),
    ...(cwd === undefined ? {} : { cwd }),
  });
  const tab: TabItem = {
    key,
    kind: "terminal",
    title,
    fields: { auto: title },
  };
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

// 탭 하나의 이름 계산. 입력은 탭 field(사람 이름, GUI 제목, 기억한 이름)와 창의 terminal store(main이 보낸 agent)뿐이라
// 탭을 그리지 않아도, 다른 workspace의 저장된 탭이어도 같은 답이 나온다. 규칙은 `terminalName`이다.
function namingOf(
  tab: TabItem,
  store: TerminalStore | undefined,
  person: string | null = personOf(tab),
) {
  const agent = store?.agentOf(tab.key);
  return terminalName({
    person,
    guiTitle: guiTitleOf(tab),
    agent:
      agent === undefined
        ? null
        : {
            session: agent.session ?? null,
            name: agent.name ?? null,
            // hook만 있고 foreground가 아니면(GUI가 띄운 CLI) 터미널 제목은 shell prompt의 경로다.
            screenTitle:
              agent.foreground === true ? (agent.screen_title ?? null) : null,
            label: harnessLabel(agent.harness),
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
  if (terminal.bridge === null || agent?.session === undefined) return;
  void terminal.bridge.renameAgentSession({
    project,
    harness: agent.harness,
    external_session: agent.session,
    name: person?.slice(0, 200) ?? null,
  });
}

// 사람이 plain 터미널에서 직접 띄운 coding agent도 main이 알려 주면 그 제품 아이콘을 쓴다. 모르는 제품은 kind 아이콘이다.
function agentTabIcon(tab: TabItem, host: TabHost): ReactNode | null {
  const agent = host.props.terminal?.store.agentOf(tab.key);
  if (agent === undefined) return null;
  const face = codingFace(agent.harness);
  return face.vendor === undefined ? null : (
    <AgentFaceIcon face={face} vendorSize={14} />
  );
}

function agentTabDot(tab: TabItem, host: TabHost): TabDot | null {
  const agent = host.props.terminal?.store.agentOf(tab.key);
  return agent === undefined ? null : codingDot(agent);
}

// 탭의 PTY 참조. 옮길 때(transfer)와 detached 창이 조용히 닫힌 뒤 다시 열릴 때(resume) 같은 값을 쓴다. GUI가 붙어 있으면
// 그 handle과 view도 같이 간다: handle은 탭을 따라가고 받는 창이 id로 다시 붙는다(main이 쌓은 갱신을 처음부터 다시 보낸다).
function runtimeOf(tab: TabItem, host: TabHost) {
  const entry = host.props.terminal?.store.get(tab.key);
  const gui = guiOf(tab);
  return entry?.terminalRef == null
    ? null
    : {
        terminal_ref: entry.terminalRef,
        generation: entry.generation,
        folder_ref: entry.folderRef,
        ...(gui === null ? {} : { gui, view: viewOf(tab) }),
      };
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
    const terminal = host.props.terminal;
    host.patchTab(tab.key, (current) =>
      terminalNamed(current, person, terminal?.store),
    );
    if (terminal !== undefined && host.projectId !== null) {
      pinAgentSessionName(terminal, host.projectId, tab.key, person);
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
    return {
      kind: "terminal",
      key: tab.key,
      project_folder: tab.folder,
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
  // PTY는 main이 쥐고 있어 참조만 넘긴다. 받는 창이 snapshot을 0부터 받아 다시 그린다.
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
    const store = host.props.terminal?.store;
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
    // 탭이 fields째 오지 않는 길(detached 창이 닫힌 뒤 다시 열기)은 GUI 참조가 value에만 있다.
    const gui = guiOf({ ...tab, fields: { gui: moved.gui } });
    if (guiOf(tab) === null && gui !== null) {
      host.patchTab(tab.key, (current) => ({
        fields: {
          ...current.fields,
          gui,
          view: moved.view === "gui" ? "gui" : "tui",
        },
      }));
    }
  },
  render(tab, active, host) {
    const terminal = host.props.terminal;
    const project = host.projectId;
    if (!terminal || project === null) return null;
    const body = (
      <TerminalTab
        key={tab.key}
        tabKey={tab.key}
        project={project}
        folderRef={tab.folder ?? null}
        active={active}
        deps={terminal}
        gui={guiOf(tab)}
        onAgentChange={() =>
          syncTerminalTab(tab, terminal.store, host.patchTab)
        }
        onStarted={(info) =>
          host.patchTab(tab.key, (current) => {
            const auto = info.title ?? autoOf(current);
            return {
              title: personOf(current) ?? auto,
              folder: info.folderRef,
              fields: { ...current.fields, auto },
            };
          })
        }
        // 경로가 디스크의 파일일 때만 link다. 부모 폴더 한 단계를 읽어 본다.
        paths={{
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
        }}
      />
    );
    // 탭의 view가 gui이면 xterm 대신 채팅 화면을 그린다. PTY와 xterm은 그대로 산다.
    return (
      <GuiSwitch tab={tab} active={active} host={host} deps={terminal}>
        {body}
      </GuiSwitch>
    );
  },
  // 살아 있는 터미널은 사람이 확인해야 닫는다. 취소하면 탭과 shell을 유지한다.
  beforeClose(tab, host, options) {
    const terminal = host.props.terminal;
    return terminal
      ? closeTerminalTab(terminal, tab.key, options?.confirmed === true)
      : null;
  },
};
