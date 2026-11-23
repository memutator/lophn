// core의 host queue가 시킨 탭 열기·닫기(agent가 `lophn tab open|close`로 한 것)를 이 창에서 한다. main이 이 창이 보이는
// workspace를 알아야 요청을 보내므로 layout을 다 읽은 뒤에 알리고, 탭을 연 뒤에만 ack한다(못 열면 ack하지 않아 main이
// retry로 되돌린다). 열린 탭의 key는 `host:<tab id>`다. core 탭 표에 있는 탭(agent가 연 탭, 사람이 넘긴 탭)의 id는
// `hostTabOf()`로만 찾고, 그 탭의 닫힘(넘긴 탭은 되찾음도)은 main을 거쳐 core에 알린다.
import { useEffect, useRef, useState } from "react";

import { type LophnSurfaceApi, SURFACE_RELEASE_ID } from "../../ipc/surface.ts";
import type { PendingHost } from "../app-frame/workspace-views.tsx";
import {
  MAIN_DESK,
  type WorkspaceRef,
  workspaceKey,
} from "../shell/desk-model.ts";
import { sessionOf } from "./agent/tab-fields.ts";
import type { SessionTabOpen } from "./kinds/agent.tsx";
import { appPreviewTab } from "./kinds/app-preview.tsx";
import { artifactTab } from "./kinds/artifact.tsx";
import { openBrowserTab } from "./kinds/browser.tsx";
import type { TabHost } from "./kinds/host.ts";
import { openTerminal } from "./kinds/terminal.tsx";
import { takeBack } from "./hand.ts";
import { hostTabOf, type TabItem } from "./model.ts";
import { closeTerminalTab } from "../terminal/deps.ts";
import { type AgentOpen, openAt } from "./open-policy.ts";
import type { TabRelation } from "../../../protocol/lophn-agent/host-queue.ts";

const HOST_KEY = "host:";

// agent가 연 탭의 자리와 주인. source의 agent 탭이 이 창에 있으면 그 옆이고, 없으면 desk 끝이다(session 탭은 Main desk 끝).
// workflow desk(`desk`)가 주어지면 그 workflow desk에 놓는다.
function placementOf(
  host: () => TabHost,
  key: string,
  relation: TabRelation | null,
  source: string | null,
  target: AgentOpen["target"],
  owner: string | undefined,
  desk?: string,
  group?: string,
): SessionTabOpen {
  const sourceTab =
    source === null
      ? undefined
      : host()
          .windowTabs()
          .find((tab) => tab.kind === "agent" && sessionOf(tab) === source);
  const at = openAt(host().desk, sourceTab?.key, "show", { relation, target });
  const targetDesk =
    desk ??
    (at.kind === "tab" && at.after === undefined && target === "session"
      ? MAIN_DESK
      : undefined);
  return {
    key,
    ...ownerField(owner),
    float: at.kind === "float",
    options: {
      select: false,
      ...(at.kind === "tab"
        ? {
            after: at.after,
            beside: at.beside,
            relation: at.relation,
            ...(targetDesk === undefined ? {} : { desk: targetDesk }),
            ...(group === undefined ? {} : { group }),
          }
        : { minimized: at.minimized === true }),
    },
  };
}

function ownerField(owner: string | undefined): { owner?: string } {
  return owner === undefined ? {} : { owner };
}

export function surfaceApi(): LophnSurfaceApi | null {
  return (
    (globalThis as { lophnSurface?: LophnSurfaceApi }).lophnSurface ?? null
  );
}

export interface AgentControl {
  /** agent가 그 탭을 다루는 중이다. 사람이 가져왔어도 true다. */
  agent: boolean;
  /** 사람이 가져왔다. 그동안 agent의 쓰기는 conflict다. */
  held: boolean;
  take(): void;
  release(): void;
}

/**
 * core 탭 표에 있는 탭(`hostTabOf()`가 준 id. agent가 연 탭, 사람이 넘긴 탭)의 view session을 main에 알리고(agent가 이 탭의
 * page를 찾는 길) take control 상태를 받는다. agent가 다루지 않는 탭이나 `tab`이 null이면 null이다.
 */
export function useAgentControl(
  tab: string | null,
  viewSession: string | null,
): AgentControl | null {
  const surface = surfaceApi();
  const [state, setState] = useState({ agent: false, held: false });
  useEffect(() => {
    // 되찾았다가 다시 넘긴 탭은 id가 새것이라 앞 id의 상태를 이어 보이지 않는다.
    setState({ agent: false, held: false });
    if (surface === null || tab === null || viewSession === null) return;
    // 구독을 먼저 한다: bind에 main이 지금 상태로 답한다.
    const off = surface.control((control) => {
      if (control.tab === tab) {
        setState({ agent: control.agent, held: control.held });
      }
    });
    void surface.report({ bind: { tab, view_session: viewSession } });
    return off;
  }, [surface, tab, viewSession]);
  if (surface === null || tab === null || !state.agent) return null;
  return {
    ...state,
    take: () => void surface.take(tab),
    release: () => void surface.release(tab),
  };
}

type Args = {
  surface: LophnSurfaceApi | null;
  workspace: WorkspaceRef;
  /** 이 workspace의 layout을 다 읽었다. */
  ready: boolean;
  host: () => TabHost;
  /** 그 session의 agent 탭을 연다. session이나 agent 목록을 아직 모르면 열지 않고 false다. */
  openSession: (session: string, open: SessionTabOpen) => boolean;
  /** 이 창 어느 desk에든 그 key의 float이 있으면 그 자리에서 편다. */
  showFloat: (key: string) => void;
  /** 이 workspace가 mount되기 전에 agent가 연 browser 탭과 닫힌 탭. 가져가면 비운다. */
  takePending: (() => PendingHost) | undefined;
  /** 이 창의 pool에 그 key의 page가 이미 있다(떠나며 남긴 것). */
  hasPage: ((key: string) => boolean) | undefined;
  /** 이 창의 전역 float 탭. 넘긴 탭이 전역 float으로 옮겨도 core 표에 남는다. */
  globalTabs: readonly TabItem[];
  /** 전역 float 탭 값 고치기. */
  patchGlobal: (key: string, patch: Partial<TabItem>) => void;
  /** 이 workspace page 그릇에 그 탭이 준 탭(연 session이 아닌 session이 듦)인지 단다(`WebviewHost.setGiven`). */
  setGiven: (key: string, on: boolean) => void;
};

export function useSurfaceRequests(args: Args): void {
  const latest = useRef(args);
  latest.current = args;
  const { surface, workspace, ready } = args;
  const workspaceId = workspaceKey(workspace);

  // main에 이 창이 보이는 workspace를 알린다.
  useEffect(() => {
    if (surface === null || !ready) return;
    void surface.workspace({ workspace });
    return () => void surface.workspace({ workspace: null });
  }, [surface, ready, workspaceId]);

  useEffect(() => {
    if (surface === null || !ready) return;
    return surface.on(({ request }) => {
      // 다른 창이 page를 이어받았다는 알림이다. layout을 건드리지 않고 창 단위 receiver(workspace-views.tsx)만 받는다.
      if (request.id === SURFACE_RELEASE_ID) return;
      const { host, openSession, showFloat } = latest.current;
      if (workspaceKey(request.workspace) !== workspaceKey(host().workspace)) {
        return;
      }
      const key = `${HOST_KEY}${request.payload.tab}`;
      const done = () =>
        void surface.ack({ request: request.id, opened: true });
      if (request.kind === "tab_close") {
        // 없는 탭(이미 닫았거나 이미 열려 있던 session 탭을 가리킨 것)은 닫을 것이 없어 끝난 일이다.
        const found = host()
          .windowTabs()
          .find((tab) => tab.key === key);
        const terminal = host().props.terminal;
        if (found?.kind === "terminal" && terminal !== undefined) {
          // 터미널은 탭만 빼면 PTY가 남는다. agent가 닫는 것이라 사람 확인은 묻지 않는다.
          void closeTerminalTab(terminal, key, true).then((closed) => {
            if (closed) host().removeTab(key);
          });
        } else if (found !== undefined) host().removeTab(key);
        done();
        return;
      }
      if (request.kind === "tab_show") {
        // 접힌 float이 아니면 할 일이 없다. 열려 있지 않은 탭도 같다.
        showFloat(key);
        done();
        return;
      }
      if (request.kind === "tab_owner") {
        // core가 이 탭의 주인을 바꿨다(session이 자손에게 주었거나 되찾았거나, 받은 session이 끝나 돌아갔다). 이 workspace layout이나
        // 전역 float의 그 탭에 적는다. 주인이 없으면 사람에게 돌아간 것이고, 넘긴 탭이면 되찾기처럼 넘긴 표시도 지운다.
        const { owner, given } = request.payload;
        const held = (tab: TabItem) => hostTabOf(tab) === request.payload.tab;
        const here = host().windowTabs().find(held);
        const found = here ?? latest.current.globalTabs.find(held);
        const patch: (key: string, patch: Partial<TabItem>) => void =
          here !== undefined
            ? (key, value) => host().patchTab(key, value)
            : latest.current.patchGlobal;
        if (found !== undefined && here !== undefined) {
          latest.current.setGiven(found.key, given);
        }
        // 없으면 이미 닫힌 탭이다.
        if (found !== undefined && owner !== undefined) {
          patch(found.key, { owner });
        } else if (found?.handedTab !== undefined) takeBack(found, patch);
        else if (found !== undefined) patch(found.key, { owner: undefined });
        done();
        return;
      }
      const { target, relation, source, owner, desk, group } = request.payload;
      const open = placementOf(
        host,
        key,
        relation,
        source,
        Object.keys(target)[0] as AgentOpen["target"],
        owner,
        desk?.workflow,
        group,
      );
      if ("preview" in target) {
        // 이미 이 창에 열려 있는 탭이면 새로 열지 않고 주인과 기기와 화면만 바꾼다(core는 같은 앱의 preview를 다시 연 caller를
        // 새 주인으로 한다). at이 달라야 같은 기기를 다시 줘도 탭이 알아챈다(사람이 탭에서 기기를 바꿨을 수 있다). 화면은 사람이
        // 바꾸지 않아 값만 고친다.
        const existing = host()
          .windowTabs()
          .find((tab) => tab.key === key);
        if (existing !== undefined) {
          const { device, screen } = target.preview;
          host().patchTab(key, (current) => ({
            owner,
            fields: {
              ...current.fields,
              ...(device === null ? {} : { device, device_at: Date.now() }),
              ...(screen === null ? {} : { screen }),
            },
          }));
          done();
          return;
        }
        // 사람이 [Preview]로 연 같은 앱의 탭이 있으면 그 자리에 이 탭을 열고 그것을 닫는다(앱마다 preview 탭은 하나다).
        const person = host()
          .windowTabs()
          .find(
            (tab) =>
              tab.kind === "app_preview" &&
              tab.app === target.preview.app &&
              hostTabOf(tab) === null,
          );
        const tab = {
          ...appPreviewTab(
            target.preview.app,
            key,
            target.preview.device,
            target.preview.screen,
          ),
          ...ownerField(owner),
        };
        if (person !== undefined) {
          host().openTab(tab, { select: false, after: person.key });
        } else if (open.float === true) {
          host().openFloat(tab, undefined, open.options);
        } else host().openTab(tab, open.options);
        if (person !== undefined) host().removeTab(person.key);
        done();
        return;
      }
      if ("artifact" in target) {
        // 이미 이 창에 열려 있으면 주인만 바꾼다(core는 같은 artifact를 다시 연 caller를 새 주인으로 한다).
        if (
          host()
            .windowTabs()
            .some((tab) => tab.key === key)
        ) {
          host().patchTab(key, { owner });
          done();
          return;
        }
        const made = artifactTab(host(), target.artifact.name, key);
        if (made === null) return;
        const tab = { ...made, ...ownerField(owner) };
        // 같은 artifact 탭(사람이 연 것, core가 다시 떠 표에서 빠진 옛 host 탭)이 있으면 그 자리에 이 탭을 열고 그것을 닫는다.
        // 같은 창의 같은 source는 view 하나라 두 탭이 한 page를 나눠 갖지 않게 한다.
        const previous = host()
          .windowTabs()
          .find(
            (item) =>
              item.kind === "artifact" &&
              item.fields?.name === target.artifact.name,
          );
        if (previous !== undefined) {
          host().openTab(tab, { select: false, after: previous.key });
          host().removeTab(previous.key);
        } else if (open.float === true) {
          host().openFloat(tab, undefined, open.options);
        } else host().openTab(tab, open.options);
        done();
        return;
      }
      if ("session" in target) {
        if (openSession(target.session, open)) done();
        return;
      }
      // 폰이나 agent가 연 터미널이다(`terminals/open`의 tab). 새 shell을 열지 않고 core의 그 터미널에 붙는다. 이미 이 창에 그 터미널의
      // 탭이 있으면 더 열지 않는다.
      if ("terminal" in target) {
        const terminal = host().props.terminal;
        const ref = target.terminal.terminal_ref;
        if (terminal === undefined) return;
        const have = host()
          .windowTabs()
          .some(
            (tab) =>
              tab.kind === "terminal" && terminal.store.refOf(tab.key) === ref,
          );
        if (have) {
          done();
          return;
        }
        const opened = openTerminal(host(), { open, terminal: ref });
        if (opened === null) return;
        if (owner !== undefined) host().patchTab(opened, { owner });
        done();
        return;
      }
      // core가 연 session의 agent 정의로 고른 profile이다. 없으면 기본 profile이다.
      const { profile } = target.browser;
      openBrowserTab(host(), target.browser.url, {
        ...open,
        ...(profile === undefined ? {} : { profile }),
      });
      done();
    });
  }, [surface, ready]);

  // 이 workspace가 떠나 있는 사이 창이 page만 만들어 둔 agent 탭에 자리를 준다. 만들어 둔 <webview>를 이어 쓰므로 다시 load하지 않는다.
  // browser 탭의 상태(url·title)는 창 단위로 workspace-views.tsx가 알린다.
  useEffect(() => {
    if (!ready) return;
    const { host, takePending, hasPage } = latest.current;
    // 창이 닫힐 때 core가 버린 agent 탭이 접힌 채 layout에 남았다. page가 없는 접힌 것은 사람의 탭이 아니므로 뺀다. agent가 연
    // 탭은 key가 곧 core 탭 id다(넘긴 탭은 사람의 key라 여기 들지 않는다).
    if (hasPage !== undefined) {
      for (const float of host().desk.floats) {
        const { key, kind } = float.tab;
        if (
          float.minimized &&
          kind === "browser" &&
          hostTabOf({ key }) !== null &&
          !hasPage(key)
        ) {
          host().removeTab(key);
        }
      }
    }
    const pending = takePending?.();
    if (pending === undefined) return;
    // 떠나 있는 사이 상한으로 page를 놓은 넘긴 탭. core 표에서는 이미 빠졌으니 주인을 지워 사람의 탭으로 돌린다.
    for (const key of pending.released) {
      host().patchTab(key, { owner: undefined, handedTab: undefined });
    }
    for (const item of pending.opens) {
      openBrowserTab(host(), item.url, {
        ...placementOf(
          host,
          `${HOST_KEY}${item.tab}`,
          item.relation,
          item.source,
          "browser",
          item.owner ?? undefined,
        ),
        ...(item.profile === null ? {} : { profile: item.profile }),
      });
    }
    const keys = new Set(
      host()
        .windowTabs()
        .map((tab) => tab.key),
    );
    for (const key of pending.closes) if (keys.has(key)) host().removeTab(key);
  }, [ready]);

  // 창의 탭(이 workspace layout과 전역 float)에서 core 탭 id가 사라지면 core의 표에서 뺀다. 사람이 탭을 닫은 것과 넘긴 탭을
  // 되찾은 것(`handedTab`을 지움)이 같은 길이다. layout을 읽는 중에 사라진 것은 닫힘이 아니라 읽기 전이라 ready 뒤부터 본다.
  const open = useRef<ReadonlySet<string>>(new Set());
  const hostTabs = [...args.host().windowTabs(), ...args.globalTabs].flatMap(
    (tab) => hostTabOf(tab) ?? [],
  );
  const joined = hostTabs.join();
  useEffect(() => {
    if (surface === null || !ready) return;
    const now = new Set(hostTabs);
    for (const tab of open.current) {
      if (!now.has(tab)) void surface.report({ tab, state: "closed" });
    }
    open.current = now;
  }, [surface, ready, joined]);
}
