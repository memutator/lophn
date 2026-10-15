// Access 탭. 앱이 activation 때 받은 바깥 자원과 다른 앱 app-api를 보이고 거둔다. 만들지는 않는다.
// [Revoke]는 확인 창 없이 바로 요청을 접수한다. 거두기는 요청 접수(새 호출 즉시 막힘)와 실제 정리
// (이전 process 종료 확인 뒤 새 범위로 다시 시작)를 나눠 보인다.
import { useEffect, useState } from "react";
import { Button, StatusMark } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { Loadable } from "../loadable.tsx";
import { resourceDetail, resourceKindText } from "../model.ts";
import { EffectPill, Mono, Note, PaneToast, Pill, Section } from "../parts.tsx";
import type { AccessView, AppDetailSource } from "../source.ts";
import { useRead } from "../use-read.ts";
import styles from "../app-detail.module.css";

export interface AccessTabProps {
  app: string;
  source: AppDetailSource;
  now: () => Date;
}

const POLL_MS = 3000;

export function AccessTab({ app, source, now }: AccessTabProps) {
  // 이 화면에서 거두기를 접수한 grant.
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [polling, setPolling] = useState(false);
  const read = useRead(() => source.access(app), [app, source], {
    // 정리가 끝났는지(grant가 revoked가 됐는지) 보려는 동안만 다시 읽는다.
    pollMs: polling ? POLL_MS : undefined,
    now,
  });
  const value = read.loaded.state === "ready" ? read.loaded.value : null;
  const cleaning = value !== null && stillCleaning(value, requested);
  useEffect(() => setPolling(cleaning), [cleaning]);

  async function revoke(grant: string): Promise<void> {
    setFailed(false);
    const reply = await source.revoke(grant);
    if (reply.ok) {
      setRequested((now) => new Set(now).add(grant));
      read.reload();
    } else {
      setFailed(true);
    }
  }

  return (
    <div className={styles.tab} data-tab-body="access">
      {failed
        ? (
          <PaneToast
            title={t("app-detail.error.revoke-failed")}
            error
            onClose={() => setFailed(false)}
          />
        )
        : null}
      <Note>{t("app-detail.note.access-intro")}</Note>
      <Loadable
        read={read}
        target={t("app-detail.label.access-target")}
        now={now}
      >
        {(view) => (
          <AccessBody
            view={view}
            requested={requested}
            onRevoke={(grant) => void revoke(grant)}
          />
        )}
      </Loadable>
    </div>
  );
}

type Row = AccessView["resources"][number] | AccessView["appApis"][number];

/** 이 화면이 접수했거나 core가 정리 중이라고 한 grant. */
const asked = (row: Row, requested: ReadonlySet<string>) =>
  requested.has(row.grant) || row.revoking;

function stillCleaning(view: AccessView, requested: ReadonlySet<string>) {
  return [...view.resources, ...view.appApis].some((row) =>
    asked(row, requested) && !row.revoked
  );
}

type RevokeStage = "requested" | "cleaned";

function RevokeSteps({ stage }: { stage: RevokeStage }) {
  return (
    <ol className={styles.steps} data-revoke={stage}>
      <li className={`${styles.step} ${styles.stepDone}`}>
        <span aria-hidden="true">✓</span>
        <span>{t("app-detail.note.revoke-requested")}</span>
      </li>
      <li
        className={`${styles.step} ${
          stage === "cleaned" ? styles.stepDone : styles.stepWait
        }`}
      >
        <span aria-hidden="true">{stage === "cleaned" ? "✓" : "…"}</span>
        <span>
          {stage === "cleaned"
            ? t("app-detail.note.revoke-cleaned")
            : t("app-detail.note.revoke-waiting")}
        </span>
      </li>
    </ol>
  );
}

function RevokeEnd(
  { stage, onRevoke }: { stage: RevokeStage | null; onRevoke: () => void },
) {
  if (stage === null) {
    return (
      <Button size="sm" data-revoke-button="" onClick={onRevoke}>
        {t("app-detail.button.revoke")}
      </Button>
    );
  }
  return stage === "cleaned"
    ? <StatusMark tone="good" label={t("app-detail.label.revoked")} />
    : <StatusMark tone="warning" label={t("app-detail.label.cleaning-up")} />;
}

function stageOf(
  row: Row,
  requested: ReadonlySet<string>,
): RevokeStage | null {
  if (!asked(row, requested)) return null;
  return row.revoked ? "cleaned" : "requested";
}

function AccessBody(
  { view, requested, onRevoke }: {
    view: AccessView;
    requested: ReadonlySet<string>;
    onRevoke: (grant: string) => void;
  },
) {
  // 다른 때에 거둔 grant는 더 이 앱의 접근이 아니므로 보이지 않는다.
  const resources = view.resources.filter((row) =>
    !row.revoked || asked(row, requested)
  );
  const appApis = view.appApis.filter((row) =>
    !row.revoked || asked(row, requested)
  );
  return (
    <>
      <Section title={t("app-detail.heading.outside-resources")}>
        {resources.length === 0
          ? <p className={styles.muted}>{t("app-detail.note.no-resources")}</p>
          : (
            <ul className={styles.list} data-resources="">
              {resources.map((row) => {
                const stage = stageOf(row, requested);
                return (
                  <li
                    key={row.grant}
                    className={styles.item}
                    data-resource={row.kind}
                  >
                    <div className={styles.rowText}>
                      <span className={styles.rowTitle}>
                        <Pill>{resourceKindText(row.kind)}</Pill>{" "}
                        <Mono>{row.name}</Mono>
                      </span>
                      <span className={styles.muted}>
                        {resourceDetail(row.kind, row.grantedAt)}
                      </span>
                      {stage === null ? null : <RevokeSteps stage={stage} />}
                    </div>
                    <RevokeEnd
                      stage={stage}
                      onRevoke={() => onRevoke(row.grant)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
      </Section>
      <Section title={t("app-detail.heading.other-apps")}>
        {appApis.length === 0
          ? <p className={styles.muted}>{t("app-detail.note.no-other-apps")}</p>
          : (
            <ul className={styles.list} data-app-apis="">
              {appApis.map((row) => {
                const stage = stageOf(row, requested);
                return (
                  <li
                    key={row.grant}
                    className={styles.item}
                    data-app-api-grant={row.app}
                  >
                    <div className={styles.rowText}>
                      <span className={styles.rowTitle}>
                        {row.appName ??
                          t("app-detail.label.caller-app-unnamed")}
                        {" › "}
                        {row.apis.map((item, index) => (
                          <span key={item.api}>
                            {index === 0 ? "" : ", "}
                            <Mono>{item.api}</Mono>
                          </span>
                        ))}
                      </span>
                      <span className={styles.muted}>
                        {t("app-detail.note.may-call")}
                        {row.apis.map((item) =>
                          item.effect === null ? null : (
                            <span key={item.api}>
                              {" "}
                              <EffectPill effect={item.effect} />
                            </span>
                          )
                        )}
                      </span>
                      {stage === null ? null : <RevokeSteps stage={stage} />}
                    </div>
                    <RevokeEnd
                      stage={stage}
                      onRevoke={() => onRevoke(row.grant)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
      </Section>
    </>
  );
}
