// terminal 탭 kind. 시작 폴더 참조만 남기고 PTY는 복원하지 않는다.

import { t } from "@lophn/wording";
import type { ReactNode } from "react";
import type { TerminalResume } from "../../../ipc/terminal.ts";
import { workspaceIcons } from "../../icons/mod.ts";
import type { TabDot } from "../../parts/tab-strip/tab-strip.tsx";
import {
  harnessVendorOf,
  VendorIcon,
} from "../../parts/vendor-icon/vendor-icon.tsx";
import { closeTerminalTab } from "../../terminal/deps.ts";
import { tabName } from "../../terminal/model.ts";
import type { TerminalStore } from "../../terminal/store.ts";
import { TerminalTab } from "../../terminal/terminal-tab.tsx";
import type { TabItem } from "../model.ts";
import { openFile } from "./document-editor.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";
import { openAt } from "../open-policy.ts";

const TAB_KEY = /^[A-Za-z0-9._:-]+$/;

let terminalCount = 0;

/**
 * 사람이 누른 터미널 열기. 시작 폴더는 탭 화면이 main에 묻는다.
 * 저장한 session을 열 때만 폴더와 resume을 준다. `command`는 대화 코드 블록의 실행이고 floated로 연다
 * (`openAt`의 run).
 */
export function openTerminal(
  host: TabHost,
  options: {
    folderRef?: string;
    resume?: TerminalResume;
    command?: string;
  } = {},
): void {
  const terminal = host.props.terminal;
  if (!terminal) return;
  const key = `terminal-${Date.now().toString(36)}-${++terminalCount}`;
  const title = host.projectTitle ?? t("project-workspace.label.kind-terminal");
  terminal.store.request(key, options.folderRef ?? null, {
    ...(options.resume === undefined ? {} : { resume: options.resume }),
    ...(options.command === undefined ? {} : { command: options.command }),
  });
  const tab: TabItem = {
    key,
    kind: "terminal",
    title,
    fields: { auto: title },
  };
  const at = openAt(
    host.view,
    undefined,
    options.command === undefined ? "show" : "run",
  );
  if (at.kind === "float") host.openFloat(tab);
  else host.openTab(tab);
}

// 이름의 두 입력. 사람이 붙인 이름과 자동 이름(폴더 제목)은 fields에 두고,
// tab.title은 그 둘과 agent의 제목으로 정해진 지금 보이는 이름이다.
function personOf(tab: TabItem): string | null {
  const name = tab.fields?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

function autoOf(tab: TabItem): string {
  const auto = tab.fields?.auto;
  return typeof auto === "string" ? auto : tab.title;
}

/**
 * 탭에 지금 보일 이름. 탭 화면(`TerminalTab`)과 workspace가 같은 계산을 쓴다. 탭 화면이 없는 숨은 탭도
 * hook이 알린 session 이름을 따라가야 하기 때문이다.
 */
export function terminalTabTitle(tab: TabItem, store: TerminalStore): string {
  return tabName({
    person: personOf(tab),
    sessionName: store.agentOf(tab.key)?.name ?? null,
    agentTitle: store.agentTitleOf(tab.key),
    auto: autoOf(tab),
  });
}

// 사람이 plain 터미널에서 직접 띄운 coding agent도 main이 알려 주면 그 제품 아이콘을 쓴다.
function agentTabIcon(tab: TabItem, host: TabHost): ReactNode | null {
  const agent = host.props.terminal?.store.agentOf(tab.key);
  const vendor =
    agent === undefined ? undefined : harnessVendorOf(agent.harness);
  return vendor === undefined ? null : <VendorIcon vendor={vendor} size={14} />;
}

/** running은 일하는 중, waiting은 사람을 기다림, 끝났는데 안 본 turn은 finished다. */
function agentTabDot(tab: TabItem, host: TabHost): TabDot | null {
  const agent = host.props.terminal?.store.agentOf(tab.key);
  if (agent === undefined) return null;
  if (agent.state === "running") return "working";
  if (agent.state === "waiting") return "waiting";
  return agent.state === "idle" && agent.unseen ? "finished" : null;
}

// 탭의 PTY 참조. 옮길 때(transfer)와 detached 창이 조용히 닫힌 뒤 다시 열릴 때(resume) 같은 값을 쓴다.
function runtimeOf(tab: TabItem, host: TabHost) {
  const entry = host.props.terminal?.store.get(tab.key);
  return entry?.terminalRef == null
    ? null
    : {
        terminal_ref: entry.terminalRef,
        generation: entry.generation,
        folder_ref: entry.folderRef,
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
    host.patchTab(tab.key, (current) => {
      const { name: _, ...rest } = current.fields ?? {};
      return {
        fields: person === null ? rest : { ...rest, name: person },
        title: tabName({
          person,
          sessionName: terminal?.store.agentOf(tab.key)?.name ?? null,
          agentTitle: terminal?.store.agentTitleOf(tab.key) ?? null,
          auto: autoOf(current),
        }),
      };
    });
    // 저장한 session에도 사람의 이름을 써 고정한다. 지우면(null) 고정을 풀어 harness 이름이 다시 들어온다.
    const agent = terminal?.store.agentOf(tab.key);
    if (terminal?.bridge && agent?.session !== undefined) {
      void terminal.bridge.renameAgentSession({
        project: host.projectId,
        harness: agent.harness,
        external_session: agent.session,
        name: person?.slice(0, 200) ?? null,
      });
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
      fields: { auto, ...(person === null ? {} : { name: person }) },
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
    return {
      kind: "terminal",
      key: tab.key,
      project_folder: tab.folder,
      // agent의 터미널 제목은 저장하지 않는다. 자동 이름과 사람이 붙인 이름만 남는다.
      ...(auto.length < 1 ? {} : { title: auto.slice(0, 200) }),
      ...(person === null ? {} : { name: person.slice(0, 200) }),
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
    host.props.terminal?.store.adopt(tab.key, {
      terminalRef: moved.terminal_ref,
      generation: moved.generation,
      folderRef: typeof moved.folder_ref === "string" ? moved.folder_ref : null,
    });
  },
  render(tab, active, host) {
    const terminal = host.props.terminal;
    if (!terminal) return null;
    return (
      <TerminalTab
        key={tab.key}
        tabKey={tab.key}
        project={host.projectId}
        folderRef={tab.folder ?? null}
        active={active}
        deps={terminal}
        naming={{
          name: { shown: tab.title, person: personOf(tab), auto: autoOf(tab) },
          onName: (title) => host.patchTab(tab.key, { title }, { later: true }),
        }}
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
  },
  // 살아 있는 터미널은 사람이 확인해야 닫는다. 취소하면 탭과 shell을 유지한다.
  beforeClose(tab, host) {
    const terminal = host.props.terminal;
    return terminal ? closeTerminalTab(terminal, tab.key) : null;
  },
};
