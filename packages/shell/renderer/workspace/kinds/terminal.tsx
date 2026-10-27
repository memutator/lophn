// terminal 탭 kind. 시작 폴더 참조만 남기고 PTY는 복원하지 않는다.
import type { ReactNode } from "react";
import { workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import { closeTerminalTab } from "../../terminal/deps.ts";
import { tabName } from "../../terminal/model.ts";
import { TerminalTab } from "../../terminal/terminal-tab.tsx";
import type { TerminalOpenRequest } from "../../terminal/use-terminal-open-requests.ts";
import type { TabItem } from "../model.ts";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";
import {
  harnessVendorOf,
  VendorIcon,
  vendorOf,
} from "../../parts/vendor-icon/vendor-icon.tsx";
import type { TabDot } from "../../parts/tab-strip/tab-strip.tsx";

const TAB_KEY = /^[A-Za-z0-9._:-]+$/;

let terminalCount = 0;

/** 사람이 누른 터미널 열기. 시작 폴더는 탭 화면이 main에 묻는다. */
export function openTerminal(host: TabHost): void {
  const terminal = host.props.terminal;
  if (!terminal) return;
  const key = `terminal-${Date.now().toString(36)}-${++terminalCount}`;
  const title = host.projectTitle ?? t("project-workspace.label.kind-terminal");
  terminal.store.request(key);
  host.openTab({
    key,
    kind: "terminal",
    title,
    fields: { auto: title },
  });
}

// 이름의 두 입력. 사람이 붙인 이름과 자동 이름(폴더 제목·coding session 제목)은 fields에 두고,
// tab.title은 그 둘과 agent의 제목으로 정해진 지금 보이는 이름이다.
function personOf(tab: TabItem): string | null {
  const name = tab.fields?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

function autoOf(tab: TabItem): string {
  const auto = tab.fields?.auto;
  return typeof auto === "string" ? auto : tab.title;
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
  const vendor =
    coding === null
      ? undefined
      : (harnessVendorOf(coding.product) ?? vendorOf(coding.product));
  return vendor === undefined ? null : <VendorIcon vendor={vendor} size={14} />;
}

// 사람이 plain 터미널에서 직접 띄운 coding agent도 main이 알려 주면 그 제품 아이콘을 쓴다.
// 사람이 띄운 agent가 coding 탭의 표지보다 지금 실제로 도는 것이라 먼저 본다.
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

/** lophn(core 요청)이 연 coding 터미널 탭. 붙이기만 하고 보고 있는 탭을 바꾸지 않는다. */
export function openCodingTerminal(
  host: TabHost,
  request: TerminalOpenRequest,
): void {
  const terminal = host.props.terminal;
  if (!terminal) return;
  terminal.store.requestFromCore(request);
  host.openTab(
    {
      key: request.tab.key,
      kind: "terminal",
      title: request.tab.title,
      folder: request.tab.folder,
      fields: {
        auto: request.tab.title,
        session: request.coding.session,
        product: request.coding.product,
        app: request.coding.app,
      },
    },
    { select: false },
  );
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
        session: entry.session,
      };
}

export const terminalKind: TabKindDef = {
  kind: "terminal",
  labelKey: "project-workspace.label.kind-terminal",
  icon: workspaceIcons.terminal,
  paletteIcon: "terminal",
  noReopen: true,
  iconOf: (tab, host) => agentTabIcon(tab, host) ?? codingTabIcon(tab),
  dotOf: agentTabDot,
  rename(tab, name, host) {
    const person = name?.trim() || null;
    host.patchTab(tab.key, (current) => {
      const { name: _, ...rest } = current.fields ?? {};
      return {
        fields: person === null ? rest : { ...rest, name: person },
        title: tabName({
          person,
          agentTitle: host.props.terminal?.store.agentTitleOf(tab.key) ?? null,
          auto: autoOf(current),
        }),
      };
    });
  },
  fromStored(stored, { key }) {
    const person = typeof stored.name === "string" ? stored.name : null;
    const folder = stored.project_folder;
    if (typeof folder !== "string" || folder.length < 1) return null;
    const coding = stored.coding;
    if (typeof coding === "object" && coding !== null) {
      const { session, product, title } = coding as Record<string, unknown>;
      if (typeof session === "string" && typeof product === "string") {
        const auto = typeof title === "string" ? title : product;
        return {
          key,
          kind: "terminal",
          title: person ?? auto,
          folder,
          fields: {
            auto,
            session,
            product,
            ...(person === null ? {} : { name: person }),
          },
        };
      }
    }
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
    const coding = codingOf(tab);
    const auto = autoOf(tab);
    const person = personOf(tab);
    return {
      kind: "terminal",
      key: tab.key,
      project_folder: tab.folder,
      // agent의 터미널 제목은 저장하지 않는다. 자동 이름과 사람이 붙인 이름만 남는다.
      ...(coding !== null || auto.length < 1
        ? {}
        : { title: auto.slice(0, 200) }),
      ...(person === null ? {} : { name: person.slice(0, 200) }),
      ...(coding === null
        ? {}
        : {
            coding: {
              session: coding.session,
              product: coding.product,
              ...(auto.length > 0 ? { title: auto.slice(0, 200) } : {}),
            },
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
    host.props.terminal?.store.adopt(tab.key, {
      terminalRef: moved.terminal_ref,
      generation: moved.generation,
      folderRef: typeof moved.folder_ref === "string" ? moved.folder_ref : null,
      session: typeof moved.session === "string" ? moved.session : null,
    });
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
      />
    );
  },
  // 살아 있는 터미널은 사람이 확인해야 닫는다. 취소하면 탭과 shell을 유지한다.
  beforeClose(tab, host) {
    const terminal = host.props.terminal;
    return terminal ? closeTerminalTab(terminal, tab.key) : null;
  },
};
