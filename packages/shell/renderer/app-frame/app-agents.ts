// 앱 공간 agent select의 후보를 전역 agent 목록(AgentsSource.list)에서 읽는다. 정렬은 AgentSelect가 한다.
// 저장·삭제로 목록이 바뀌면 reload로 다시 읽는다.
import { useCallback, useEffect, useState } from "react";
import type { AvatarProfile } from "../parts/avatar/avatar.tsx";
import type { AgentsSource } from "../workspace/agents/source.ts";
import type { AppSpaceAgent } from "./agent-select.tsx";

export function useAppAgents(
  source: AgentsSource | undefined,
  app: string,
): { readonly agents: readonly AppSpaceAgent[]; readonly reload: () => void } {
  const [agents, setAgents] = useState<readonly AppSpaceAgent[]>([]);
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    if (source === undefined) return;
    let live = true;
    void source.list(app).then((result) => {
      if (!live || !result.ok) return;
      setAgents(
        result.value.flatMap((row) => {
          const profile: AvatarProfile =
            row.profile.kind === "character"
              ? row.profile
              : {
                  kind: "image",
                  src: source.imageSrc(app, row.assignment, row.profile.image),
                };
          return [
            {
              assignment: row.assignment,
              name: row.name,
              profile,
            },
          ];
        }),
      );
    });
    return () => {
      live = false;
    };
  }, [source, app, reloads]);
  const reload = useCallback(() => setReloads((count) => count + 1), []);
  return { agents, reload };
}
