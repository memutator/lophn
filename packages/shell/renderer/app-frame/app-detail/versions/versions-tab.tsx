// Version 탭. activation 진행 상태(적용 중, 적용됨, 적용 실패)와 이전 release로 돌아가기 하나만 있다.
// 사람이 release를 고르거나 쓰기 시작하는 단추는 없다(activation은 검증이 끝나면 저절로 시작한다).
import { useEffect, useState } from "react";
import { Button, StatusMark } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { Loadable } from "../loadable.tsx";
import { dateTime, releaseName, stepText } from "../model.ts";
import { Facts, Mono, Note, PaneToast, Section } from "../parts.tsx";
import type { AppDetailSource, ReleaseCard, VersionView } from "../source.ts";
import { useRead } from "../use-read.ts";
import styles from "../app-detail.module.css";
import { Changes, hasChanges } from "./changes.tsx";

interface VersionsTabProps {
  app: string;
  source: AppDetailSource;
  now: () => Date;
}

const POLL_MS = 2000;

interface ToastState {
  readonly title: string;
  readonly body?: string;
  readonly error?: boolean;
}

export function VersionsTab({ app, source, now }: VersionsTabProps) {
  // 돌아가기를 접수한 release. 활성이 될 때까지 기다린다.
  const [pending, setPending] = useState<ReleaseCard | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [polling, setPolling] = useState(false);
  const read = useRead(() => source.versions(app), [app, source], {
    pollMs: polling ? POLL_MS : undefined,
    now,
  });
  const value = read.loaded.state === "ready" ? read.loaded.value : null;
  const busy = value?.applying != null;

  useEffect(() => {
    setPolling(pending !== null || busy);
  }, [pending, busy]);

  useEffect(() => {
    if (pending === null || value === null) return;
    if (value.active?.id !== pending.id) return;
    setPending(null);
    setToast({
      title: t("app-detail.label.went-back", {
        release: releaseName(pending.number),
      }),
      body: t("app-detail.note.went-back"),
    });
  }, [pending, value]);

  async function goBack(release: ReleaseCard): Promise<void> {
    setToast(null);
    const reply = await source.rollback(release.id);
    if (reply.ok) {
      setPending(release);
      read.reload();
    } else {
      setToast({
        title: t("app-detail.error.go-back-failed", {
          release: releaseName(release.number),
        }),
        error: true,
      });
    }
  }

  return (
    <div className={styles.tab} data-tab-body="version">
      {toast === null ? null : (
        <PaneToast
          title={toast.title}
          body={toast.body}
          error={toast.error}
          onClose={() => setToast(null)}
        />
      )}
      <Loadable
        read={read}
        target={t("app-detail.label.version-target")}
        now={now}
      >
        {(view) => (
          <VersionBody
            view={view}
            source={source}
            now={now}
            pending={pending}
            onGoBack={(release) => void goBack(release)}
          />
        )}
      </Loadable>
    </div>
  );
}

function VersionBody(
  { view, source, now, pending, onGoBack }: {
    view: VersionView;
    source: AppDetailSource;
    now: () => Date;
    pending: ReleaseCard | null;
    onGoBack: (release: ReleaseCard) => void;
  },
) {
  const { active, applying, failed, earlier } = view;
  const target = applying ?? failed ?? active;
  return (
    <>
      {applying === null
        ? null
        : (
          <Section title={t("app-detail.heading.being-applied")}>
            <div className={styles.card} data-applying="">
              <div className={styles.row}>
                <span className={styles.rowTitle}>
                  {releaseName(applying.number)}
                </span>
                <StatusMark
                  tone="warning"
                  label={t("app-detail.label.status-applying")}
                />
              </div>
              <p className={styles.text}>
                {active === null
                  ? t("app-detail.note.applying-first")
                  : t("app-detail.note.applying-keeps", {
                    previous: releaseName(active.number),
                    next: releaseName(applying.number),
                  })}
              </p>
              {applying.phase === "waiting_approval"
                ? (
                  <p
                    className={styles.muted}
                    data-applying-phase={applying.phase}
                  >
                    {t("app-detail.note.applying-waiting-approval")}
                  </p>
                )
                : null}
              <ol className={styles.steps}>
                {applying.steps.map((step) => (
                  <li
                    key={step.key}
                    className={`${styles.step} ${
                      step.state === "done"
                        ? styles.stepDone
                        : step.state === "wait"
                        ? styles.stepWait
                        : ""
                    }`}
                    data-step={step.key}
                    data-step-state={step.state}
                  >
                    <span aria-hidden="true">
                      {step.state === "done"
                        ? "✓"
                        : step.state === "now"
                        ? "…"
                        : "·"}
                    </span>
                    <span>{stepText(step, applying.number)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Section>
        )}
      {failed === null
        ? null
        : (
          <Section title={t("app-detail.heading.last-activation")}>
            <div className={styles.card} data-failed="">
              <div className={styles.row}>
                <span className={styles.rowTitle}>
                  {releaseName(failed.number)}
                </span>
                <StatusMark
                  tone="critical"
                  label={t("app-detail.label.status-failed")}
                />
              </div>
              <Facts
                rows={[
                  ...(failed.triedAt === null ? [] : [
                    [
                      t("app-detail.label.fact-tried"),
                      dateTime(failed.triedAt),
                    ],
                  ] as [string, string][]),
                  [t("app-detail.label.fact-reason"), failed.reason],
                ]}
              />
              {active === null
                ? <Note>{t("app-detail.note.failed-called")}</Note>
                : (
                  <Note
                    title={t("app-detail.label.failed-still-active", {
                      release: releaseName(active.number),
                    })}
                  >
                    {t("app-detail.note.failed-unchanged")}
                  </Note>
                )}
            </div>
          </Section>
        )}
      {active === null ? null : (
        <Section
          title={applying === null && failed === null
            ? t("app-detail.heading.active-release")
            : t("app-detail.heading.active-release-named", {
              release: releaseName(active.number),
            })}
        >
          <div className={styles.card} data-active-release="">
            <div className={styles.row}>
              <span className={styles.rowTitle}>
                {releaseName(active.number)}
              </span>
              <StatusMark
                tone="good"
                label={t("app-detail.label.status-applied")}
              />
            </div>
            <Facts
              rows={[
                [
                  t("app-detail.label.fact-applied"),
                  dateTime(active.appliedAt),
                ],
                [
                  t("app-detail.label.fact-commit"),
                  <Mono key="commit">{active.commit}</Mono>,
                ],
                [
                  t("app-detail.label.fact-schema"),
                  schemaName(active.dataSchema),
                ],
              ]}
            />
          </div>
        </Section>
      )}
      {target === null ? null : (
        <ChangesSection
          key={target.id}
          source={source}
          release={target.id}
          always={target !== active}
          now={now}
        />
      )}
      <Earlier
        earlier={earlier}
        current={active}
        busy={applying !== null || pending !== null}
        onGoBack={onGoBack}
      />
    </>
  );
}

/** 늘어난 선언과 손실 단계. 지금 활성 release면 보일 것이 있을 때만 둔다. */
function ChangesSection(
  { source, release, always, now }: {
    source: AppDetailSource;
    release: string;
    always: boolean;
    now: () => Date;
  },
) {
  const read = useRead(() => source.changes(release), [source, release], {
    now,
  });
  if (read.loaded.state !== "ready") return null;
  const changes = read.loaded.value;
  if (!always && !hasChanges(changes)) return null;
  return <Changes changes={changes} />;
}

const schemaName = (schema: number) => `v${schema}`;

function Earlier(
  { earlier, current, busy, onGoBack }: {
    earlier: readonly ReleaseCard[];
    current: ReleaseCard | null;
    busy: boolean;
    onGoBack: (release: ReleaseCard) => void;
  },
) {
  if (earlier.length === 0) return null;
  return (
    <Section title={t("app-detail.heading.earlier-releases")}>
      <ul className={styles.list}>
        {earlier.map((release) => {
          const same = current !== null &&
            release.dataSchema === current.dataSchema;
          const reason = busy
            ? t("app-detail.note.go-back-busy")
            : same
            ? null
            : t("app-detail.note.go-back-schema", {
              schema: schemaName(release.dataSchema),
              current: current === null ? "" : schemaName(current.dataSchema),
            });
          return (
            <li
              key={release.id}
              className={styles.item}
              data-earlier-release={release.number}
            >
              <div className={styles.rowText}>
                <span className={styles.rowTitle}>
                  {releaseName(release.number)}{" "}
                  <span className={styles.muted}>
                    · {t("app-detail.label.data-schema", {
                      schema: schemaName(release.dataSchema),
                    })}
                  </span>
                </span>
                {release.replacedAt === null
                  ? null
                  : (
                    <span className={styles.muted}>
                      {t("app-detail.label.replaced", {
                        when: dateTime(release.replacedAt),
                      })}
                    </span>
                  )}
                {reason === null
                  ? null
                  : <span className={styles.muted}>{reason}</span>}
              </div>
              <Button
                size="sm"
                disabled={reason !== null}
                data-go-back={release.number}
                onClick={() => onGoBack(release)}
              >
                {t("app-detail.button.go-back", {
                  release: releaseName(release.number),
                })}
              </Button>
            </li>
          );
        })}
      </ul>
      <p className={styles.muted}>{t("app-detail.note.go-back-scope")}</p>
    </Section>
  );
}
