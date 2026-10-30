// "What changes, rA to rB". 대기 목록 카드의 비교와 같은 모양이다: 늘어난 선언과 손실 단계만 보인다.
// 대기 목록 카드의 비교(desktop/connection/waiting/cards/activation-card.tsx)는 그 카드 안의 줄이라
// 가져다 쓸 component가 아니어서 여기서 만든다.
import { DiffMark } from "@lophn/ui/reading";
import { t } from "@lophn/i18n";

import { lossText, releaseName } from "../model.ts";
import { Mono, Note, Section } from "../parts.tsx";
import type { ReleaseChanges } from "../source.ts";
import styles from "../app-detail.module.css";

export function hasChanges(changes: ReleaseChanges): boolean {
  return (
    changes.addedResources.length > 0 ||
    changes.addedTools.length > 0 ||
    changes.lossSteps.length > 0
  );
}

export function Changes({ changes }: { changes: ReleaseChanges }) {
  const to = releaseName(changes.toNumber);
  const title =
    changes.fromNumber === null
      ? t("app-detail.heading.changes-first", { to })
      : t("app-detail.heading.changes", {
          from: releaseName(changes.fromNumber),
          to,
        });
  const losses = changes.lossSteps.flatMap((step) =>
    step.loss.map((loss) => lossText(loss)),
  );
  const wider = changes.addedResources.length + changes.addedTools.length > 0;
  return (
    <Section title={title}>
      {!wider && losses.length === 0 ? (
        <Note>{t("app-detail.note.changes-none")}</Note>
      ) : (
        <div className={styles.card} data-changes="">
          {wider ? (
            <>
              <span className={styles.strong}>
                {t("app-detail.label.changes-wider")}
              </span>
              {changes.addedResources.map((name) => (
                <div key={name} className={styles.diffRow}>
                  <DiffMark kind="add" />
                  <span>{t("app-detail.label.changes-resource")}</span>
                  <Mono>{name}</Mono>
                </div>
              ))}
              {changes.addedTools.map((item) => (
                <div
                  key={`${item.app}:${item.tool}`}
                  className={styles.diffRow}
                >
                  <DiffMark kind="add" />
                  <span>{t("app-detail.label.changes-tool")}</span>
                  <Mono>
                    {`${
                      item.appName ?? t("app-detail.label.caller-app-unnamed")
                    } › ${item.tool}`}
                  </Mono>
                </div>
              ))}
            </>
          ) : null}
          {losses.length > 0 ? (
            <>
              <span className={styles.strong}>
                {t("app-detail.label.changes-loss")}
              </span>
              {losses.map((loss) => (
                <div
                  key={`${loss.label}:${loss.value}`}
                  className={styles.diffRow}
                >
                  <DiffMark kind="delete" />
                  <span>{loss.label}</span>
                  <Mono>{loss.value}</Mono>
                </div>
              ))}
            </>
          ) : null}
        </div>
      )}
    </Section>
  );
}
