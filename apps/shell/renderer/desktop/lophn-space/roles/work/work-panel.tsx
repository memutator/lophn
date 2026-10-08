import { useCallback, useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  ErrorState,
  StatusMark,
} from "@lophn/design/components";
import { lophnSpaceIcons } from "@lophn/design/components";
import { formatRelativeTime, t } from "@lophn/wording";

import { newId } from "../../model.ts";
import { STATUS_LABEL, STATUS_TONE } from "../labels.ts";
import {
  canAskAgain,
  canRestart,
  canStop,
  groupWorks,
  type WorkGroup,
} from "../model.ts";
import { ReviewPanel } from "../review/review-panel.tsx";
import type { RoleRow, RolesSource, WorkRow } from "../source.ts";
import styles from "../roles.module.css";

export interface WorkPanelProps {
  source: RolesSource;
  role: RoleRow;
  connected: number;
  names: Readonly<Record<string, string>>;
  onRead: (document: string, version: string | null) => void;
  onConfirm?: () => void;
  onApp?: (app: string) => void;
  /** 다시 시키기. 처음 요청의 글을 대화 입력칸에 채운다. 대화 통로가 없으면 단추를 두지 않는다. */
  onAskAgain?: (work: WorkRow) => void;
  /** 대화 탭으로 간다. 하는 일이 비면 첫 요청을 보낼 자리를 가리킨다. */
  onOpenConversation: () => void;
  now?: () => number;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly groups: readonly WorkGroup[] };

const ORIGIN_LABEL = {
  message: "roles.label.origin-message",
  schedule: "roles.label.origin-schedule",
  handoff: "roles.label.origin-handoff",
} as const;

// 하는 일. 지금·기다림·멈춤·끝남 순으로 묶고 다시 시작과 다시 시키기를 다른 단추로 둔다(shell/desktop#R5).
export function WorkPanel(
  {
    source,
    role,
    connected,
    names,
    onRead,
    onConfirm,
    onApp,
    onAskAgain,
    onOpenConversation,
    now = Date.now,
  }: WorkPanelProps,
) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [problem, setProblem] = useState<"stop" | "restart" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let live = true;
    void source.works(role).then((result) => {
      if (!live) return;
      setLoaded((previous) =>
        result.ok
          ? { kind: "ready", groups: groupWorks(result.value) }
          : previous.kind === "ready"
          ? previous
          : { kind: "failed" }
      );
    });
    return () => {
      live = false;
    };
  }, [source, role, connected, attempt]);

  useEffect(() => {
    globalThis.addEventListener?.("focus", reload);
    return () => globalThis.removeEventListener?.("focus", reload);
  }, [reload]);

  const stop = async (work: WorkRow) => {
    const stopped = await source.stop(work, newId("stop", now()));
    setProblem(stopped.ok ? null : "stop");
    reload();
  };
  const restart = async (work: WorkRow) => {
    const restarted = await source.restart(work);
    setProblem(restarted.ok ? null : "restart");
    reload();
  };

  if (reviewing !== null && loaded.kind === "ready") {
    const work = loaded.groups.flatMap((group) => group.items).find((item) =>
      item.id === reviewing
    );
    if (work !== undefined) {
      return (
        <ReviewPanel
          source={source}
          role={role}
          work={work}
          names={names}
          onBack={() => setReviewing(null)}
          onRead={onRead}
          onApp={onApp}
          onConfirm={onConfirm}
          onAskAgain={onAskAgain}
          onRestart={() => void restart(work)}
        />
      );
    }
  }

  return (
    <div className={styles.panel} data-work-panel="">
      {loaded.kind === "failed"
        ? (
          <ErrorState
            target={t("roles.label.target-work")}
            onRetry={reload}
          />
        )
        : null}
      {loaded.kind === "ready" && loaded.groups.length === 0
        ? (
          <EmptyState
            icon={lophnSpaceIcons.roles}
            message={t("roles.empty.no-work")}
            action={{
              label: t("roles.button.open-conversation"),
              onSelect: onOpenConversation,
            }}
          />
        )
        : null}
      {problem === null
        ? null
        : (
          <p className={styles.problem} data-problem={problem}>
            {problem === "stop"
              ? t("roles.error.stop")
              : t("roles.error.restart")}
          </p>
        )}
      {loaded.kind === "ready"
        ? loaded.groups.map((group) => (
          <section
            key={group.status}
            className={styles.group}
            data-work-group={group.status}
          >
            <h3 className={styles.groupHead}>
              {t(STATUS_LABEL[group.status])}
              <span className={styles.count}>{group.items.length}</span>
            </h3>
            <ul className={styles.items}>
              {group.items.map((work) => {
                const at = work.finishedAt ?? work.startedAt;
                return (
                  <li
                    key={work.id}
                    className={styles.item}
                    data-work={work.id}
                  >
                    <div className={styles.itemMain}>
                      <StatusMark
                        tone={STATUS_TONE[group.status]}
                        label={t(STATUS_LABEL[group.status])}
                      />
                      <span className={styles.itemText}>
                        {t(ORIGIN_LABEL[work.origin])}
                      </span>
                      <span className={styles.muted}>
                        {at === null
                          ? t("roles.label.not-started")
                          : formatRelativeTime(new Date(at), new Date(now()))}
                      </span>
                    </div>
                    <div className={styles.actions}>
                      <Button
                        size="sm"
                        variant="ghost"
                        data-action="review"
                        onClick={() => setReviewing(work.id)}
                      >
                        {t("roles.button.review")}
                      </Button>
                      {work.state === "waiting_user" && onConfirm !== undefined
                        ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            data-action="answer"
                            onClick={onConfirm}
                          >
                            {t("roles.button.answer")}
                          </Button>
                        )
                        : null}
                      {canStop(work)
                        ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            data-action="stop"
                            onClick={() => void stop(work)}
                          >
                            {t("roles.button.stop")}
                          </Button>
                        )
                        : null}
                      {canRestart(role, work)
                        ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            data-action="restart"
                            onClick={() => void restart(work)}
                          >
                            {t("roles.button.restart")}
                          </Button>
                        )
                        : null}
                      {onAskAgain !== undefined && canAskAgain(role, work)
                        ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            data-action="ask-again"
                            onClick={() => onAskAgain(work)}
                          >
                            {t("roles.button.ask-again")}
                          </Button>
                        )
                        : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
        : null}
    </div>
  );
}
