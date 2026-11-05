// 앱 workspace의 Logs 목록 줄. run 기록(`AppSpace.runs`)에서 이 앱의 것만 남겨 줄로 옮긴다: 이 앱의 tool run과
// 이 앱 workspace에서 돈 agent run(그 agent가 앱 agent select에 있을 때). 다른 workspace의 run은 그 workspace 몫이다.
// run event가 계약에 없어서, 목록을 열 때와 열려 있는 동안 session 상태(`useSessions()`)가 바뀔 때마다 다시 읽는다.
import { useEffect, useMemo, useState } from "react";
import { t } from "@lophn/i18n";

import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import { useSessions } from "../desktop/connection/events/hooks.tsx";
import type { ReadResult } from "../workspace/source.ts";
import { lophnSessionDot } from "../parts/agent-session/lophn.ts";
import type { PanelSession } from "../workspace/sidebar/panel-types.ts";
import type { RunRecordView, RunRow } from "../workspace/sidebar/run-list.tsx";
import type { AvatarProfile } from "../parts/avatar/avatar.tsx";

/** run 줄에 이름과 avatar를 대는 agent. */
interface AppSpaceAgent {
  readonly assignment: string;
  readonly name: string;
  readonly profile: AvatarProfile;
}

interface Loaded {
  readonly records: readonly RunRecordView[];
  /** session id → 대화 source가 읽어 준 제목과 마지막 활동 시각(epoch ms). */
  readonly known: ReadonlyMap<
    string,
    { readonly title: string | null; readonly at: number }
  >;
}

const NOTHING: Loaded = { records: [], known: new Map() };

export function useAppRuns(
  read: (() => Promise<ReadResult<readonly RunRecordView[]>>) | undefined,
  app: string,
  agents: readonly AppSpaceAgent[],
  agentViewSource: AgentTabSourceFactory | undefined,
  /** run 목록이 열려 있는가. 닫혀 있으면 읽지 않는다. */
  active: boolean,
): readonly RunRow[] {
  const { sessions } = useSessions();
  const [loaded, setLoaded] = useState<Loaded>(NOTHING);
  useEffect(() => {
    if (read === undefined || !active) return;
    let live = true;
    void (async () => {
      const result = await read();
      // 실패하면 빈 목록이다(`useAppAgents`가 실패를 무시하는 것과 같다).
      const records = result.ok ? result.value : [];
      const known = new Map<string, { title: string | null; at: number }>();
      if (agentViewSource !== undefined) {
        await Promise.all(
          agents.map(async (agent) => {
            const sessionsRead = await agentViewSource({
              assignment: agent.assignment,
              workspace: { kind: "app", id: app },
            }).sessions();
            if (!sessionsRead.ok) return;
            for (const entry of sessionsRead.value) {
              known.set(entry.id, {
                title: entry.title,
                at: Date.parse(entry.activeAt) || 0,
              });
            }
          }),
        );
      }
      if (live) setLoaded({ records, known });
    })();
    return () => {
      live = false;
    };
  }, [read, active, app, agents, agentViewSource, sessions]);

  return useMemo(() => {
    const byId = new Map(agents.map((agent) => [agent.assignment, agent]));
    return [...loaded.records]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .flatMap((record): RunRow[] => {
        const at = Date.parse(record.created_at);
        if ("tool" in record.target) {
          return record.target.app === app
            ? [
                {
                  id: record.id,
                  name: record.job?.title ?? record.target.tool,
                  via: record.job === null ? null : record.target.tool,
                  profile: null,
                  state: record.state,
                  at,
                  session: null,
                },
              ]
            : [];
        }
        const target = record.target.agent;
        const atApp =
          target.workspace?.kind === "app" && target.workspace.id === app;
        const agent = atApp ? byId.get(target.agent) : undefined;
        if (agent === undefined) return [];
        return [
          {
            id: record.id,
            name: record.job?.title ?? agent.name,
            via: record.job === null ? null : agent.name,
            profile: agent.profile,
            state: record.state,
            at,
            session:
              record.session_opened && record.session !== null
                ? panelSessionOf(record.session, agent, at, loaded, sessions)
                : null,
          },
        ];
      });
  }, [loaded, sessions, agents, app]);
}

function panelSessionOf(
  id: string,
  agent: AppSpaceAgent,
  runAt: number,
  loaded: Loaded,
  sessions: ReturnType<typeof useSessions>["sessions"],
): PanelSession {
  const entry = sessions.find((item) => item.session === id);
  const read = loaded.known.get(id);
  return {
    id,
    title: read?.title ?? t("conversation.label.session-untitled"),
    agent: agent.assignment,
    dot: lophnSessionDot(sessions, id),
    open: entry !== undefined && entry.ended === null,
    // 대화 source가 시각을 모르면 run을 시작한 때다.
    at: read?.at ?? runAt,
  };
}
