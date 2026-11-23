// workflow의 step을 순서대로 한 줄에 보인다: step 이름과 맡은 쪽의 얼굴. 선언의 순서일 뿐이고 graph가 아니다.
// run 화면에서는 step마다 상태(지금, 사람 차례, report함, 아직)를 같이 보인다.
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import { commonIcons } from "../icons/mod.ts";
import { type FaceOf, type RelayStep, STEP_KEY, whoName } from "./model.ts";
import styles from "./relay.module.css";
import { WhoMark } from "./who.tsx";

/** 맡은 쪽 글. 사람 step은 "You, with lophn"다. */
export const assigneeText = (
  step: RelayStep,
  faceOf: FaceOf | undefined,
): string =>
  step.with === null
    ? whoName(step.who, faceOf)
    : t("workflow.label.assignee-with", {
        by: whoName(step.who, faceOf),
        with: whoName(step.with, faceOf),
      });

export function Relay({
  steps,
  faceOf,
}: {
  steps: readonly RelayStep[];
  faceOf: FaceOf | undefined;
}) {
  return (
    <ol className={styles.relay} aria-label={t("workflow.label.steps")}>
      {steps.map((step, index) => (
        <li
          key={step.name}
          className={styles.item}
          data-relay-step={step.name}
          data-shown={step.heldThere === true ? "human" : step.shown}
          data-blocked={step.blocked === true ? "" : undefined}
        >
          {index === 0 ? null : (
            <span className={styles.arrow} aria-hidden="true">
              <Icon icon={commonIcons.expand} pixels={iconPixels("base")} />
            </span>
          )}
          <span className={styles.step}>
            {/* 사람 step의 얼굴은 사람이다. 같이 이야기하는 agent는 글에 있다. */}
            <WhoMark who={step.who} faceOf={faceOf} />
            <span className={styles.text}>
              <span className={styles.name}>{step.name}</span>
              <span className={styles.who}>
                {step.stalled === true
                  ? t("workflow.label.step-stalled")
                  : step.blocked === true
                    ? t("workflow.label.step-blocked")
                    : step.waitingOn !== undefined
                      ? t("workflow.label.step-remote-waiting", {
                          computer: step.waitingOn,
                        })
                      : step.shown === undefined ||
                          step.shown === "waiting" ||
                          step.shown === "reported"
                        ? assigneeText(step, faceOf)
                        : t(STEP_KEY[step.shown])}
              </span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
