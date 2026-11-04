// harness-gui 창: extension이 연 ACP session 하나를 lophn 채팅 화면(AgentView)으로 그린다. core도 lophn session도 없다.
// 갱신은 창의 feed가 접고(`acp-feed.ts`), 화면은 `AgentTabSource.external`을 보고 lophn 전용 칸을 그리지 않는다.
import { useEffect, useMemo, useState } from "react";

import type { HarnessGuiApi, HarnessGuiInfo } from "../../ipc/harness-gui.ts";
import { guiAgentTabSource } from "../conversation/agent-tab-gui-source.ts";
import { AgentView, type AgentViewHost } from "../conversation/agent-view.tsx";
import { DraftStore } from "../conversation/drafts.ts";
import { EventsProvider } from "../desktop/connection/events/hooks.tsx";
import { TopBar } from "../desktop/top-bar/top-bar.tsx";
import { createAcpFeed } from "./acp-feed.ts";
import styles from "./harness-gui-window.module.css";

// 열 곳이 없는 칸들이다. 대화는 이 창 하나뿐이고 lophn의 탭·설정으로 가는 길이 없다.
const NOWHERE = () => {};
const HOST: AgentViewHost = {
  openPermissions: NOWHERE,
  openAgentSettings: NOWHERE,
  openForked: NOWHERE,
  showUsage: NOWHERE,
  closeTab: NOWHERE,
};

/** preload가 연 통로로 그린다. 통로가 없으면(preload 없는 문서) 아무것도 그리지 않는다. */
export function HarnessGuiApp() {
  const api = (globalThis as { lophnHarnessGui?: HarnessGuiApi })
    .lophnHarnessGui;
  return api === undefined ? null : <HarnessGuiWindow api={api} />;
}

export function HarnessGuiWindow({
  api,
  now,
}: {
  api: HarnessGuiApi;
  now?: () => number;
}) {
  const feed = useMemo(() => createAcpFeed(now), [now]);
  const drafts = useMemo(() => new DraftStore(), []);
  const [info, setInfo] = useState<HarnessGuiInfo | null>(null);
  useEffect(() => {
    let live = true;
    void api.connect(feed.push).then((read) => {
      if (live) setInfo(read);
    });
    return () => {
      live = false;
    };
  }, [api, feed]);
  const source = useMemo(
    () =>
      info === null
        ? null
        : guiAgentTabSource({ info, feed, input: api.input }),
    [info, feed, api],
  );
  return (
    <div className={styles.window} data-harness-gui="">
      <TopBar />
      <div className={styles.body}>
        {source === null ? null : (
          <EventsProvider client={feed.client}>
            <AgentView
              source={source}
              drafts={drafts}
              session={feed.session}
              onSessionChange={NOWHERE}
              host={HOST}
              {...(now === undefined ? {} : { now })}
            />
          </EventsProvider>
        )}
      </div>
    </div>
  );
}
