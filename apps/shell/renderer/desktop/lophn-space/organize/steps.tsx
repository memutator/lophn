import { t } from "@lophn/wording";

import { stepsIncomplete } from "./model.ts";
import type { FileStep, PlaceOutcome, UnlinkOutcome } from "./source.ts";
import listStyles from "../documents/documents.module.css";
import styles from "./organize.module.css";

function stateLabel(step: FileStep): string {
  if (step.state === "done") return t("projects.label.step-done");
  if (step.state === "skipped") return t("projects.label.step-skipped");
  if (step.state === "not_attempted") {
    return t("projects.label.step-not-attempted");
  }
  return step.code === "forbidden"
    ? t("projects.label.step-forbidden")
    : t("projects.label.step-failed");
}

function StepRows(
  { rows }: { rows: readonly [string, string, FileStep][] },
) {
  return (
    <ol className={styles.steps}>
      {rows.map(([name, label, step]) => (
        <li
          key={name}
          className={styles.step}
          data-step={name}
          data-step-state={step.state}
        >
          <span>{label}</span>
          <span className={styles.stepState}>{stateLabel(step)}</span>
        </li>
      ))}
    </ol>
  );
}

// 파일로 두기 결과. 파일 쓰기와 그 뒤 연결 단계(원본 연결, 추적 규칙, 자리)를 따로 보인다.
// 뒤 단계 실패가 파일 성공을 지우지 않는다(documents/file-tracking#R13).
export function PlaceResult({ outcome }: { outcome: PlaceOutcome }) {
  const fileText = outcome.file === "written"
    ? t("projects.result.file-written")
    : outcome.file === "conflict"
    ? t("projects.result.file-conflict")
    : outcome.file === "unknown"
    ? t("projects.result.file-unknown")
    : t("projects.result.file-failed");
  const steps = outcome.steps;
  return (
    <div className={styles.result} data-place-result={outcome.file}>
      <p
        className={outcome.file === "written"
          ? listStyles.hint
          : listStyles.notice}
      >
        {fileText}
      </p>
      {outcome.path === null
        ? null
        : <p className={styles.path} data-place-path="">{outcome.path}</p>}
      {steps === null ? null : (
        <StepRows
          rows={[
            ["source", t("projects.label.step-source"), steps.source],
            ["tracking", t("projects.label.step-tracking"), steps.tracking],
            ["move", t("projects.label.step-move"), steps.move],
          ]}
        />
      )}
      {steps !== null &&
          stepsIncomplete([steps.source, steps.tracking, steps.move])
        ? (
          <p className={listStyles.notice} data-steps-incomplete="">
            {t("projects.notice.steps-incomplete")}
          </p>
        )
        : null}
    </div>
  );
}

// 파일에서 빼기 결과. 파일 삭제와 그 뒤 연결 해제·자리 되돌리기를 따로 보인다.
export function UnlinkResult({ outcome }: { outcome: UnlinkOutcome }) {
  return (
    <div className={styles.result} data-unlink-result={outcome.file}>
      <p className={listStyles.hint}>
        {t(
          outcome.file === "deleted"
            ? "projects.result.file-deleted"
            : "projects.result.file-gone",
        )}
      </p>
      <StepRows
        rows={[
          [
            "source",
            t("projects.label.step-unlink-source"),
            outcome.steps.source,
          ],
          ["move", t("projects.label.step-unlink-move"), outcome.steps.move],
        ]}
      />
    </div>
  );
}
