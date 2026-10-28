// sidebar의 Agents 묶음이 그리는 줄. source.list가 받은 순서 그대로 옮기고(lophn이 첫 줄),
// Agents 탭이 저장·삭제로 목록을 바꾸면 reload로 다시 읽는다.
import { useCallback, useEffect, useState } from "react";
import type { AvatarProfile } from "../../parts/avatar/avatar.tsx";
import type {
  SidebarAgent,
  SidebarAgentRole,
} from "../sidebar/sidebar-agent.ts";
import type { AgentsSource } from "./source.ts";

export function useSidebarAgents(
  source: AgentsSource | undefined,
  project: string,
): { readonly agents: readonly SidebarAgent[]; readonly reload: () => void } {
  const [agents, setAgents] = useState<readonly SidebarAgent[]>([]);
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    if (source === undefined) return;
    let live = true;
    void source.list(project).then((result) => {
      if (!live || !result.ok) return;
      setAgents(
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
          // SidebarAgentRole은 옛 꼴이라, 지금 나오는 lophn·operator 값은 그대로 들어간다.
          const role = row.role as SidebarAgentRole;
          return [
            {
              assignment: row.assignment,
              role,
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
  }, [source, project, reloads]);
  const reload = useCallback(() => setReloads((count) => count + 1), []);
  return { agents, reload };
}
