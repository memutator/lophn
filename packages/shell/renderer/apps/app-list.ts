// 앱 목록 읽기. 보관한 앱까지 모두 읽고, 켜진 release의 번호를 붙여 런처 순서로 둔다.
import { useMemo } from "react";

import { appList } from "../../../protocol/apps/apps.ts";
import { releasesListRecords } from "../../../protocol/apps/activation/activation.ts";
import {
  type Loaded,
  type ReadHandle,
  useCoreRead,
} from "../desktop/connection/core-read.ts";
import { rowOf } from "./core-source.ts";
import { sortApps } from "./model.ts";
import type { AppRow } from "./source.ts";

// release 목록 한 번의 상한(route의 limit 상한). 켜진 release는 앱마다 하나라 앱이 이보다 많으면 넘는 앱은 번호 없이 보인다.
const ACTIVE_RELEASES = 200;

export function useAppList(): ReadHandle<readonly AppRow[]> {
  const apps = useCoreRead(appList, { limit: Number.MAX_SAFE_INTEGER });
  const releases = useCoreRead(releasesListRecords, {
    status: "active",
    limit: ACTIVE_RELEASES,
  });
  const loaded = useMemo((): Loaded<readonly AppRow[]> => {
    if (apps.loaded.state !== "ready") return apps.loaded;
    const numbers = new Map(
      releases.loaded.state === "ready"
        ? releases.loaded.value.releases.map((release) => [
            release.id,
            release.number,
          ])
        : [],
    );
    return {
      ...apps.loaded,
      value: sortApps(
        apps.loaded.value.apps.map((app) =>
          rowOf(
            app,
            app.active_release === null
              ? null
              : (numbers.get(app.active_release) ?? null),
          ),
        ),
      ),
    };
  }, [apps.loaded, releases.loaded]);
  return { loaded, reload: apps.reload };
}
