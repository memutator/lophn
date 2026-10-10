// Access 탭(flow manage-app-permissions 1·5·6). 앱이 읽을 수 있는 파일·보낼 수 있는 host·쓰는
// secret 이름을 정확한 원문(고정폭)으로 보이고, 조합 경고를 먼저 둔다. 바꾸기와 회수는 사람
// 결정이라 confirmation window로 보낸다. 회수는 요청 접수와 실제 정리를 구별한다: 프로세스 종료를
// 확인하기 전까지 완료라고 하지 않고, secret 값은 실제로 지워졌을 때만 지웠다고 한다.
import { useState } from "react";
import { Button } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { Loadable } from "../loadable.tsx";
import { ACCESS_GROUPS, warningText } from "../model.ts";
import type {
  AccessView,
  AppDetailSource,
  GrantRow,
  SecretState,
} from "../source.ts";
import { useRead } from "../use-read.ts";
import styles from "../app-detail.module.css";

export interface AccessTabProps {
  app: string;
  source: AppDetailSource;
  now: () => Date;
}

const POLL_MS = 4000;

/** 이 앱이 쓸 수 있는 범위로 사람이 허락한 것(앱 연결과 automation은 다른 탭). */
function isAccess(grant: GrantRow): boolean {
  return grant.kind !== "app.call" && grant.kind !== "automation.run";
}

export function AccessTab({ app, source, now }: AccessTabProps) {
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);

  const access = useRead(() => source.access(app), [app, source], {
    // 회수 요청을 보낸 동안은 실제 정리가 끝났는지 다시 읽는다.
    pollMs: requested.size > 0 ? POLL_MS : undefined,
    now,
  });
  const runtime = useRead(() => source.runtime(app), [app, source], {
    pollMs: requested.size > 0 ? POLL_MS : undefined,
    now,
  });
  const secretNames = access.loaded.state === "ready"
    ? access.loaded.value.grants.filter((grant) => grant.kind === "secret.use")
      .map((grant) => grant.exact)
    : [];
  const secrets = useRead(
    () => source.secrets(secretNames),
    [source, secretNames.join("\n")],
    { pollMs: requested.size > 0 ? POLL_MS : undefined, now },
  );

  async function remove(grant: GrantRow): Promise<void> {
    setFailed(false);
    // 확인 창이 거절·닫힘 등으로 확정 없이 끝나면 기다림을 푼다.
    const reply = await source.decide({
      kind: "remove_access",
      app,
      grant: grant.id,
    }, () =>
      setRequested((now) => {
        const next = new Set(now);
        next.delete(grant.id);
        return next;
      }));
    if (reply.ok) setRequested((now) => new Set(now).add(grant.id));
    else setFailed(true);
  }

  async function review(requirement: number): Promise<void> {
    setFailed(false);
    setAsking(true);
    const reply = await source.decide({
      kind: "change_access",
      app,
      requirement,
    });
    setAsking(false);
    if (!reply.ok) setFailed(true);
  }

  const terminating = runtime.loaded.state === "ready" &&
    runtime.loaded.value.terminationPending;
  const secretStates: readonly SecretState[] = secrets.loaded.state === "ready"
    ? secrets.loaded.value
    : [];

  return (
    <div className={styles.tab} data-tab-body="access">
      <Loadable
        read={access}
        target={t("app-detail.label.access-target")}
        now={now}
      >
        {(view) => (
          <AccessBody
            view={view}
            requested={requested}
            terminating={terminating}
            secrets={secretStates}
            asking={asking}
            failed={failed}
            onRemove={(grant) => void remove(grant)}
            onReview={(requirement) => void review(requirement)}
          />
        )}
      </Loadable>
    </div>
  );
}

function AccessBody(
  { view, requested, terminating, secrets, asking, failed, onRemove, onReview }:
    {
      view: AccessView;
      requested: ReadonlySet<string>;
      terminating: boolean;
      secrets: readonly SecretState[];
      asking: boolean;
      failed: boolean;
      onRemove(grant: GrantRow): void;
      onReview(requirement: number): void;
    },
) {
  const active = view.grants.filter((grant) => grant.active && isAccess(grant));
  const removed = view.grants.filter((grant) =>
    !grant.active && isAccess(grant)
  );
  const missing = view.requirements.filter((requirement) =>
    !requirement.granted
  );
  return (
    <>
      {view.warnings.map((key) => (
        <p key={key} className={styles.warning} data-access-warning={key}>
          {warningText(key)}
        </p>
      ))}
      {failed
        ? (
          <p className={styles.warning} role="alert" data-decision-failed="">
            {t("app-detail.error.decision-failed")}
          </p>
        )
        : null}
      {active.length === 0
        ? (
          <p className={styles.state} data-access-empty="">
            {t("app-detail.note.access-empty")}
          </p>
        )
        : null}
      {ACCESS_GROUPS.map((group) => {
        const rows = active.filter((grant) => grant.kind === group.kind);
        if (rows.length === 0) return null;
        return (
          <section
            key={group.kind}
            className={styles.section}
            data-access-group={group.kind}
          >
            <h3 className={styles.heading}>{group.heading()}</h3>
            <ul className={styles.list}>
              {rows.map((grant) => (
                <li
                  key={grant.id}
                  className={styles.row}
                  data-grant={grant.id}
                  data-revoke={requested.has(grant.id)
                    ? terminating ? "waiting-stop" : "requested"
                    : "none"}
                >
                  <span className={styles.mono} data-exact="">
                    {grant.exact}
                  </span>
                  {requested.has(grant.id)
                    ? (
                      <p className={styles.text} role="status" data-removing="">
                        {terminating
                          ? t("app-detail.note.access-removing-stop")
                          : t("app-detail.note.access-removing")}
                      </p>
                    )
                    : null}
                  {grant.kind === "secret.use"
                    ? (
                      <SecretLine
                        name={grant.exact}
                        secrets={secrets}
                        removed={!grant.active}
                      />
                    )
                    : null}
                  <div className={styles.actions}>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={requested.has(grant.id)}
                      onClick={() => onRemove(grant)}
                      data-remove-access=""
                    >
                      {t("app-detail.button.remove-access")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {missing.length > 0
        ? (
          <section className={styles.section} data-access-asks="">
            <h3 className={styles.heading}>
              {t("app-detail.heading.access-asks")}
            </h3>
            <ul className={styles.list}>
              {missing.map((requirement) => (
                <li
                  key={`${requirement.kind}:${requirement.exact}`}
                  className={styles.row}
                >
                  <span className={styles.mono}>{requirement.exact}</span>
                  <p className={styles.text}>{requirement.reason}</p>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={asking}
                    onClick={() =>
                      onReview(view.requirements.indexOf(requirement))}
                    data-change-access=""
                  >
                    {t("app-detail.button.change-access")}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )
        : null}
      {removed.length > 0
        ? (
          <details className={styles.details} data-access-removed="">
            <summary>{t("app-detail.heading.access-removed")}</summary>
            <ul className={styles.list}>
              {removed.map((grant) => (
                <li key={grant.id} className={styles.row}>
                  <span className={styles.mono}>{grant.exact}</span>
                  <p className={styles.text} data-removed="">
                    {t("app-detail.note.access-removed")}
                  </p>
                  {grant.kind === "secret.use"
                    ? (
                      <SecretLine
                        name={grant.exact}
                        secrets={secrets}
                        removed={!grant.active}
                      />
                    )
                    : null}
                </li>
              ))}
            </ul>
          </details>
        )
        : null}
      <p className={styles.muted} data-access-caveat="">
        {t("app-detail.note.access-removal-scope")}
      </p>
    </>
  );
}

// secret 값을 지우는 일은 접근 회수와 따로 확인한다. 확인한 것만 말한다.
function SecretLine(
  { name, secrets, removed }: {
    name: string;
    secrets: readonly SecretState[];
    removed: boolean;
  },
) {
  const state = secrets.find((secret) => secret.name === name);
  if (state === undefined) return null;
  let text: string;
  if (removed) {
    text = state.stored
      ? t("app-detail.note.secret-still-stored")
      : t("app-detail.note.secret-deleted");
  } else {
    text = state.stored
      ? t("app-detail.note.secret-stored")
      : t("app-detail.note.secret-missing");
  }
  return (
    <p
      className={styles.text}
      data-secret-value={state.stored ? "stored" : "deleted"}
    >
      {text}
    </p>
  );
}
