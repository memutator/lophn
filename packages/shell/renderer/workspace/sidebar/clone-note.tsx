// 다른 기계의 project 줄 menu에서 [Clone to this computer]를 고른 뒤 그 줄 아래에 서는 한 줄. 진행 중과 결과만 말하고, 결과는
// 사람이 누르면 걷힌다. clone은 shell main이 이 컴퓨터의 `project.clone`을 부른다.
import { t } from "@lophn/i18n";

import type { CloneHereOutcome } from "../../desktop/machines/source.ts";
import styles from "./clone-note.module.css";

export type CloneState =
  | { readonly state: "cloning" }
  | { readonly state: "done" | "failed"; readonly text: string };

/** clone 결과를 줄 아래 글로 바꾼다. 사람이 폴더 고르기를 그만두었으면 null이다. */
export function cloneResult(outcome: CloneHereOutcome): CloneState | null {
  if (outcome.ok) {
    return {
      state: "done",
      text: t("machines.group.cloned", { path: outcome.path }),
    };
  }
  if (outcome.reason === "cancelled") return null;
  return {
    state: "failed",
    text:
      outcome.reason === "git_auth"
        ? t("machines.group.git-auth", { command: outcome.command })
        : t("machines.group.clone-failed", { message: outcome.message }),
  };
}

export function CloneNote({
  clone,
  onDismiss,
}: {
  clone: CloneState;
  onDismiss: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.block}
      data-clone-note={clone.state}
      disabled={clone.state === "cloning"}
      onClick={onDismiss}
    >
      <span className={clone.state === "failed" ? styles.error : styles.note}>
        {clone.state === "cloning" ? t("machines.group.cloning") : clone.text}
      </span>
    </button>
  );
}
