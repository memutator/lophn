// sidebar의 Agents 묶음이 그리는 줄. 목록만 읽어 줄 값으로 옮기고, Agents 탭이 저장·삭제로
// 목록을 바꾸면 changed로 다시 읽는다.
import { useCallback, useEffect, useState } from "react";
import type { AvatarProfile } from "@lophn/design/components";

import type { SidebarAgent } from "../sidebar/agents-section.tsx";
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
        // App Engineer는 앱 공간의 agent라 project sidebar에 없다.
        result.value.flatMap((row) => {
          if (row.role === "app_engineer") return [];
          const profile: AvatarProfile = row.profile.kind === "icon"
            ? { kind: "icon", icon: row.profile.icon }
            : {
              kind: "image",
              src: source.imageSrc(project, row.assignment, row.profile.image),
            };
          return [{
            assignment: row.assignment,
            role: row.role,
            name: row.name,
            profile,
            // 답을 기다리는 session은 conversation 쪽이 알려 줄 때 켠다.
            waiting: false,
          }];
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
