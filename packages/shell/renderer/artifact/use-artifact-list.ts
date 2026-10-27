// domain들의 artifact 목록. 처음 mount할 때 읽고, reload()를 부르면 다시 읽는다.
// 줄은 domain 순서(주어진 순서), 이름 순이다.
import { useCallback, useEffect, useState } from "react";

import type { ArtifactListItem } from "../../ipc/artifact.ts";
import { useArtifactApi } from "./artifact-api.tsx";

export type DomainArtifactItem = ArtifactListItem & { domain: string };

export function useArtifactList(domains: readonly string[]): {
  items: readonly DomainArtifactItem[];
  reload(): void;
} {
  const api = useArtifactApi();
  const [items, setItems] = useState<readonly DomainArtifactItem[]>([]);
  const [round, setRound] = useState(0);
  // domains 배열은 렌더마다 새로 만들어질 수 있어 내용으로 비교한다.
  const key = domains.join(",");
  useEffect(() => {
    if (api === null) return;
    let live = true;
    const ids = key === "" ? [] : key.split(",");
    Promise.all(
      ids.map((domain) =>
        api.list({ domain }).then(
          (read) => read.artifacts.map((item) => ({ ...item, domain })),
          () => [],
        ),
      ),
    ).then((lists) => {
      if (live) setItems(lists.flat());
    });
    return () => {
      live = false;
    };
  }, [api, key, round]);
  const reload = useCallback(() => setRound((count) => count + 1), []);
  return { items, reload };
}
