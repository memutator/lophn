import { useCallback, useEffect, useState } from "react";
import { t } from "@lophn/wording";

import type { Catalog, SourceResult } from "../source.ts";
import { RoleDetail } from "./detail/role-detail.tsx";
import { RoleList } from "./list/role-list.tsx";
import { sortRoles } from "./model.ts";
import type { RoleRow, RolesSource } from "./source.ts";
import listStyles from "../documents/documents.module.css";

export interface RolesScreenProps {
  source: RolesSource;
  /** 프로젝트·앱 이름. 담당 범위의 이름을 보이는 데만 쓴다. */
  catalog: () => Promise<SourceResult<Catalog>>;
  /** core 연결이 (다시) 준비될 때마다 오른다. 마지막으로 읽은 것을 둔 채 현재 기록을 다시 읽는다. */
  connected?: number;
  /** 만든 문서를 documents 화면에서 읽는다. */
  onRead: (document: string, version: string | null) => void;
  /** 답을 기다리는 일의 확인할 것으로 간다. */
  onConfirm?: () => void;
  /** 그 앱의 앱 공간으로 간다. 작업 검토의 영향 링크가 쓴다. */
  onApp?: (app: string) => void;
  /** 처음 열 역할. */
  initialRole?: string;
  /** 상대 시각의 기준. 테스트가 고정한다. */
  now?: () => number;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly rows: readonly RoleRow[] };

// roles 화면. 왼쪽 목록 칸에서 역할을 고르고 오른쪽에서 하는 일·만든 것·대화·Preset을 본다(desktop#R4).
export function RolesScreen(
  {
    source,
    catalog,
    connected = 0,
    onRead,
    onConfirm,
    onApp,
    initialRole,
    now,
  }: RolesScreenProps,
) {
  const [current, setCurrent] = useState<string | null>(initialRole ?? null);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let live = true;
    void source.roles().then((result) => {
      if (!live) return;
      // 읽지 못하면 이전 목록을 둔다(마지막으로 읽은 것).
      setLoaded((previous) =>
        result.ok
          ? { kind: "ready", rows: sortRoles(result.value) }
          : previous.kind === "ready"
          ? previous
          : { kind: "failed" }
      );
    });
    void catalog().then((result) => {
      if (!live || !result.ok) return;
      const next: Record<string, string> = {};
      for (const item of [...result.value.projects, ...result.value.apps]) {
        next[item.id] = item.title;
      }
      setNames(next);
    });
    return () => {
      live = false;
    };
  }, [source, catalog, connected, attempt]);

  const row = loaded.kind === "ready"
    ? loaded.rows.find((item) => item.id === current)
    : undefined;
  return (
    <div className={listStyles.screen} data-screen-body="roles">
      <div className={listStyles.listColumn} data-list-column="">
        <RoleList
          loaded={loaded}
          names={names}
          current={current}
          onOpen={setCurrent}
          onRetry={reload}
        />
      </div>
      <div className={listStyles.detailColumn} data-detail-column="">
        {row === undefined
          ? (
            <p className={listStyles.placeholder} data-detail="none">
              {t("roles.empty.pick-role")}
            </p>
          )
          : (
            <RoleDetail
              key={row.id}
              source={source}
              role={row}
              names={names}
              connected={connected}
              onRead={onRead}
              onConfirm={onConfirm}
              onApp={onApp}
              onChanged={reload}
              now={now}
            />
          )}
      </div>
    </div>
  );
}
