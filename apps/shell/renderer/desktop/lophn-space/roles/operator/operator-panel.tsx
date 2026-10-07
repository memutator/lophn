import { useEffect, useState } from "react";
import { Button } from "@lophn/design/components";
import { type MessageKey, t } from "@lophn/wording";

import type { PauseFacts, RoleRow, RolesSource } from "../source.ts";
import { everyLabel, when } from "./period.ts";
import type { SkippedPeriod } from "./source.ts";
import styles from "../roles.module.css";

export interface OperatorPanelProps {
  source: RolesSource;
  role: RoleRow;
  connected: number;
  /** 답을 기다리는 질문은 확인할 것으로 간다. */
  onConfirm?: () => void;
  /** 멈춤·회수 뒤 목록을 다시 읽는다. */
  onChanged: () => void;
}

const PAUSED: Record<PauseFacts["kind"], MessageKey> = {
  user: "roles.notice.operator-paused-user",
  consecutive_failures: "roles.notice.operator-paused-failures",
  scope_archived: "roles.notice.operator-paused-scope",
  output_archived: "roles.notice.operator-paused-output",
};

function DocumentName(
  { source, document }: { source: RolesSource; document: string },
) {
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void source.documentTitle(document).then((result) => {
      if (live) setTitle(result.ok ? result.value : null);
    });
    return () => {
      live = false;
    };
  }, [source, document]);
  return <span>{title ?? t("roles.label.target-document")}</span>;
}

// Operator에만 있는 상세. 맡은 반복(주기·보고할 문서·읽는 앱)과 멈춘 이유, 답을 기다리느라 건너뛴
// 회차, 멈춤과 회수를 한 자리에 둔다(flow manage-operator, receive-operator-report).
// 회수한 Operator는 지난 대화와 만든 것만 남아 이 자리의 행동이 없다.
export function OperatorPanel(
  { source, role, connected, onConfirm, onChanged }: OperatorPanelProps,
) {
  const facts = role.operator ?? null;
  const [skipped, setSkipped] = useState<readonly SkippedPeriod[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<"pause" | "withdraw" | null>(null);

  useEffect(() => {
    if (role.state === "withdrawn") return;
    let live = true;
    void source.operator.skipped(role).then((result) => {
      if (live) setSkipped(result.ok ? result.value : []);
    });
    return () => {
      live = false;
    };
  }, [source, role.id, role.state, role.revision, connected]);

  const act = async (kind: "pause" | "withdraw") => {
    const sent = kind === "pause"
      ? await source.operator.pause(role)
      : await source.operator.withdraw(role);
    setConfirming(false);
    setProblem(sent.ok ? null : kind);
    if (sent.ok) onChanged();
  };

  const every = facts?.schedule == null
    ? null
    : everyLabel(facts.schedule.everyMs);
  const hours = facts?.schedule == null
    ? 0
    : Math.round(facts.schedule.everyMs / 3_600_000);

  return (
    <div className={styles.panel} data-operator-panel={role.id}>
      {role.state === "paused" && facts?.pause != null
        ? (
          <p className={styles.text} data-operator-pause={facts.pause.kind}>
            {t(PAUSED[facts.pause.kind])}
          </p>
        )
        : null}
      {facts === null ? null : (
        <dl className={styles.facts} data-operator-facts="">
          {facts.schedule === null ? null : (
            <>
              <dt>{t("roles.label.attach-period")}</dt>
              <dd data-operator-every="">
                {every === null
                  ? t("roles.label.operator-every-custom", { hours })
                  : t(every)}
                {" · "}
                {t("roles.label.operator-first", {
                  when: when(facts.schedule.firstAt),
                })}
              </dd>
            </>
          )}
          <dt>{t("roles.label.operator-reports")}</dt>
          <dd data-operator-outputs="">
            {role.outputs.map((document, index) => (
              <span key={document}>
                {index === 0 ? null : ", "}
                <DocumentName source={source} document={document} />
              </span>
            ))}
          </dd>
        </dl>
      )}
      {facts?.lastDueAt == null ? null : (
        <p className={styles.muted} data-operator-last="">
          {t("roles.label.operator-last-due", { when: when(facts.lastDueAt) })}
        </p>
      )}
      {facts === null || facts.readApps.length === 0 ? null : (
        <p className={styles.muted} data-operator-reads="">
          {t("roles.label.operator-reads", { count: facts.readApps.length })}
        </p>
      )}
      {skipped.length === 0 ? null : (
        <section className={styles.group} data-operator-skipped="">
          <h3 className={styles.groupHead}>
            {t("roles.label.operator-skipped")}
          </h3>
          <ul className={styles.items}>
            {skipped.map((item) => (
              <li
                key={item.dueAt}
                className={styles.itemMain}
                data-skipped={item.waitingForAnswer ? "waiting" : "busy"}
              >
                <span className={styles.itemText}>
                  {t(
                    item.waitingForAnswer
                      ? "roles.label.operator-skipped-waiting"
                      : "roles.label.operator-skipped-busy",
                    { when: when(item.dueAt) },
                  )}
                </span>
                {item.waitingForAnswer && onConfirm !== undefined
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
              </li>
            ))}
          </ul>
        </section>
      )}
      {problem === null ? null : (
        <p className={styles.problem} data-problem={problem}>
          {t(
            problem === "pause"
              ? "roles.error.pause"
              : "roles.error.withdraw",
          )}
        </p>
      )}
      {role.state === "withdrawn" ? null : confirming
        ? (
          <div className={styles.panel} data-withdraw-ask="">
            <p className={styles.notice}>{t("roles.notice.withdraw-ask")}</p>
            <div className={styles.actions}>
              <Button
                size="sm"
                variant="danger"
                data-action="withdraw-confirm"
                onClick={() => void act("withdraw")}
              >
                {t("roles.button.withdraw-confirm")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-action="withdraw-keep"
                onClick={() => setConfirming(false)}
              >
                {t("roles.button.withdraw-keep")}
              </Button>
            </div>
          </div>
        )
        : (
          <div className={styles.actions}>
            {role.state === "enabled"
              ? (
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="pause"
                  onClick={() => void act("pause")}
                >
                  {t("roles.button.pause")}
                </Button>
              )
              : null}
            <Button
              size="sm"
              variant="ghost"
              data-action="withdraw"
              onClick={() => setConfirming(true)}
            >
              {t("roles.button.withdraw")}
            </Button>
          </div>
        )}
    </div>
  );
}
