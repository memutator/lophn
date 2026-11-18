// core의 host queue가 시킨 탭 열기·닫기(agent가 `lophn tab open|close`로 한 것)를 이 창에서 한다. main이 이 창이 보이는
// workspace를 알아야 요청을 보내므로 layout을 다 읽은 뒤에 알리고, 탭을 연 뒤에만 ack한다(못 열면 ack하지 않아 main이
// retry로 되돌린다). 열린 탭의 key는 `host:<tab id>`다. host 탭의 browser 상태와 닫힘은 main을 거쳐 core에 알린다.
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
import { closeTerminalTab } from "../terminal/deps.ts";
import { type AgentOpen, openAt } from "./open-policy.ts";
import type { TabRelation } from "../../../protocol/lophn-agent/host-queue.ts";

const HOST_KEY = "host:";

// agent가 연 탭의 자리. source의 agent 탭이 이 창에 있으면 그 옆이고, 없으면 desk 끝이다(session 탭은 Main desk 끝).
function placementOf(
  host: () => TabHost,
  key: string,
  relation: TabRelation | null,
  source: string | null,
  target: AgentOpen["target"],
): SessionTabOpen {
  const sourceTab =
    source === null
      ? undefined
      : host()
          .windowTabs()
          .find((tab) => tab.kind === "agent" && sessionOf(tab) === source);
  const at = openAt(host().desk, sourceTab?.key, "show", { relation, target });
  return {
    key,
    float: at.kind === "float",
    options: {
      select: false,
      ...(at.kind === "tab"
        ? {
            after: at.after,
            beside: at.beside,
            relation: at.relation,
            // 만든 이가 없는 session 탭(job·run, 다른 workspace의 call)은 보던 desk가 아니라 Main desk 끝에 쌓인다.
            ...(at.after === undefined && target === "session"
              ? { desk: MAIN_DESK }
              : {}),
          }
        : { minimized: at.minimized === true }),
    },
  };
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
 * host 탭(key가 `host:<tab>`)의 view session을 main에 알리고(agent가 이 탭의 page를 찾는 길) take control 상태를 받는다.
 * agent가 다루지 않는 탭이나 host 탭이 아니면 null이다.
 */
export function useAgentControl(
  key: string,
  viewSession: string | null,
): AgentControl | null {
  const surface = surfaceApi();
  const tab = key.startsWith(HOST_KEY) ? key.slice(HOST_KEY.length) : null;
  const [state, setState] = useState({ agent: false, held: false });
  useEffect(() => {
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
      const { target, relation, source } = request.payload;
      const open = placementOf(
        host,
        key,
        relation,
        source,
        Object.keys(target)[0] as AgentOpen["target"],
      );
      if ("preview" in target) {
        // 이미 이 창에 열려 있는 탭이면 새로 열지 않고 기기와 화면만 바꾼다. at이 달라야 같은 기기를 다시 줘도 탭이 알아챈다
        // (사람이 탭에서 기기를 바꿨을 수 있다). 화면은 사람이 바꾸지 않아 값만 고친다.
        const existing = host()
          .windowTabs()
          .find((tab) => tab.key === key);
        if (existing !== undefined) {
          const { device, screen } = target.preview;
          if (device !== null || screen !== null) {
            host().patchTab(key, (current) => ({
              fields: {
                ...current.fields,
                ...(device === null ? {} : { device, device_at: Date.now() }),
                ...(screen === null ? {} : { screen }),
              },
            }));
          }
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
              !tab.key.startsWith(HOST_KEY),
          );
        const tab = appPreviewTab(
          target.preview.app,
          key,
          target.preview.device,
          target.preview.screen,
        );
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
        if (
          host()
            .windowTabs()
            .some((tab) => tab.key === key)
        ) {
          done();
          return;
        }
        const tab = artifactTab(host(), target.artifact.name, key);
        if (tab === null) return;
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
        if (have || openTerminal(host(), { open, terminal: ref }) !== null) {
          done();
        }
        return;
      }
      openBrowserTab(host(), target.browser.url, open);
      done();
    });
  }, [surface, ready]);

  // 이 workspace가 떠나 있는 사이 창이 page만 만들어 둔 agent 탭에 자리를 준다. 만들어 둔 <webview>를 이어 쓰므로 다시 load하지 않는다.
  // browser 탭의 상태(url·title)는 창 단위로 workspace-views.tsx가 알린다.
  useEffect(() => {
    if (!ready) return;
    const { host, takePending, hasPage } = latest.current;
    // 창이 닫힐 때 core가 버린 agent 탭이 접힌 채 layout에 남았다. page가 없는 접힌 것은 사람의 탭이 아니므로 뺀다.
    if (hasPage !== undefined) {
      for (const float of host().desk.floats) {
        const { key, kind } = float.tab;
        if (
          float.minimized &&
          kind === "browser" &&
          key.startsWith(HOST_KEY) &&
          !hasPage(key)
        ) {
          host().removeTab(key);
        }
      }
    }
    const pending = takePending?.();
    if (pending === undefined) return;
    for (const item of pending.opens) {
      openBrowserTab(
        host(),
        item.url,
        placementOf(
          host,
          `${HOST_KEY}${item.tab}`,
          item.relation,
          item.source,
          "browser",
        ),
      );
    }
    const keys = new Set(
      host()
        .windowTabs()
        .map((tab) => tab.key),
    );
    for (const key of pending.closes) if (keys.has(key)) host().removeTab(key);
  }, [ready]);

  // 사람이 host 탭을 닫으면 core의 표에서 뺀다. layout을 읽는 중에 사라진 것은 닫힘이 아니라 읽기 전이라 ready 뒤부터 본다.
  const open = useRef<ReadonlySet<string>>(new Set());
  const tabs = args.host().windowTabs();
  const hostKeys = tabs.flatMap((tab) =>
    tab.key.startsWith(HOST_KEY) ? [tab.key] : [],
  );
  const joined = hostKeys.join();
  useEffect(() => {
    if (surface === null || !ready) return;
    const now = new Set(hostKeys);
    for (const key of open.current) {
      if (!now.has(key)) {
        void surface.report({
          tab: key.slice(HOST_KEY.length),
          state: "closed",
        });
      }
    }
    open.current = now;
  }, [surface, ready, joined]);
}
