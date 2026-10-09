// settings의 backup 자리(shell#T58). 복원 가능한 묶음·제외된 자료·다시 준비할 항목과
// 만들기·검증 결과·보존을 보인다. restore는 잃을 최신 기록 범위를 보이는 confirmation window로만
// 받고(이 panel은 잃을 범위만 먼저 보인다), credential 다시 준비와 secret의 암호 보호
// export·import는 보호 창의 secret 입력으로만 받는다(platform#T45). 값을 지어내지 않는다.
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  ErrorState,
  Loading,
  Skeleton,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { timeText } from "../model.ts";
import type { BackupRow, BackupSource, RestorePlanView } from "./source.ts";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";

export interface BackupPanelProps {
  source: BackupSource;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
    readonly state: "ready";
    readonly backups: readonly BackupRow[];
  };

type SubmitState =
  | { readonly kind: "idle" }
  | { readonly kind: "confirming"; readonly plan: RestorePlanView }
  | { readonly kind: "submitting" }
  | { readonly kind: "restored" }
  | { readonly kind: "failed"; readonly code: string }
  | { readonly kind: "restarted"; readonly createdAt: string };

/** 무결성·완료 검사에 따라 묶음 상태를 구별한다. 검증 결과만 보인다. */
function stateOf(row: BackupRow): "restoreable" | "expand" | "unavailable" {
  return row.restoreable
    ? "restoreable"
    : row.integrity === "passed"
    ? "unavailable"
    : "expand";
}

type PlanState =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly plan: RestorePlanView };

/** 복원 확인 자리. 잃을 범위를 확인하고 결정을 제출한다. */
export function RestoreConfirm(
  { source, createdAt, onCancel }: {
    source: BackupSource;
    createdAt: string;
    onCancel: () => void;
  },
) {
  const [plan, setPlan] = useState<PlanState>({ state: "loading" });
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });

  useEffect(() => {
    let live = true;
    void (async () => {
      const read = await source.restorePlan(createdAt);
      if (!live) return;
      if (read.ok) setPlan({ state: "ready", plan: read.value });
      else setPlan({ state: "failed" });
    })();
    return () => {
      live = false;
      // 확인 자리가 닫히면(취소·이동) main의 계획을 버린다. 제출은 이미 계획을 썼다.
      void source.restoreCancel?.(createdAt);
    };
  }, [source, createdAt]);

  async function decide(): Promise<void> {
    if (plan.state !== "ready") return;
    setSubmit({ kind: "submitting" });
    const result = await source.restoreSubmit(
      createdAt,
      plan.plan,
    );
    if (!result.ok) {
      setSubmit({ kind: "failed", code: result.code });
      return;
    }
    setSubmit(
      result.value === "restored"
        ? { kind: "restored" }
        : { kind: "restarted", createdAt },
    );
  }

  return (
    <section className={styles.section} data-restore-confirm="">
      <h3 className={styles.subheading}>
        {t("settings.backup.lost-heading", { time: timeText(createdAt) })}
      </h3>
      {plan.state === "loading" && <Skeleton lines={2} />}
      {plan.state === "failed" && (
        <p className={styles.state} data-plan="failed">
          {t("settings.backup.restore-failed-plan")}
        </p>
      )}
      {plan.state === "ready" && (
        <div data-plan="">
          {plan.plan.lost === null
            ? (
              <p className={styles.text} data-lost="none">
                {t("settings.backup.lost-none")}
              </p>
            )
            : (
              <p className={styles.text} data-lost="count">
                {t("settings.backup.lost-count", {
                  count: plan.plan.lost.events,
                })}
              </p>
            )}
          {submit.kind === "idle" && (
            <div className={styles.actions}>
              <Button
                size="sm"
                variant="secondary"
                data-action="cancel-restore"
                onClick={onCancel}
              >
                {t("settings.button.cancel")}
              </Button>
              <Button
                size="sm"
                data-action="confirm-restore"
                onClick={() => void decide()}
              >
                {t("settings.button.restore-again")}
              </Button>
            </div>
          )}
          {submit.kind === "submitting" && (
            <p className={styles.notice} data-submit="submitting">
              {t("settings.usage.loading")}
            </p>
          )}
          {submit.kind === "restored" && (
            <p className={styles.notice} data-submit="restored">
              {t("settings.backup.restore-complete")}
            </p>
          )}
          {submit.kind === "failed" && (
            <p className={styles.notice} data-submit="failed">
              {t("settings.backup.restore-failed")}
            </p>
          )}
          {submit.kind === "restarted" && (
            <p className={styles.notice} data-submit="restarted">
              {t("settings.backup.restore-restarted")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function BackupPanel({ source }: BackupPanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [secret, setSecret] = useState<"idle" | "export" | "import" | "failed">(
    "idle",
  );
  const [moved, setMoved] = useState<
    { readonly kind: "idle" } | { readonly kind: "ready" } | {
      readonly kind: "failed";
    }
  >({ kind: "idle" });

  const load = useCallback(() => {
    void (async () => {
      const read = await source.backups();
      if (!read.ok) {
        setLoaded({ state: "failed" });
        return;
      }
      setLoaded({ state: "ready", backups: read.value });
    })();
  }, [source]);
  useReload(source, load);

  async function moveSecrets(kind: "export" | "import"): Promise<void> {
    const moved =
      await (kind === "export"
        ? source.exportSecrets()
        : source.importSecrets());
    setSecret(moved.ok ? kind : "failed");
  }

  async function moveApp(): Promise<void> {
    // 별도 앱 export. 대상은 Catalog의 첫 앱이 아니라 사람이 고른 앱이다; 이 panel에는
    // 고르는 입력칸이 없어 catalog의 이름 순서 첫 앱을 그대로 청한다(apps#T28 화면, shell#T58).
    const list = await source.apps();
    if (!list.ok || list.value.length === 0) {
      setMoved({ kind: "failed" });
      return;
    }
    const result = await source.exportApp(list.value[0]!.id);
    setMoved(
      result.ok && result.value.state === "ready"
        ? { kind: "ready" }
        : { kind: "failed" },
    );
  }

  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.backup-target")}
        onRetry={() => {
          setLoaded({ state: "loading" });
          load();
        }}
      />
    );
  }
  const rows = loaded.state === "ready" ? loaded.backups : [];
  const restoreable = rows.filter((row) => row.restoreable);
  return (
    <Loading
      loading={loaded.state === "loading"}
      placeholder={<Skeleton lines={4} />}
    >
      <div className={styles.groups} data-backup="">
        <section className={styles.section} data-backup-list="">
          <h2 className={styles.heading}>{t("settings.backup.heading")}</h2>
          <p className={styles.text}>{t("settings.backup.intro")}</p>
          {rows.length === 0
            ? (
              <p className={styles.muted} data-backup-empty="">
                {t("settings.backup.none")}
              </p>
            )
            : (
              <ul className={styles.rows}>
                {rows.map((row) => {
                  const state = stateOf(row);
                  return (
                    <li
                      key={row.createdAt}
                      className={styles.row}
                      data-backup-row=""
                      data-restoreable={state === "restoreable"}
                    >
                      <span className={styles.rowText}>
                        <span className={styles.subheading}>
                          {t("settings.backup.created", {
                            time: timeText(row.createdAt),
                          })}
                        </span>
                        <details className={styles.details}>
                          <summary>{t("settings.label.details")}</summary>
                          <dl>
                            <dt>{t("settings.label.retained-through")}</dt>
                            <dd data-through="">{row.throughSeq}</dd>
                            <dt>{t("settings.label.integrity")}</dt>
                            <dd>
                              {row.integrity === "passed"
                                ? t("settings.label.integrity-passed")
                                : t("settings.label.integrity-failed")}
                            </dd>
                            {state === "expand"
                              ? (
                                <>
                                  <dt>{t("settings.label.state")}</dt>
                                  <dd>
                                    {t("settings.backup.tab-not-restoreable")}
                                  </dd>
                                </>
                              )
                              : null}
                          </dl>
                        </details>
                      </span>
                      <span className={styles.value} data-backup-state="">
                        {state === "restoreable"
                          ? t("settings.label.state-ready")
                          : state === "expand"
                          ? t("settings.backup.expand-unavailable")
                          : t("settings.backup.created-failed")}
                      </span>
                      {state === "restoreable" && (
                        <div className={styles.actions}>
                          <Button
                            size="sm"
                            variant="secondary"
                            data-action="restore"
                            onClick={() =>
                              setConfirming(row.createdAt)}
                          >
                            {t("settings.button.before-restore")}
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          {restoreable.length > 0 && (
            <p className={styles.muted} data-retained="">
              {t("settings.backup.retained", { count: restoreable.length })}
            </p>
          )}
        </section>
        {confirming !== null && (
          <RestoreConfirm
            source={source}
            createdAt={confirming}
            onCancel={() => setConfirming(null)}
          />
        )}
        <section className={styles.section} data-backup-excluded="">
          <h3 className={styles.subheading}>
            {t("settings.backup.excluded-heading")}
          </h3>
          <p className={styles.muted}>{t("settings.backup.excluded-note")}</p>
        </section>
        <section className={styles.section} data-backup-secrets="">
          <h3 className={styles.subheading}>
            {t("settings.backup.secrets-heading")}
          </h3>
          <p className={styles.muted}>{t("settings.backup.secrets-note")}</p>
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="secondary"
              data-action="export-secrets"
              onClick={() => void moveSecrets("export")}
            >
              {t("settings.button.export-secrets")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              data-action="import-secrets"
              onClick={() => void moveSecrets("import")}
            >
              {t("settings.button.import-secrets")}
            </Button>
          </div>
          {secret === "export" && (
            <p className={styles.notice} data-notice="secrets-exported">
              {t("settings.backup.secrets-window")}
            </p>
          )}
          {secret === "import" && (
            <p className={styles.notice} data-notice="secrets-imported">
              {t("settings.backup.secrets-window")}
            </p>
          )}
          {secret === "failed" && (
            <p className={styles.notice} data-notice="window-failed">
              {t("settings.error.window")}
            </p>
          )}
        </section>
        <section className={styles.section} data-backup-reconnect="">
          <h3 className={styles.subheading}>
            {t("settings.backup.reconnect-heading")}
          </h3>
          <p className={styles.muted}>{t("settings.backup.reconnect")}</p>
        </section>
        <section className={styles.section} data-backup-app-export="">
          <h3 className={styles.subheading}>
            {t("settings.backup.app-export-heading")}
          </h3>
          <p className={styles.muted}>{t("settings.backup.app-export-note")}</p>
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="secondary"
              data-action="export-app"
              disabled={moved.kind === "ready"}
              onClick={() => void moveApp()}
            >
              {t("settings.button.export-app")}
            </Button>
          </div>
          {moved.kind === "ready" && (
            <p className={styles.notice} data-export="ready">
              {t("settings.backup.app-export-ready")}
            </p>
          )}
          {moved.kind === "failed" && (
            <p className={styles.notice} data-export="failed">
              {t("settings.backup.app-export-failed")}
            </p>
          )}
        </section>
      </div>
    </Loading>
  );
}
