import { useCallback, useEffect, useState } from "react";
import { t } from "@lophn/wording";

import type { Catalog, SourceResult } from "../source.ts";
import { RoleDetail } from "./detail/role-detail.tsx";
import { AttachForm } from "./operator/attach-form.tsx";
import type { OperatorScope } from "./operator/source.ts";
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
  /** 이 곳에 Operator를 붙이는 화면으로 연다(작업대의 [Attach an Operator]). */
  initialAttach?: OperatorScope;
  /** Operator 승인을 기다리며 확인하는 간격(ms). 테스트가 고정한다. */
  pollMs?: number;
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
    initialAttach,
    pollMs,
    now,
  }: RolesScreenProps,
) {
  const [current, setCurrent] = useState<string | null>(initialRole ?? null);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);
  const [attaching, setAttaching] = useState<
    { readonly scope: OperatorScope | undefined } | null
  >(initialAttach === undefined ? null : { scope: initialAttach });
  const [named, setNamed] = useState<Catalog>({
    projects: [],
    apps: [],
  });

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
      setNamed(result.value);
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
          onOpen={(id) => {
            setAttaching(null);
            setCurrent(id);
          }}
          onRetry={reload}
          onAttach={() => setAttaching({ scope: undefined })}
        />
      </div>
      <div className={listStyles.detailColumn} data-detail-column="">
        {attaching !== null
          ? (
            <AttachForm
              key={attaching.scope === undefined
                ? "pick"
                : `${attaching.scope.kind}:${attaching.scope.id}`}
              source={source}
              catalog={named}
              initialScope={attaching.scope}
              pollMs={pollMs}
              now={now}
              onDone={(assignment) => {
                setAttaching(null);
                if (assignment !== null) {
                  setCurrent(assignment);
                  reload();
                }
              }}
            />
          )
          : row === undefined
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
