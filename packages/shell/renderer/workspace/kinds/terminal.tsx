// terminal 탭 kind. 시작 폴더 참조만 남기고 PTY는 복원하지 않는다.
import type { ReactNode } from "react";
import { VendorIcon, vendorOf } from "@lophn/design/components";
import { workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import { closeTerminalTab } from "../../terminal/deps.ts";
import { TerminalTab } from "../../terminal/terminal-tab.tsx";
import type { TerminalOpenRequest } from "../../terminal/use-terminal-open-requests.ts";
import type { TabItem } from "../model.ts";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

const TAB_KEY = /^[A-Za-z0-9._:-]+$/;

let terminalCount = 0;

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

/** coding 탭이면 표지를 읽는다. `fields`에 session·product·app이 있다. */
function codingOf(
  tab: TabItem,
): { session: string; product: string; app: string } | null {
  const { session, product, app } = tab.fields ?? {};
  if (typeof session !== "string" || typeof product !== "string") return null;
  return { session, product, app: typeof app === "string" ? app : "" };
}

/**
 * coding 탭의 아이콘(harness vendor). 탭 줄이 kind의 고정 `icon` 대신 탭마다 부를 수 있게
 * 낸다. coding 탭이 아니거나 모르는 harness면 null이라 kind의 icon을 쓴다.
 */
function codingTabIcon(tab: TabItem): ReactNode | null {
  const coding = codingOf(tab);
  const vendor = coding === null ? undefined : vendorOf(coding.product);
  return vendor === undefined ? null : <VendorIcon vendor={vendor} size={14} />;
}

/** lophn(core 요청)이 연 coding 터미널 탭. 붙이기만 하고 보고 있는 탭을 바꾸지 않는다. */
export function openCodingTerminal(
  host: TabHost,
  request: TerminalOpenRequest,
): void {
  const terminal = host.props.terminal;
  if (!terminal) return;
  terminal.store.requestFromCore(request);
  host.openTab({
    key: request.tab.key,
    kind: "terminal",
    title: request.tab.title,
    folder: request.tab.folder,
    fields: {
      session: request.coding.session,
      product: request.coding.product,
      app: request.coding.app,
    },
  }, { select: false });
}

export const terminalKind: TabKindDef = {
  kind: "terminal",
  labelKey: "project-workspace.label.kind-terminal",
  icon: workspaceIcons.terminal,
  paletteIcon: "terminal",
  iconOf: (tab) => codingTabIcon(tab),
  fromStored(stored, { key }) {
    const folder = stored.project_folder;
    if (typeof folder !== "string" || folder.length < 1) return null;
    const coding = stored.coding;
    if (typeof coding === "object" && coding !== null) {
      const { session, product, title } = coding as Record<string, unknown>;
      if (typeof session === "string" && typeof product === "string") {
        return {
          key,
          kind: "terminal",
          title: typeof title === "string" ? title : product,
          folder,
          fields: { session, product },
        };
      }
    }
    return { key, kind: "terminal", title: "", folder };
  },
  toStored(tab) {
    if (
      tab.folder === undefined || tab.folder.length < 1 ||
      tab.folder.length > 4096 || !TAB_KEY.test(tab.key)
    ) return null;
    const coding = codingOf(tab);
    return {
      kind: "terminal",
      key: tab.key,
      project_folder: tab.folder,
      ...(coding === null ? {} : {
        coding: {
          session: coding.session,
          product: coding.product,
          ...(tab.title.length > 0 ? { title: tab.title } : {}),
        },
      }),
    };
  },
  render(tab, active, host) {
    const terminal = host.props.terminal;
    if (!terminal) return null;
    const coding = codingOf(tab);
    return (
      <TerminalTab
        key={tab.key}
        tabKey={tab.key}
        project={host.projectId}
        folderRef={tab.folder ?? null}
        active={active}
        deps={terminal}
        coding={coding ?? undefined}
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
};
