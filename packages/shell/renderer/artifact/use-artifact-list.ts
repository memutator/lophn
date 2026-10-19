// project의 artifact 목록. 처음 mount할 때 읽고, reload()를 부르면 다시 읽는다.
import { useCallback, useEffect, useState } from "react";

import type { ArtifactListItem } from "../../ipc/artifact.ts";
import { useArtifactApi } from "./artifact-api.tsx";

export function useArtifactList(project: string): {
  items: readonly ArtifactListItem[];
  reload(): void;
} {
  const api = useArtifactApi();
  const [items, setItems] = useState<readonly ArtifactListItem[]>([]);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (api === null) return;
    let live = true;
    api.list({ project }).then(
      (read) => {
        if (live) setItems(read.artifacts);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, project, round]);
  const reload = useCallback(() => setRound((count) => count + 1), []);
  return { items, reload };
}
