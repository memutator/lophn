// sidebar가 터미널 coding agent session을 그리는 값. 이 창의 터미널 탭 가운데 coding agent가 도는 것(live)과 core가
// 저장한 session(saved, `terminals/saved_sessions`)을 합친다. 저장한 것 가운데 지금 도는 session은 live 줄 하나로만 남는다.
// live 줄의 제목과 상태 점은 탭 줄과 같은 값이다(부르는 쪽이 `tabs`로 넣는다).
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import type { HarnessId } from "../../../../protocol/coding-agent/harness-id.ts";
import {
  type TerminalAgentSession,
  terminalsSavedSessions,
} from "../../../../protocol/coding-agent/terminals.ts";
import { followCoreRead } from "../../desktop/connection/core-read.ts";
import type { SessionDot } from "../../parts/agent-session/activity.ts";
import { useRemembered } from "../../shell/sidebar-memory.tsx";
import type { TerminalDeps } from "../../terminal/deps.ts";
import type { PanelTerminal } from "./panel-types.ts";

/** 이 창의 터미널 탭 하나가 탭 줄에 보이는 이름과 점. */
export interface TerminalTabView {
  readonly key: string;
  readonly title: string;
  readonly dot: SessionDot | null;
}

const NO_SAVED: readonly TerminalAgentSession[] = [];

function harnessLabel(harness: string): string {
  return harness in HARNESS_ADAPTERS
    ? HARNESS_ADAPTERS[harness as HarnessId].label
    : harness;
}

export function usePanelTerminals(
  deps: TerminalDeps | undefined,
  /** Home이면 null이고 저장한 session이 없다. */
  project: string | null,
  tabs: readonly TerminalTabView[],
): readonly PanelTerminal[] {
  const store = deps?.store;
  const core = deps?.core ?? null;
  const version = useSyncExternalStore(
    (listener) => store?.subscribe(listener) ?? (() => {}),
    () => store?.version() ?? 0,
  );
  // workspace를 옮기면 창의 마지막 값에서 시작한다. 비면 Recent 수가 0에서 다시 차오른다.
  const [savedAll, setSavedAll] = useRemembered("savedTerminals");
  const saved =
    (project === null ? undefined : savedAll.get(project)) ?? NO_SAVED;
  useEffect(() => {
    if (core === null || project === null) return;
    const follow = followCoreRead<{ sessions: TerminalAgentSession[] }>(
      core.events,
      terminalsSavedSessions,
      { project },
      (loaded) => {
        if (loaded.state !== "ready") return;
        const sessions = loaded.value.sessions;
        setSavedAll((all) => new Map(all).set(project, sessions));
      },
      () => new Date(),
    );
    return () => follow.stop();
  }, [core, project, setSavedAll]);
  // hook은 시각을 알리지 않는다. 저장한 session의 마지막 움직임을 쓰고, 아직 저장 전이면 처음 본 때를 쓴다.
  const firstSeen = useRef(new Map<string, number>());
  return useMemo(() => {
    const savedBySession = new Map(
      saved.map((item) => [`${item.harness}:${item.external_session}`, item]),
    );
    const liveSessions = new Set<string>();
    const live = tabs.flatMap((tab): PanelTerminal[] => {
      const agent = store?.agentOf(tab.key);
      // hook으로 연결을 확인한 agent만 session이다. foreground로만 알아본 것은 탭 icon에만 보인다.
      if (agent === undefined || !agent.hooked) return [];
      const id =
        agent.session === undefined
          ? undefined
          : `${agent.harness}:${agent.session}`;
      if (id !== undefined) liveSessions.add(id);
      const seen = firstSeen.current.get(tab.key) ?? Date.now();
      firstSeen.current.set(tab.key, seen);
      const terminalRef = store?.refOf(tab.key);
      return [
        {
          key: tab.key,
          ...(terminalRef === null || terminalRef === undefined
            ? {}
            : { terminalRef }),
          harness: agent.harness,
          label: harnessLabel(agent.harness),
          title: tab.title,
          dot: tab.dot,
          at:
            (id === undefined ? undefined : savedBySession.get(id)?.last_at) ??
            seen,
          live: { tabKey: tab.key },
          saved: null,
        },
      ];
    });
    const rest = saved.flatMap((item): PanelTerminal[] =>
      liveSessions.has(`${item.harness}:${item.external_session}`)
        ? []
        : [
            {
              key: `${item.harness}:${item.external_session}`,
              harness: item.harness,
              label: harnessLabel(item.harness),
              title: item.name ?? item.title ?? harnessLabel(item.harness),
              dot: null,
              at: item.last_at,
              live: null,
              saved: {
                folderRef: item.folder_ref,
                externalSession: item.external_session,
                resumable: item.resumable,
              },
            },
          ],
    );
    return [...live, ...rest];
  }, [store, version, saved, tabs]);
}
