// Activity 탭. 호출 기록 목록, 한 호출을 펼친 세부, 그리고 rewind panel로 가는 단추.
// 성공한 읽기는 기록하지 않는다. 호출 성공은 업무가 맞다는 뜻이 아니다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { formatRelativeTime, t } from "@lophn/i18n";
import { KIND_LABEL } from "../../../desktop/connection/waiting/notice-kinds.ts";

import { Loadable } from "../loadable.tsx";
import {
  callerText,
  callName,
  callStateText,
  callTime,
  canRewind,
  releaseName,
} from "../model.ts";
import { EffectPill, Facts, Mono, Pill } from "../parts.tsx";
import type {
  ActivityRow,
  ActivityView,
  AppDetailSource,
  Caller,
} from "../source.ts";
import { useActivityView } from "../reads.ts";
import styles from "../app-detail.module.css";
import { RewindPanel } from "./rewind-panel.tsx";
import { actionIcons } from "../../../icons/mod.ts";

interface ActivityTabProps {
  app: string;
  /** 앱 이름. rewind panel이 쓴다. */
  name: string;
  source: AppDetailSource;
  now: () => Date;
  /** agent session을 연다. 없으면 session 이름만 보인다. */
  onOpenSession?: (session: string) => void;
}

export function ActivityTab({
  app,
  name,
  source,
  now,
  onOpenSession,
}: ActivityTabProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [rewind, setRewind] = useState<string | null>(null);
  if (rewind !== null) {
    return (
      <RewindPanel
        app={app}
        name={name}
        from={rewind}
        source={source}
        now={now}
        onBack={() => setRewind(null)}
      />
    );
  }
  return (
    <div className={styles.tab} data-tab-body="activity">
      <ActivityList
        app={app}
        now={now}
        open={open}
        onOpen={setOpen}
        onRewind={setRewind}
        onOpenSession={onOpenSession}
      />
    </div>
  );
}

function SessionLink({
  caller,
  onOpenSession,
}: {
  caller: Extract<Caller, { kind: "agent" }>;
  onOpenSession?: (session: string) => void;
}) {
  const label = caller.title ?? t("app-detail.label.session-unnamed");
  return onOpenSession === undefined ? (
    <span className={styles.muted}>{label}</span>
  ) : (
    <button
      type="button"
      className={styles.link}
      data-open-session={caller.session}
      onClick={() => onOpenSession(caller.session)}
    >
      {label}
    </button>
  );
}

function StateCell({ row }: { row: ActivityRow }) {
  const text = callStateText(row);
  if (row.undone || row.state === "waiting" || row.state === "running") {
    return <Pill tone="neutral">{text}</Pill>;
  }
  if (row.state === "failed" || row.state === "unknown") {
    return <Pill tone="critical">{text}</Pill>;
  }
  return <span className={styles.muted}>{text}</span>;
}

function CalledBy({
  row,
  onOpenSession,
}: {
  row: ActivityRow;
  onOpenSession?: (session: string) => void;
}) {
  const caller = row.caller;
  switch (caller.kind) {
    case "agent":
      return (
        <span>
          {callerText(caller)} ·{" "}
          <SessionLink caller={caller} onOpenSession={onOpenSession} /> ·{" "}
          {t("app-detail.label.turn")} <Mono>{caller.turn}</Mono> ·{" "}
          {t("app-detail.label.tool-call")} <Mono>{caller.toolCall}</Mono>
        </span>
      );
    case "app":
      return (
        <span>
          {caller.releaseNumber === null
            ? (caller.appName ?? t("app-detail.label.caller-app-unnamed"))
            : t("app-detail.label.called-by-app", {
                name:
                  caller.appName ?? t("app-detail.label.caller-app-unnamed"),
                release: releaseName(caller.releaseNumber),
              })}
        </span>
      );
    case "program":
      return <span>{t("app-detail.label.called-by-program")}</span>;
    case "flow":
      return <span>{t("app-detail.label.called-by-flow")}</span>;
    case "event":
      return (
        <span>
          {t("app-detail.label.called-by-event", {
            name:
              caller.publisherName ?? t("app-detail.label.caller-app-unnamed"),
            event: caller.event,
          })}
        </span>
      );
    case "remote":
      return (
        <span>
          {callerText(caller)} · <Mono>{caller.machine}</Mono>
        </span>
      );
    case "start":
      return (
        <span>
          {caller.reason === "activation"
            ? t("app-detail.label.called-by-activation")
            : t("app-detail.label.called-by-restart")}
        </span>
      );
    case "person":
      return <span>{t("app-detail.label.called-by-person")}</span>;
  }
}

function Detail({
  row,
  onOpenSession,
}: {
  row: ActivityRow;
  onOpenSession?: (session: string) => void;
}) {
  return (
    <div className={styles.detail} data-invocation-detail={row.id}>
      <Facts
        rows={[
          [
            t("app-detail.label.fact-called-by"),
            <CalledBy key="by" row={row} onOpenSession={onOpenSession} />,
          ],
          [
            t("app-detail.label.fact-input-fingerprint"),
            row.inputHash === null ? (
              t("app-detail.label.input-none")
            ) : (
              <span key="in">
                <Mono>{row.inputHash}</Mono>{" "}
                <span className={styles.muted}>
                  {t("app-detail.note.input-fingerprint")}
                </span>
              </span>
            ),
          ],
          [
            t("app-detail.label.fact-result"),
            row.result === "" ? t("app-detail.label.result-none") : row.result,
          ],
          [
            t("app-detail.label.fact-undo"),
            row.undone
              ? t("app-detail.note.undo-recorded")
              : t("app-detail.label.undo-none"),
          ],
        ]}
      />
    </div>
  );
}

function ActivityList({
  app,
  now,
  open,
  onOpen,
  onRewind,
  onOpenSession,
}: {
  app: string;
  now: () => Date;
  open: string | null;
  onOpen: (id: string | null) => void;
  onRewind: (id: string) => void;
  onOpenSession?: (session: string) => void;
}) {
  // 호출이 시작하고 끝날 때마다 invocation ledger가 내는 app_activity 변경으로 다시 읽는다.
  const read = useActivityView(app);
  return (
    <Loadable
      read={read}
      target={t("app-detail.label.activity-target")}
      now={now}
    >
      {(view) => (
        <ActivityRows
          view={view}
          now={now}
          open={open}
          onOpen={onOpen}
          onRewind={onRewind}
          onOpenSession={onOpenSession}
        />
      )}
    </Loadable>
  );
}

function ActivityRows({
  view,
  now,
  open,
  onOpen,
  onRewind,
  onOpenSession,
}: {
  view: ActivityView;
  now: () => Date;
  open: string | null;
  onOpen: (id: string | null) => void;
  onRewind: (id: string) => void;
  onOpenSession?: (session: string) => void;
}) {
  const rows = view.rows;
  return (
    <>
      <h3 className={styles.sectionHead}>{t("app-detail.label.records")}</h3>
      {view.notices.length === 0 ? (
        <p className={styles.state} data-records-empty="">
          {t("app-detail.note.no-records")}
        </p>
      ) : (
        <div className={styles.table} data-records="">
          {view.notices.map((row) => (
            <div key={row.id} className={styles.tableBlock}>
              <div
                className={styles.record}
                data-unread={row.unread || undefined}
              >
                <span className={styles.strong}>{row.title}</span>
                <span className={styles.muted}>
                  {[
                    row.kind === "app" ? null : t(KIND_LABEL[row.kind]),
                    formatRelativeTime(new Date(row.at), now()),
                    row.body === "" ? null : row.body,
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <h3 className={styles.sectionHead}>{t("app-detail.label.calls")}</h3>
      <div className={styles.filters}>
        <p className={styles.muted}>{t("app-detail.note.activity-scope")}</p>
      </div>
      {rows.length === 0 ? (
        <p className={styles.state} data-activity-empty="">
          {t("app-detail.note.no-activity")}
        </p>
      ) : (
        <div
          className={styles.table}
          role="table"
          aria-label={t("app-detail.label.tab-activity")}
        >
          <div className={styles.tableHead} role="row">
            <span>{t("app-detail.label.col-time")}</span>
            <span>{t("app-detail.label.col-caller")}</span>
            <span>{t("app-detail.label.col-call")}</span>
            <span>{t("app-detail.label.col-effect")}</span>
            <span>{t("app-detail.label.col-result")}</span>
            <span />
          </div>
          {rows.map((row) => (
            <div key={row.id} className={styles.tableBlock}>
              <div
                className={`${styles.tableRow} ${
                  row.earlier ? styles.tableRowOld : ""
                } ${open === row.id ? styles.tableRowOpen : ""}`}
                role="row"
                data-invocation={row.id}
              >
                <span>{callTime(row.at, now())}</span>
                <span className={styles.cell}>
                  <span>{callerText(row.caller)}</span>
                  {row.caller.kind === "agent" ? (
                    <SessionLink
                      caller={row.caller}
                      onOpenSession={onOpenSession}
                    />
                  ) : null}
                </span>
                <span className={styles.cell}>
                  <button
                    type="button"
                    className={styles.linkPlain}
                    aria-expanded={open === row.id}
                    onClick={() => onOpen(open === row.id ? null : row.id)}
                  >
                    <Mono>{callName(row)}</Mono>
                  </button>
                  <span className={styles.muted}>
                    {row.earlier && row.releaseNumber !== null
                      ? t("app-detail.label.from-release", {
                          release: releaseName(row.releaseNumber),
                        })
                      : ""}
                  </span>
                </span>
                <EffectPill effect={row.effect} />
                <StateCell row={row} />
                <span className={styles.cellEnd}>
                  {canRewind(row) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={actionIcons.rewind}
                      data-rewind-start={row.id}
                      onClick={() => onRewind(row.id)}
                    >
                      {t("app-detail.button.rewind-from-here")}
                    </Button>
                  ) : null}
                </span>
              </div>
              {open === row.id ? (
                <Detail row={row} onOpenSession={onOpenSession} />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
