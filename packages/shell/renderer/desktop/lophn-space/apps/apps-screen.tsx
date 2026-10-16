// lophn 공간 apps 화면. 등록한 앱을 사람이 지은 이름과 상태로 보이고, 열기·보관·꺼내기를 둔다. 앱 등록은
// 이 화면의 일이 아니다. 보관은 되돌릴 수 있어 묻지 않고 하고 결과만 알린다. 원시 enum·ID는 보이지 않는다.
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  ErrorState,
  Icon,
  iconPixels,
  Loading,
  Skeleton,
  StatusMark,
} from "@lophn/design/components";
import { t } from "@lophn/wording";
import { appSpaceIcons, lophnSpaceIcons } from "../../../icons/mod.ts";

import { appStatus, sortApps, statusLabel, statusTone } from "./model.ts";
import type { AppRow, AppsSource, RunState } from "./source.ts";
import styles from "./apps-screen.module.css";

export interface AppsScreenProps {
  source: AppsSource;
  /** 그 앱의 앱 공간을 연다. */
  onOpen: (app: string) => void;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly rows: readonly AppRow[] };

type Notice =
  | { readonly kind: "archived" | "restored" | "failed"; readonly name: string }
  | { readonly kind: "changed" };

function noticeText(notice: Notice): string {
  switch (notice.kind) {
    case "archived":
      return t("apps.notice.archived", { name: notice.name });
    case "restored":
      return t("apps.notice.restored", { name: notice.name });
    case "failed":
      return t("apps.error.action-failed", { name: notice.name });
    case "changed":
      return t("apps.error.changed");
  }
}

export function AppsScreen({ source, onOpen }: AppsScreenProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  // 실행 상태를 다 읽기 전에는 null이다. 그동안 상태 칸을 비워 둔다.
  const [runs, setRuns] = useState<Readonly<Record<string, RunState>> | null>(
    null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await source.list();
    if (!result.ok) {
      setLoaded({ state: "failed" });
      return;
    }
    const rows = sortApps(result.value);
    setLoaded({ state: "ready", rows });
    // 보관하지 않은 앱만 지금 실행 상태를 읽는다. core reader는 한 사람의 동시 읽기 수를
    // 제한하므로 하나씩 읽는다. 읽지 못한 앱은 상태를 모른다고 보인다.
    const next: Record<string, RunState> = {};
    for (const row of rows) {
      if (row.archived) continue;
      const run = await source.runtime(row.id);
      if (run.ok) next[row.id] = run.value;
    }
    setRuns(next);
  }, [source]);

  // 처음 열 때와 core가 다시 준비될 때 읽는다. 준비 전 실패를 그대로 두지 않는다.
  useEffect(() => {
    let previous: string | null = null;
    const stop = source.watch((state) => {
      if (state.state === "ready" && previous !== "ready") void load();
      previous = state.state;
    });
    if (previous === null) void load();
    return stop;
  }, [source, load]);

  async function toggleArchive(row: AppRow): Promise<void> {
    setBusy(row.id);
    const result = await source.setArchived(row, !row.archived);
    setBusy(null);
    if (result.ok) {
      setNotice({
        kind: result.value.archived ? "archived" : "restored",
        name: result.value.name,
      });
    } else {
      setNotice(
        result.code === "conflict"
          ? { kind: "changed" }
          : { kind: "failed", name: row.name },
      );
    }
    await load();
  }

  const rows = loaded.state === "ready" ? loaded.rows : [];
  const active = rows.filter((row) => !row.archived);
  const archived = rows.filter((row) => row.archived);

  const name = (row: AppRow) => (
    <span className={styles.rowMain}>
      <Icon
        icon={appSpaceIcons.app}
        pixels={iconPixels("base")}
        className={styles.rowIcon}
      />
      <span className={styles.name}>{row.name}</span>
    </span>
  );

  let body;
  if (loaded.state === "failed") {
    body = (
      <ErrorState
        target={t("apps.label.list-target")}
        onRetry={() => {
          setLoaded({ state: "loading" });
          void load();
        }}
      />
    );
  } else if (loaded.state === "ready" && rows.length === 0) {
    body = <p className={styles.empty}>{t("apps.empty.no-apps")}</p>;
  } else {
    body = (
      <Loading
        loading={loaded.state === "loading"}
        placeholder={<Skeleton lines={4} />}
      >
        <h2 className={styles.groupTitle}>{t("apps.heading.apps")}</h2>
        <ul className={styles.rows} aria-label={t("apps.title.screen")}>
          {active.map((row) => {
            const status = runs !== null
              ? appStatus(row, runs[row.id] ?? null)
              : null;
            return (
              <li
                key={row.id}
                className={styles.row}
                data-app-row=""
                data-status={status ?? undefined}
              >
                <span className={styles.rowMain}>
                  {name(row)}
                  {status === null ? null : (
                    <StatusMark
                      tone={statusTone(status)}
                      label={statusLabel(status)}
                    />
                  )}
                </span>
                <span className={styles.actions}>
                  <Button
                    size="sm"
                    data-action="open"
                    onClick={() => onOpen(row.id)}
                  >
                    {t("apps.button.open")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={lophnSpaceIcons.archive}
                    data-action="archive"
                    disabled={busy === row.id}
                    onClick={() => void toggleArchive(row)}
                  >
                    {t("apps.button.archive")}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
        {archived.length === 0 ? null : (
          <>
            <h2 className={styles.groupTitle}>{t("apps.heading.archived")}</h2>
            <ul className={styles.rows}>
              {archived.map((row) => (
                <li
                  key={row.id}
                  className={styles.row}
                  data-app-row=""
                  data-status="archived"
                >
                  {name(row)}
                  <Button
                    size="sm"
                    icon={lophnSpaceIcons.unarchive}
                    data-action="restore"
                    disabled={busy === row.id}
                    onClick={() => void toggleArchive(row)}
                  >
                    {t("apps.button.unarchive")}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Loading>
    );
  }

  return (
    <section className={styles.screen} data-screen-body="apps">
      <div className={styles.page}>
        <p className={styles.muted}>{t("apps.intro.screen")}</p>
        {notice
          ? (
            <p
              className={styles.notice}
              role="status"
              data-notice={notice.kind}
            >
              {noticeText(notice)}
            </p>
          )
          : null}
        {body}
      </div>
    </section>
  );
}
