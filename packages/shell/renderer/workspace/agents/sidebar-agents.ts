// sidebar의 Agents 묶음이 그리는 줄. source.list가 받은 순서 그대로 옮기고(lophn이 첫 줄),
// Agents 탭이 저장·삭제로 목록을 바꾸면 reload로 다시 읽는다.
import { useCallback, useEffect, useState } from "react";

import { useRemembered } from "../../shell/sidebar-memory.tsx";
import type { AvatarProfile } from "../../parts/avatar/avatar.tsx";
import type { SidebarAgent } from "../sidebar/sidebar-agent.ts";
import type { AgentsSource } from "./source.ts";

export function useSidebarAgents(
  source: AgentsSource | undefined,
  project: string | null,
): { readonly agents: readonly SidebarAgent[]; readonly reload: () => void } {
  // 목록은 전역이라 workspace를 옮겨도 창의 마지막 값에서 시작한다. 비면 sidebar의 lophn session 줄이 모두 빠졌다 돌아온다.
  const [agents, setAgents] = useRemembered("agents");
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    if (source === undefined) return;
    let live = true;
    void source.list(project ?? "home").then((result) => {
      if (!live || !result.ok) return;
      setAgents(() =>
        result.value.flatMap((row) => {
          const profile: AvatarProfile =
            row.profile.kind === "character"
              ? row.profile
              : {
                  kind: "image",
                  src: source.imageSrc(
                    project,
                    row.assignment,
                    row.profile.image,
                  ),
                };
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
  return { agents, reload };
}
