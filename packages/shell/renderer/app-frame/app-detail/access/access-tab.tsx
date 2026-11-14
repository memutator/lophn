// Access 탭. 앱이 activation 때 받은 바깥 자원과 다른 앱 tool을 보이고 거둔다. 만들지는 않는다.
// [Revoke]는 확인 창 없이 바로 요청을 접수한다. 거두기는 요청 접수(새 호출 즉시 막힘)와 실제 정리
// (이전 process 종료 확인 뒤 새 범위로 다시 시작)를 나눠 보인다. secret 줄은 값 넣기와 OAuth sign-in도
// 여기서 한다(값은 보호된 입력 창이 받고 화면은 보지 않는다).
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/i18n";

import { Loadable } from "../loadable.tsx";
import { resourceDetail, resourceKindText } from "../model.ts";
import { EffectPill, Mono, Note, PaneToast, Pill, Section } from "../parts.tsx";
import { useAccessView } from "../reads.ts";
import type { AccessView, AppDetailSource, SourceResult } from "../source.ts";
import { type SecretActions, SecretRow } from "./secret-row.tsx";
import styles from "../app-detail.module.css";
import { actionIcons } from "../../../icons/mod.ts";

interface AccessTabProps {
  app: string;
  source: AppDetailSource;
  now: () => Date;
}

type Problem = "revoke" | "secret" | "remove" | "sign-in";

const problemTitle = (problem: Problem) =>
  problem === "revoke"
    ? t("app-detail.error.revoke-failed")
    : problem === "secret"
      ? t("app-detail.error.secret-failed")
      : problem === "remove"
        ? t("app-detail.error.remove-failed")
        : t("app-detail.error.sign-in-failed");

export function AccessTab({ app, source, now }: AccessTabProps) {
  // 이 화면에서 거두기를 접수한 grant.
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<Problem | null>(null);
  // grant 정리(revoked)는 app_grants, 값 넣기와 sign-in은 secrets 변경으로 다시 읽는다.
  const read = useAccessView(app);

  async function revoke(grant: string): Promise<void> {
    setProblem(null);
    const reply = await source.revoke(grant);
    if (reply.ok) setRequested((now) => new Set(now).add(grant));
    else setProblem("revoke");
  }

  async function change(
    reply: Promise<SourceResult<true | "stored" | "cancelled">>,
    fail: Problem,
  ): Promise<void> {
    setProblem(null);
    if (!(await reply).ok) setProblem(fail);
  }

  return (
    <div className={styles.tab} data-tab-body="access">
      {problem === null ? null : (
        <PaneToast
          title={problemTitle(problem)}
          error
          onClose={() => setProblem(null)}
        />
      )}
      <Note>{t("app-detail.note.access-intro-secrets")}</Note>
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
            secretActions={(name) => {
              const subject = view.appName ?? app;
              return {
                setValue: () =>
                  void change(source.setSecretValue(name, subject), "secret"),
                removeValue: () =>
                  void change(source.removeSecretValue(name), "remove"),
                setClientId: (clientId) =>
                  void change(
                    source.setOAuthClientId(app, name, clientId),
                    "secret",
                  ),
                setClientSecret: () =>
                  void change(
                    source.setOAuthClientSecret(name, subject),
                    "secret",
                  ),
                signIn: () => void change(source.signIn(app, name), "sign-in"),
                cancelSignIn: () =>
                  void change(source.cancelSignIn(app, name), "sign-in"),
                signOut: () => void change(source.signOut(app, name), "remove"),
              };
            }}
          />
        )}
      </Loadable>
    </div>
  );
}

type Row = AccessView["resources"][number] | AccessView["appTools"][number];

/** 이 화면에서 거두기를 접수한 grant. core는 정리 중을 따로 읽게 하지 않는다. */
const asked = (row: Row, requested: ReadonlySet<string>) =>
  requested.has(row.grant);

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

function RevokeEnd({
  stage,
  onRevoke,
}: {
  stage: RevokeStage | null;
  onRevoke: () => void;
}) {
  if (stage === null) {
    return (
      <Button
        size="sm"
        variant="danger"
        icon={actionIcons.disconnect}
        data-revoke-button=""
        onClick={onRevoke}
      >
        {t("app-detail.button.revoke")}
      </Button>
    );
  }
  return stage === "cleaned" ? (
    <StatusMark tone="good" label={t("app-detail.label.revoked")} />
  ) : (
    <StatusMark tone="warning" label={t("app-detail.label.cleaning-up")} />
  );
}

function stageOf(row: Row, requested: ReadonlySet<string>): RevokeStage | null {
  if (!asked(row, requested)) return null;
  return row.revoked ? "cleaned" : "requested";
}

function AccessBody({
  view,
  requested,
  onRevoke,
  secretActions,
}: {
  view: AccessView;
  requested: ReadonlySet<string>;
  onRevoke: (grant: string) => void;
  secretActions: (name: string) => SecretActions;
}) {
  // 다른 때에 거둔 grant는 더 이 앱의 접근이 아니므로 보이지 않는다.
  const resources = view.resources.filter(
    (row) => !row.revoked || asked(row, requested),
  );
  const appTools = view.appTools.filter(
    (row) => !row.revoked || asked(row, requested),
  );
  return (
    <>
      <Section title={t("app-detail.heading.outside-resources")}>
        {resources.length === 0 ? (
          <p className={styles.muted}>{t("app-detail.note.no-resources")}</p>
        ) : (
          <ul className={styles.list} data-resources="">
            {resources.map((row) => {
              const stage = stageOf(row, requested);
              if (row.secret !== undefined) {
                return (
                  <SecretRow
                    key={row.grant}
                    name={row.name}
                    info={row.secret}
                    actions={secretActions(row.name)}
                    steps={
                      stage === null ? null : <RevokeSteps stage={stage} />
                    }
                    revoke={
                      <RevokeEnd
                        stage={stage}
                        onRevoke={() => onRevoke(row.grant)}
                      />
                    }
                  />
                );
              }
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
        {resources.some((row) => row.secret !== undefined) ? (
          <p className={styles.muted}>{t("app-detail.note.resource-secret")}</p>
        ) : null}
      </Section>
      <Section title={t("app-detail.heading.other-apps")}>
        {appTools.length === 0 ? (
          <p className={styles.muted}>{t("app-detail.note.no-other-apps")}</p>
        ) : (
          <ul className={styles.list} data-tools="">
            {appTools.map((row) => {
              const stage = stageOf(row, requested);
              return (
                <li
                  key={row.grant}
                  className={styles.item}
                  data-tool-grant={row.app}
                >
                  <div className={styles.rowText}>
                    <span className={styles.rowTitle}>
                      {row.appName ?? t("app-detail.label.caller-app-unnamed")}
                      {" › "}
                      {row.tools.map((item, index) => (
                        <span key={item.tool}>
                          {index === 0 ? "" : ", "}
                          <Mono>{item.tool}</Mono>
                        </span>
                      ))}
                    </span>
                    <span className={styles.muted}>
                      {t("app-detail.note.may-call")}
                      {row.tools.map((item) =>
                        item.effect === null ? null : (
                          <span key={item.tool}>
                            {" "}
                            <EffectPill effect={item.effect} />
                          </span>
                        ),
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
