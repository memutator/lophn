// App details의 원격 구독 경고 절. 활성 release 선언의 `subscriptions[].machine`이 지금 명단에서 다른 컴퓨터 하나로 풀리지
// 않을 때만 선다(이름이 바뀌었거나 같은 이름 컴퓨터가 둘이거나 이 컴퓨터 자신을 가리킬 때).
import { t } from "@lophn/i18n";

import { useUnresolvedSubscriptions } from "./reads.ts";
import type { UnresolvedSubscription } from "./source.ts";
import styles from "./app-section.module.css";

function reasonNote(row: UnresolvedSubscription): string {
  switch (row.reason) {
    case "ambiguous":
      return t("app-detail.note.subscription-ambiguous", {
        machine: row.machine,
      });
    case "self":
      return t("app-detail.note.subscription-self", { machine: row.machine });
    case "not_found":
      return t("app-detail.note.subscription-not-found", {
        machine: row.machine,
      });
  }
}

export function SubscriptionsSection({ app }: { app: string }) {
  const { loaded } = useUnresolvedSubscriptions(app);
  if (loaded.state !== "ready" || loaded.value.length === 0) return null;
  return (
    <section
      className={styles.section}
      aria-label={t("app-detail.heading.unresolved-subscriptions")}
      data-app-unresolved-subscriptions=""
    >
      <div className={styles.head}>
        <h4 className={styles.label}>
          {t("app-detail.heading.unresolved-subscriptions")}
        </h4>
      </div>
      <p className={styles.note}>
        {t("app-detail.note.unresolved-subscriptions")}
      </p>
      <div>
        {loaded.value.map((row) => (
          <div
            key={`${row.machine}:${row.source}:${row.event}`}
            className={styles.item}
            data-unresolved-subscription={row.machine}
            data-unresolved-reason={row.reason}
          >
            <div className={styles.row}>
              <span className={styles.stack}>
                <span className={styles.text}>
                  <span className={styles.state}>
                    {row.source} · {row.event}
                  </span>
                  <span className={styles.name}>{row.machine}</span>
                </span>
                <p className={styles.note}>{reasonNote(row)}</p>
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
