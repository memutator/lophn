// Connections 탭(flow connect-apps 1·7). 이 앱이 부르려는 다른 앱과 그 앱의 action, 사람이 허락한
// 범위를 구별해 보인다. 선언과 허락은 다르다. 허락·회수는 사람 결정이라 confirmation window로 보낸다.
import { useState } from "react";
import { Button, StatusMark } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { Loadable } from "../loadable.tsx";
import type { AppDetailSource, BlueprintView, GrantRow } from "../source.ts";
import { useRead } from "../use-read.ts";
import styles from "../app-detail.module.css";

export interface ConnectionsTabProps {
  app: string;
  source: AppDetailSource;
  now: () => Date;
}

const POLL_MS = 4000;

interface Pair {
  readonly target: string;
  /** 이 앱이 선언한 action 이름(앱이 지은 key). */
  readonly declared: readonly string[];
  readonly grant: GrantRow | null;
}

function pairsOf(
  blueprint: BlueprintView | null,
  grants: readonly GrantRow[],
): readonly Pair[] {
  const callGrants = grants.filter((grant) =>
    grant.active && grant.kind === "app.call" && grant.targetApp !== null
  );
  const targets = new Set<string>();
  for (const entry of blueprint?.connections ?? []) targets.add(entry.app);
  for (const grant of callGrants) targets.add(grant.targetApp as string);
  return [...targets].map((target) => ({
    target,
    declared: blueprint?.connections.find((entry) => entry.app === target)
      ?.commands ?? [],
    grant: callGrants.find((grant) => grant.targetApp === target) ?? null,
  }));
}

export function ConnectionsTab({ app, source, now }: ConnectionsTabProps) {
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const blueprint = useRead(() => source.blueprint(app), [app, source], {
    now,
  });
  const access = useRead(() => source.access(app), [app, source], {
    pollMs: asked.size > 0 ? POLL_MS : undefined,
    now,
  });

  async function decide(
    target: string,
    decision:
      | { kind: "connect_apps"; app: string; target: string }
      | { kind: "remove_access"; app: string; grant: string },
  ): Promise<void> {
    setFailed(false);
    // 확인 창이 거절·닫힘 등으로 확정 없이 끝나면 기다림을 푼다.
    const reply = await source.decide(decision, () =>
      setAsked((now) => {
        const next = new Set(now);
        next.delete(target);
        return next;
      }));
    if (reply.ok) setAsked((now) => new Set(now).add(target));
    else setFailed(true);
  }

  return (
    <div className={styles.tab} data-tab-body="connections">
      <Loadable
        read={blueprint}
        target={t("app-detail.label.connections-target")}
        now={now}
      >
        {(view) => {
          const grants = access.loaded.state === "ready"
            ? access.loaded.value.grants
            : [];
          const pairs = pairsOf(view, grants);
          return (
            <>
              {failed
                ? (
                  <p
                    className={styles.warning}
                    role="alert"
                    data-decision-failed=""
                  >
                    {t("app-detail.error.decision-failed")}
                  </p>
                )
                : null}
              {pairs.length === 0
                ? (
                  <p className={styles.state} data-connections-empty="">
                    {t("app-detail.note.connections-empty")}
                  </p>
                )
                : (
                  <ul className={styles.list}>
                    {pairs.map((pair) => (
                      <ConnectionRow
                        key={pair.target}
                        pair={pair}
                        source={source}
                        waiting={asked.has(pair.target)}
                        onReview={() =>
                          void decide(pair.target, {
                            kind: "connect_apps",
                            app,
                            target: pair.target,
                          })}
                        onRemove={() =>
                          pair.grant &&
                          void decide(pair.target, {
                            kind: "remove_access",
                            app,
                            grant: pair.grant.id,
                          })}
                      />
                    ))}
                  </ul>
                )}
            </>
          );
        }}
      </Loadable>
    </div>
  );
}

function ConnectionRow(
  { pair, source, waiting, onReview, onRemove }: {
    pair: Pair;
    source: AppDetailSource;
    waiting: boolean;
    onReview(): void;
    onRemove(): void;
  },
) {
  const name = useRead(
    async () => {
      const found = await source.appName(pair.target);
      return found === null
        ? { ok: false as const, code: "not_found" }
        : { ok: true as const, value: found };
    },
    [pair.target, source],
  );
  const target = useRead(() => source.blueprint(pair.target), [
    pair.target,
    source,
  ]);
  const labels = target.loaded.state === "ready" && target.loaded.value
    ? target.loaded.value.commands
    : [];
  // 허락한 action 이름. 선언만 있고 허락이 없으면 허락한 것이 없다.
  const allowed = pair.grant?.commands ?? [];
  const covered = pair.declared.length > 0 &&
    pair.declared.every((key) => allowed.includes(key));
  const label = (key: string) =>
    labels.find((command) => command.key === key)?.label ??
      t("app-detail.label.an-action");
  const shown = pair.grant !== null ? allowed : pair.declared;
  return (
    <li
      className={styles.row}
      data-connection={pair.target}
      data-allowed={pair.grant === null ? "none" : covered ? "all" : "some"}
    >
      <div className={styles.rowHead}>
        <span className={styles.title} data-target-name="">
          {name.loaded.state === "ready"
            ? name.loaded.value
            : t("app-detail.label.another-app")}
        </span>
        <StatusMark
          tone={pair.grant === null ? "neutral" : covered ? "good" : "warning"}
          label={pair.grant === null
            ? t("app-detail.label.connection-asks")
            : covered
            ? t("app-detail.label.connection-allowed")
            : t("app-detail.label.connection-partly")}
        />
      </div>
      <p className={styles.text} data-actions="">
        {t("app-detail.label.connection-actions", {
          count: shown.length,
        })}
      </p>
      {shown.length > 0
        ? (
          <ul className={styles.detailList}>
            {shown.map((key) => (
              <li key={key} className={styles.text}>{label(key)}</li>
            ))}
          </ul>
        )
        : null}
      {waiting
        ? (
          <p className={styles.text} role="status" data-decision-waiting="">
            {t("app-detail.note.decision-waiting")}
          </p>
        )
        : null}
      <div className={styles.actions}>
        {!covered
          ? (
            <Button
              size="sm"
              variant="primary"
              disabled={waiting}
              onClick={onReview}
              data-review-connection=""
            >
              {t("app-detail.button.review-connection")}
            </Button>
          )
          : null}
        {pair.grant !== null
          ? (
            <Button
              size="sm"
              variant="danger"
              disabled={waiting}
              onClick={onRemove}
              data-remove-connection=""
            >
              {t("app-detail.button.remove-access")}
            </Button>
          )
          : null}
      </div>
      <p className={styles.muted} data-connection-caveat="">
        {t("app-detail.note.connection-scope")}
      </p>
    </li>
  );
}
