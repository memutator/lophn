// History 탭: 이 컴퓨터와 연결된 다른 컴퓨터의 영구 기록(release 결과, 앱이 남긴 알림 등)을 최근 것부터 합쳐 보이고
// 앱·project·종류로 거르고 글로 찾는다. 지워도 읽음으로만 바뀌어 남는다. 정본은 기계마다의 core `notices.list`다.

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
import { AppViewsProvider } from "../../../app-frame/app-views.tsx";
import { actionIcons } from "../../../icons/mod.ts";
import { type MachineRef, useMachineHub } from "../../machines/scope.tsx";
import { dismissNotice } from "./decide.ts";
import {
  type HistoryFilter,
  type HistoryNotice,
  markNoticesRead,
  NO_FILTER,
  TYPE_OPTIONS,
  type TypeFilter,
  useHistory,
} from "./history.ts";
import { useInboxNamesOf } from "./names.ts";
import { applyNoticeAction } from "./notice-action.ts";
import { KIND_LABEL } from "./notice-kinds.ts";
import { NoticeRow } from "./notice-row.tsx";
import styles from "./waiting.module.css";

const MARK_READ_BATCH = 200;

function typeLabel(type: Exclude<TypeFilter, "all">): string {
  if (type === "app") return t("waiting.label.type-app");
  if (type === "program") return t("waiting.label.type-program");
  return t(KIND_LABEL[type]);
}

function countLabels(
  entries: Iterable<{ readonly label: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { label } of entries) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

function optionLabel(
  label: string,
  machineName: string | undefined,
  counts: ReadonlyMap<string, number>,
): string {
  return (counts.get(label) ?? 0) > 1 && machineName !== undefined
    ? `${label} (${machineName})`
    : label;
}

function MachineAppIcon({
  app,
  machine,
}: {
  app: string;
  machine: MachineRef;
}) {
  const hub = useMachineHub();
  if (hub === null) return <AppTabIcon app={app} />;
  return (
    <AppViewsProvider value={hub.get(machine).appViews}>
      <AppTabIcon app={app} />
    </AppViewsProvider>
  );
}

export function HistoryView({
  onOpenApp,
}: {
  onOpenApp: (app: string, machine: string | null) => void;
}) {
  const namesOf = useInboxNamesOf();
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
  const { state, sources, coreOf, loadMore, reload } = useHistory(filter);
  const rows = state.status === "ready" ? state.rows : [];
  const [failed, setFailed] = useState(false);

  // 모든 연결된 기계의 이름 목록에서 필터 선택지를 모은다. 보관한 앱의 기록도 있으니 앱 이름은 읽은 줄에서도 모은다.
  const apps = new Map<
    string,
    { label: string; machine: MachineRef; machineName: string | undefined }
  >();
  const projects = new Map<
    string,
    { label: string; machineName: string | undefined }
  >();
  for (const source of sources) {
    const names = namesOf(source.machine);
    for (const [id, label] of names.apps) {
      if (!apps.has(id)) {
        apps.set(id, {
          label,
          machine: source.machine,
          machineName: source.name,
        });
      }
    }
    for (const [id, label] of names.projects) {
      if (!projects.has(id)) {
        projects.set(id, { label, machineName: source.name });
      }
    }
  }
  for (const row of rows) {
    if (row.app !== null && row.app_name !== null && !apps.has(row.app)) {
      apps.set(row.app, {
        label: row.app_name,
        machine: row.machine,
        machineName: row.machineName,
      });
    }
  }

  const appCounts = countLabels(apps.values());
  const projectCounts = countLabels(projects.values());
  const appOptions: SelectFilterOption[] = [...apps].map(([value, entry]) => ({
    value,
    label: optionLabel(entry.label, entry.machineName, appCounts),
    icon: <MachineAppIcon app={value} machine={entry.machine} />,
  }));
  const projectOptions: SelectFilterOption[] = [...projects].map(
    ([value, entry]) => ({
      value,
      label: optionLabel(entry.label, entry.machineName, projectCounts),
    }),
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

  async function runAction(
    row: HistoryNotice,
    action: NonNullable<Notice["action"]>,
  ) {
    setFailed(
      !(await applyNoticeAction(coreOf(row.machine), row, action, row.machine)),
    );
  }

  async function markAllRead() {
    const byMachine = new Map<MachineRef, string[]>();
    for (const row of unread) {
      const ids = byMachine.get(row.machine) ?? [];
      ids.push(row.id);
      byMachine.set(row.machine, ids);
    }
    await Promise.all(
      [...byMachine].map(async ([machine, ids]) => {
        const targetCore = coreOf(machine);
        for (let i = 0; i < ids.length; i += MARK_READ_BATCH) {
          await markNoticesRead(targetCore, ids.slice(i, i + MARK_READ_BATCH));
        }
      }),
    );
  }

  return (
    <div data-history="">
      <div className={styles.filters}>
        <SearchFilter value={typed} onChange={setTyped} />
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
          {projectOptions.length === 0 ? null : (
            <SelectFilter
              allLabel={t("waiting.label.filter-all-projects")}
              options={projectOptions}
              value={filter.project}
              onChange={(project) => setFilter((now) => ({ ...now, project }))}
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
        <div className={styles.filterActions}>
          <Button
            size="sm"
            icon={actionIcons.confirm}
            disabled={unread.length === 0}
            data-mark-all-read=""
            onClick={() => void markAllRead()}
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
          key={row.key}
          row={row}
          machineName={row.machineName}
          onOpen={(app) => onOpenApp(app, row.machine)}
          onDismiss={() => void dismissNotice(coreOf(row.machine), row.id)}
          onAction={(_one, action) => void runAction(row, action)}
        />
      ))}
      {state.status === "ready" && state.hasMore ? (
        <div className={styles.more}>
          <Button
            size="sm"
            icon={actionIcons.moveDown}
            disabled={state.loadingMore}
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
