// project나 앱의 artifact 목록. 처음 mount할 때 읽고, reload()를 부르면 다시 읽는다. 이름 순이다.
import { useCallback, useEffect, useState } from "react";

import type { ArtifactWorkspace } from "../../../protocol/projects/artifact.ts";
import type { ArtifactListItem } from "../../ipc/artifact.ts";
import { useArtifactApi } from "./artifact-api.tsx";

export function useArtifactList(workspace: ArtifactWorkspace | null): {
  items: readonly ArtifactListItem[];
  reload(): void;
} {
  const api = useArtifactApi();
  const [items, setItems] = useState<readonly ArtifactListItem[]>([]);
  const [round, setRound] = useState(0);
  const kind = workspace?.kind;
  const id = workspace?.id;
  useEffect(() => {
    if (api === null || kind === undefined || id === undefined) return;
    let live = true;
    api
      .list(kind === "project" ? { project: id } : { app: id })
      .then(
        (read) => read.artifacts,
        () => [],
      )
      .then((list) => {
        if (live) setItems(list);
      });
    return () => {
      live = false;
    };
  }, [api, kind, id, round]);
  const reload = useCallback(() => setRound((count) => count + 1), []);
  return { items, reload };
}
