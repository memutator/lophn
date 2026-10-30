// 상단 바 place switcher가 보이는 project·app 목록. 팔레트와 같은 통로(CatalogSource)를 쓰므로
// 보관한 앱·project는 나오지 않는다. 읽기 전·실패면 빈 목록이고, switcher는 지금 place 하나만 보인다.
import { useCallback, useEffect, useState } from "react";

import type { CatalogSource } from "../../desktop/palette/catalog.ts";
import type { PlaceOption } from "./place-selector.tsx";

export interface PlaceLists {
  readonly projects: readonly PlaceOption[];
  readonly apps: readonly PlaceOption[];
  /** 다시 읽는다. menu를 열 때 부른다. */
  readonly read: () => void;
}

export function usePlaceLists(source: CatalogSource | undefined): PlaceLists {
  const [projects, setProjects] = useState<readonly PlaceOption[]>([]);
  const [apps, setApps] = useState<readonly PlaceOption[]>([]);
  const read = useCallback(() => {
    if (source === undefined) return;
    void source.catalog().then((result) => {
      if (!result.ok) return;
      setProjects(
        result.value.projects.map((item) => ({
          id: item.id,
          label: item.title,
        })),
      );
      setApps(
        result.value.apps.map((item) => ({ id: item.id, label: item.title })),
      );
    });
  }, [source]);
  useEffect(read, [read]);
  return { projects, apps, read };
}
