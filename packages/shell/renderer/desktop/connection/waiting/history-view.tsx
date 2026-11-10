// History 탭: 영구 기록(release 결과, 앱이 남긴 알림 등)을 최근 것부터 보이고 앱·project·종류로 거르고 글로 찾는다.
// 지워도 읽음으로만 바뀌어 남는다. 정본은 core `notices.list`라 보관한 앱의 기록도 읽힌다.

import { t } from "@lophn/i18n";
import { ErrorState } from "@lophn/ui/feedback";
import {
  DateRangeFilter,
  FilterBar,
  SearchFilter,
  SelectFilter,
  type SelectFilterOption,
} from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import { useEffect, useState } from "react";
import type { Notice } from "../../../../../protocol/apps/notice.ts";
import { AppTabIcon } from "../../../app-frame/app-icon.tsx";
import { actionIcons } from "../../../icons/mod.ts";
import { useEventClient } from "../events/hooks.tsx";
import { dismissNotice } from "./decide.ts";
import {
  type HistoryFilter,
  markNoticesRead,
  NO_FILTER,
  TYPE_OPTIONS,
  type TypeFilter,
  useHistory,
} from "./history.ts";
import { useInboxNames } from "./names.ts";
import { applyNoticeAction } from "./notice-action.ts";
import { KIND_LABEL } from "./notice-kinds.ts";
import { NoticeRow } from "./notice-row.tsx";
import styles from "./waiting.module.css";

function typeLabel(type: Exclude<TypeFilter, "all">): string {
  if (type === "app") return t("waiting.label.type-app");
  if (type === "program") return t("waiting.label.type-program");
  return t(KIND_LABEL[type]);
}

export function HistoryView({
  onOpenApp,
}: {
  onOpenApp: (app: string) => void;
}) {
  const core = useEventClient().core;
  const names = useInboxNames();
  const [filter, setFilter] = useState<HistoryFilter>(NO_FILTER);
  // 글자마다 읽지 않게 멈춘 뒤 거른다.
  const [typed, setTyped] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () => setFilter((now) => ({ ...now, query: typed })),
      250,
    );
    return () => clearTimeout(timer);
  }, [typed]);
  const { state, loadMore, reload } = useHistory(filter);
  const rows = state.status === "ready" ? state.rows : [];
  const [failed, setFailed] = useState(false);

  // 보관한 앱의 기록도 있으니 앱 이름은 읽은 줄에서도 모은다.
  const apps = new Map(names.apps);
  for (const row of rows) {
    if (row.app !== null && row.app_name !== null) {
      apps.set(row.app, row.app_name);
    }
  }
  const appOptions: SelectFilterOption[] = [...apps].map(([value, label]) => ({
    value,
    label,
    icon: <AppTabIcon app={value} />,
  }));
  const projectOptions: SelectFilterOption[] = [...names.projects].map(
    ([value, label]) => ({ value, label }),
  );
  const typeOptions: SelectFilterOption[] = TYPE_OPTIONS.map((value) => ({
    value,
    label: typeLabel(value),
  }));

  const unread = rows.filter((row) => row.read_at === null);
  const dirty =
    filter.app !== null ||
    filter.project !== null ||
    filter.type !== "all" ||
    filter.range !== null ||
    typed !== "";
  const filtered = dirty;

  async function runAction(row: Notice, action: NonNullable<Notice["action"]>) {
    setFailed(!(await applyNoticeAction(core, row, action)));
  }

  return (
    <div data-history="">
      <div className={styles.filters}>
        <SearchFilter value={typed} onChange={setTyped} />
        <div className={styles.filterRow}>
          <FilterBar
            dirty={dirty}
            onReset={() => {
              setTyped("");
              setFilter(NO_FILTER);
            }}
          >
            <DateRangeFilter
              value={filter.range}
              now={new Date()}
              onChange={(range) => setFilter((now) => ({ ...now, range }))}
            />
            <SelectFilter
              allLabel={t("waiting.label.filter-all-apps")}
              options={appOptions}
              value={filter.app}
              onChange={(app) => setFilter((now) => ({ ...now, app }))}
            />
            {names.projects.size === 0 ? null : (
              <SelectFilter
                allLabel={t("waiting.label.filter-all-projects")}
                options={projectOptions}
                value={filter.project}
                onChange={(project) =>
                  setFilter((now) => ({ ...now, project }))
                }
              />
            )}
            <SelectFilter
              allLabel={t("waiting.label.type-all")}
              options={typeOptions}
              value={filter.type === "all" ? null : filter.type}
              onChange={(type) =>
                setFilter((now) => ({
                  ...now,
                  type: (type ?? "all") as TypeFilter,
                }))
              }
            />
          </FilterBar>
          <Button
            size="sm"
            icon={actionIcons.confirm}
            disabled={unread.length === 0}
            data-mark-all-read=""
            onClick={() =>
              void markNoticesRead(
                core,
                unread.slice(0, 200).map((row) => row.id),
              )
            }
          >
            {t("waiting.button.mark-all-read")}
          </Button>
        </div>
      </div>
      {failed ? (
        <p className={styles.error}>{t("waiting.notice.action-failed")}</p>
      ) : null}
      {state.status === "failed" ? (
        <ErrorState
          target={t("waiting.label.history-target")}
          onRetry={reload}
        />
      ) : null}
      {state.status === "loading" ? (
        <p className={styles.empty}>{t("waiting.notice.history-loading")}</p>
      ) : null}
      {state.status === "ready" && rows.length === 0 ? (
        <p className={styles.empty} data-history-empty="">
          {t(
            filtered
              ? "waiting.notice.history-empty-filtered"
              : "waiting.notice.history-empty",
          )}
        </p>
      ) : null}
      {rows.map((row) => (
        <NoticeRow
          key={row.id}
          row={row}
          onOpen={onOpenApp}
          onDismiss={(id) => void dismissNotice(core, id)}
          onAction={(one, action) => void runAction(one, action)}
        />
      ))}
      {state.status === "ready" && state.next !== null ? (
        <div className={styles.more}>
          <Button
            size="sm"
            icon={actionIcons.moveDown}
            data-history-more=""
            onClick={loadMore}
          >
            {t("waiting.button.history-more")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
