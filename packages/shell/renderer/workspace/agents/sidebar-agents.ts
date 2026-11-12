// sidebar의 Agents 묶음이 그리는 줄. source.list가 받은 순서 그대로 옮기고(lophn이 첫 줄),
// Agents 탭이 저장·삭제로 목록을 바꾸면 reload로 다시 읽는다.
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  isLophn,
  lophnIdOf,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import { useRemembered } from "../../shell/sidebar-memory.tsx";
import type { AvatarProfile } from "../../parts/avatar/avatar.tsx";
import type { SidebarAgent } from "../sidebar/sidebar-agent.ts";
import { codingFaceOf } from "./coding-face.ts";
import { workspaceOf } from "./core-extensions.ts";
import type { AgentsSource } from "./source.ts";

export function useSidebarAgents(
  source: AgentsSource | undefined,
  project: string | null,
): {
  readonly agents: readonly SidebarAgent[];
  /** 모든 workspace의 lophn 이름(agent id → 이름). 아직 읽지 못했으면 비어 있다. */
  readonly lophnNames: Readonly<Record<string, string>>;
  readonly reload: () => void;
} {
  // workspace를 옮기면 새 목록을 읽기 전까지 창의 마지막 값에서 시작한다(범위 agent는 읽은 뒤 바뀐다). 비면 sidebar의 lophn session 줄이 모두 빠졌다 돌아온다.
  // 남은 lophn 줄은 옛 workspace의 것이라 id만 이 workspace의 lophn으로 바꿔 읽는다.
  const [remembered, setAgents] = useRemembered("agents");
  const mine = lophnIdOf(project === null ? null : workspaceOf(project));
  const agents = useMemo(
    () =>
      remembered.map((agent) =>
        isLophn(agent.assignment) ? { ...agent, assignment: mine } : agent,
      ),
    [remembered, mine],
  );
  const [reloads, setReloads] = useState(0);
  const [lophnNames, setLophnNames] = useRemembered("lophnNames");
  useEffect(() => {
    if (source === undefined) return;
    let live = true;
    void source.lophnNames().then((result) => {
      if (live && result.ok) setLophnNames(() => ({ ...result.value }));
    });
    return () => {
      live = false;
    };
  }, [source, reloads, setLophnNames]);
  useEffect(() => {
    if (source === undefined) return;
    let live = true;
    void source.list(project ?? "home").then((result) => {
      if (!live || !result.ok) return;
      setAgents(() =>
        result.value.flatMap((row) => {
          const profile: AvatarProfile =
            codingFaceOf(row.assignment) ??
            (row.profile.kind === "character"
              ? row.profile
              : {
                  kind: "image",
                  src: source.imageSrc(
                    project,
                    row.assignment,
                    row.profile.image,
                  ),
                });
          return [
            {
              assignment: row.assignment,
              name: row.name,
              profile,
              // 답을 기다리는 session은 conversation 쪽이 알려 줄 때 켠다.
              waiting: false,
            },
          ];
        }),
      );
    });
    return () => {
      live = false;
    };
  }, [source, project, reloads, setAgents]);
  const reload = useCallback(() => setReloads((count) => count + 1), []);
  return { agents, lophnNames, reload };
}
