// terminal 탭 kind. 시작 폴더 참조만 남기고 PTY는 복원하지 않는다.
import { workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import { closeTerminalTab } from "../../terminal/deps.ts";
import { TerminalTab } from "../../terminal/terminal-tab.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

const TAB_KEY = /^[A-Za-z0-9._:-]+$/;

let terminalCount = 0;

/** 폴더 경로는 힌트에 넣지 않는다. 슬래시 없는 짧은 참조만 터미널 탭이 된다. */
function folderRef(value: string | undefined): string | null {
  if (value === undefined || value.length === 0 || value.length > 80) {
    return null;
  }
  if (value.includes("/") || value.includes("\\")) return null;
  return value;
}

/** 사람이 누른 터미널 열기. 시작 폴더는 탭 화면이 main에 묻는다. */
export function openTerminal(host: TabHost): void {
  const terminal = host.props.terminal;
  if (!terminal) return;
  const key = `terminal-${Date.now().toString(36)}-${++terminalCount}`;
  terminal.store.request(key);
  host.openTab({
    key,
    kind: "terminal",
    title: host.projectTitle ?? t("project-workspace.label.kind-terminal"),
  });
}

export const terminalKind: TabKindDef = {
  kind: "terminal",
  labelKey: "project-workspace.label.kind-terminal",
  icon: workspaceIcons.terminal,
  paletteIcon: "terminal",
  fromStored(stored, { key }) {
    const folder = stored.project_folder;
    if (typeof folder !== "string" || folder.length < 1) return null;
    return { key, kind: "terminal", title: "", folder };
  },
  toStored(tab) {
    if (
      tab.folder === undefined || tab.folder.length < 1 ||
      tab.folder.length > 4096 || !TAB_KEY.test(tab.key)
    ) return null;
    return { kind: "terminal", key: tab.key, project_folder: tab.folder };
  },
  hint(tab) {
    const folder = folderRef(tab.folder);
    if (folder === null) return null;
    return { kind: "terminal", key: tab.key, project_folder: folder };
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
        onStarted={(info) =>
          host.patchTab(tab.key, (current) => ({
            title: info.title ?? current.title,
            folder: info.folderRef,
          }))}
      />
    );
  },
  // 살아 있는 터미널은 사람이 확인해야 닫는다. 취소하면 탭과 shell을 유지한다.
  beforeClose(tab, host) {
    const terminal = host.props.terminal;
    return terminal ? closeTerminalTab(terminal, tab.key) : null;
  },
  launcher: {
    labelKey: "project-workspace.button.open-terminal",
    available: (host) => host.props.terminal !== undefined,
    open: openTerminal,
  },
};
