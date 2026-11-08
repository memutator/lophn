// core의 host queue가 시킨 탭 열기·닫기(agent가 `lophn tab open|close`로 한 것)를 이 창에서 한다. main이 이 창이 보이는
// workspace를 알아야 요청을 보내므로 layout을 다 읽은 뒤에 알리고, 탭을 연 뒤에만 ack한다(못 열면 ack하지 않아 main이
// retry로 되돌린다). 열린 탭의 key는 `host:<tab id>`다. host 탭의 browser 상태와 닫힘은 main을 거쳐 core에 알린다.
import { useEffect, useRef } from "react";

import type { LophnBrowserApi } from "../../ipc/browser.ts";
import type { LophnSurfaceApi } from "../../ipc/surface.ts";
import { type WorkspaceRef, workspaceKey } from "../shell/desk-model.ts";
import { sessionOf } from "./agent/tab-fields.ts";
import type { SessionTabOpen } from "./kinds/agent.tsx";
import { openBrowserTab } from "./kinds/browser.tsx";
import type { TabHost } from "./kinds/host.ts";
import { openAt } from "./open-policy.ts";

const HOST_KEY = "host:";

export function surfaceApi(): LophnSurfaceApi | null {
  return (
    (globalThis as { lophnSurface?: LophnSurfaceApi }).lophnSurface ?? null
  );
}

type Args = {
  surface: LophnSurfaceApi | null;
  workspace: WorkspaceRef;
  /** 이 workspace의 layout을 다 읽었다. */
  ready: boolean;
  host: () => TabHost;
  /** 그 session의 agent 탭을 연다. session이나 agent 목록을 아직 모르면 열지 않고 false다. */
  openSession: (session: string, open: SessionTabOpen) => boolean;
  browserApi: LophnBrowserApi | null;
  /** browser view의 session으로 그 화면의 탭 key를 찾는다. */
  keyOf: (session: string) => string | undefined;
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
      const { host, openSession } = latest.current;
      if (workspaceKey(request.workspace) !== workspaceKey(host().workspace)) {
        return;
      }
      const key = `${HOST_KEY}${request.payload.tab}`;
      const done = () =>
        void surface.ack({ request: request.id, opened: true });
      if (request.kind === "tab_close") {
        // 없는 탭(이미 닫았거나 이미 열려 있던 session 탭을 가리킨 것)은 닫을 것이 없어 끝난 일이다.
        if (
          host()
            .windowTabs()
            .some((tab) => tab.key === key)
        ) {
          host().removeTab(key);
        }
        done();
        return;
      }
      const { target, place, source } = request.payload;
      // source는 연 agent의 session을 이 창에서 보이는 agent 탭이다. 없으면 desk 끝이다.
      const sourceTab =
        source === null
          ? undefined
          : host()
              .windowTabs()
              .find((tab) => tab.kind === "agent" && sessionOf(tab) === source);
      const at = openAt(host().desk, sourceTab?.key, "show", place);
      const open: SessionTabOpen = {
        key,
        float: at.kind === "float",
        options: {
          select: false,
          ...(at.kind === "tab"
            ? { after: at.after, beside: at.beside, grow: at.grow }
            : {}),
        },
      };
      if ("session" in target) {
        if (openSession(target.session, open)) done();
        return;
      }
      openBrowserTab(host(), target.browser.url, open);
      done();
    });
  }, [surface, ready]);

  // host 탭의 browser 상태. 접힌 float이나 다른 desk의 탭도 mount와 상관없이 받는다.
  useEffect(() => {
    const { browserApi } = latest.current;
    if (surface === null || browserApi === null) return;
    return browserApi.subscribeState((state) => {
      const key = latest.current.keyOf(state.view_session);
      if (key === undefined || !key.startsWith(HOST_KEY)) return;
      void surface.report({
        tab: key.slice(HOST_KEY.length),
        state: { url: state.url, title: state.title, loading: state.loading },
      });
    });
  }, [surface, args.browserApi]);

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
