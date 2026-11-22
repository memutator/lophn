// 앱 workspace의 Logs 목록 줄. run 기록(`runs/list`)에서 이 앱의 것만 남겨 줄로 옮긴다: 이 앱의 tool run과
// 이 앱 workspace에서 돈 agent run(그 agent가 앱 agent select에 있을 때). 다른 workspace의 run은 그 workspace 몫이다.
// 목록이 열려 있는 동안 runs·jobs 변경으로 다시 읽는다.

import { t } from "@lophn/i18n";
import { useEffect, useMemo, useState } from "react";
import type { z } from "zod";

import { jobList } from "../../../protocol/jobs/jobs.ts";
import { runList } from "../../../protocol/runs/runs.ts";
import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import { followCoreRead } from "../desktop/connection/core-read.ts";
import {
  useEventClient,
  useSessions,
} from "../desktop/connection/events/hooks.tsx";
import { lophnSessionDot } from "../parts/agent-session/lophn.ts";
import type { AvatarLook } from "../parts/avatar/avatar.tsx";
import type { PanelSession } from "../workspace/sidebar/panel-types.ts";
import type { RunRecordView, RunRow } from "../workspace/sidebar/run-list.tsx";

/** run 줄에 이름과 avatar를 대는 agent. */
interface AppSpaceAgent {
  readonly assignment: string;
  readonly name: string;
  readonly avatar: AvatarLook;
}

type RawRun = z.output<typeof runList.output>["runs"][number];

/** session id → 대화 source가 읽어 준 제목과 마지막 활동 시각(epoch ms). */
type Known = ReadonlyMap<
  string,
  { readonly title: string | null; readonly at: number }
>;

export function useAppRuns(
  /** 앱 workspace가 아니면 null이고 읽지 않는다. */
  app: string | null,
  agents: readonly AppSpaceAgent[],
  agentViewSource: AgentTabSourceFactory | undefined,
  /** run 목록이 열려 있는가. 닫혀 있으면 읽지 않는다. */
  active: boolean,
): readonly RunRow[] {
  const { sessions } = useSessions();
  const client = useEventClient();
  // 못 읽으면 빈 목록이다(`useAppAgents`가 실패를 무시하는 것과 같다).
  const [runs, setRuns] = useState<readonly RawRun[]>([]);
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const [known, setKnown] = useState<Known>(new Map());

  useEffect(() => {
    if (app === null || !active) return;
    const now = () => new Date();
    const followed = [
      followCoreRead<z.output<typeof runList.output>>(
        client,
        runList,
        { workspace: { app } },
        (loaded) => {
          if (loaded.state === "ready") setRuns(loaded.value.runs);
        },
        now,
      ),
      followCoreRead<z.output<typeof jobList.output>>(
        client,
        jobList,
        {},
        (loaded) => {
          if (loaded.state !== "ready") return;
          setTitles(
            new Map(loaded.value.jobs.map((job) => [job.id, job.title])),
          );
        },
        now,
      ),
    ];
    return () => {
      for (const one of followed) one.stop();
    };
  }, [client, app, active]);

  // session 제목은 run 목록이 바뀔 때(새 run, 끝난 run) 그 agent들의 session 목록에서 다시 읽는다.
  useEffect(() => {
    if (app === null || !active || agentViewSource === undefined) return;
    let live = true;
    void (async () => {
      const found = new Map<string, { title: string | null; at: number }>();
      await Promise.all(
        agents.map(async (agent) => {
          const sessionsRead = await agentViewSource({
            assignment: agent.assignment,
            workspace: { kind: "app", id: app },
          }).sessions();
          if (!sessionsRead.ok) return;
          for (const entry of sessionsRead.value) {
            found.set(entry.id, {
              title: entry.title,
              at: Date.parse(entry.activeAt) || 0,
            });
          }
        }),
      );
      if (live) setKnown(found);
    })();
    return () => {
      live = false;
    };
  }, [runs, active, app, agents, agentViewSource]);

  const records = useMemo(
    () =>
      runs.map((run): RunRecordView => {
        const title = run.job === null ? undefined : titles.get(run.job);
        return {
          id: run.id,
          kind: run.kind,
          target: run.target,
          session: run.session,
          session_opened: run.session_opened,
          state: run.state,
          created_at: run.created_at,
          job:
            run.job === null || title === undefined
              ? null
              : { id: run.job, title },
        };
      }),
    [runs, titles],
  );

  return useMemo(() => {
    if (app === null) return [];
    const byId = new Map(agents.map((agent) => [agent.assignment, agent]));
    return [...records]
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
                  avatar: null,
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
            avatar: agent.avatar,
            state: record.state,
            at,
            session:
              record.session_opened && record.session !== null
                ? panelSessionOf(record.session, agent, at, known, sessions)
                : null,
          },
        ];
      });
  }, [records, known, sessions, agents, app]);
}

function panelSessionOf(
  id: string,
  agent: AppSpaceAgent,
  runAt: number,
  known: Known,
  sessions: ReturnType<typeof useSessions>["sessions"],
): PanelSession {
  const entry = sessions.find((item) => item.session === id);
  const read = known.get(id);
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
