// 이 컴퓨터에 없는 project 줄 아래 한 줄. git project는 [Clone here]로 이 컴퓨터에 clone하고(shell main이 이 컴퓨터의
// `project.clone`을 부른다), git이 아닌 project는 [Link…]로 이 컴퓨터의 git이 아닌 project와 잇는다(잇기 dialog는 부르는 쪽이 연다).
import { useState } from "react";
import { t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";

import type { CloneHereOutcome } from "../../desktop/machines/source.ts";
import type { Away } from "../../desktop/workspaces/projects/merged.ts";
import { actionIcons } from "../../icons/mod.ts";
import styles from "./away-line.module.css";

type CloneState =
  | { readonly state: "idle" | "cloning" }
  | { readonly state: "done" | "failed"; readonly text: string };

export function AwayLine({
  away,
  offline,
  cloneHere,
  onLink,
}: {
  away: Away;
  /** 그 project를 가진 기계가 꺼져 있으면 그 이름. 가져올 수 없어 단추 없이 한 줄이다. */
  offline?: string;
  /** 없으면(이 창에 기계 통로가 없다) [Clone here]가 없다. */
  cloneHere?: (input: {
    readonly url: string;
    readonly identity: string;
    readonly title: string;
  }) => Promise<CloneHereOutcome>;
  onLink: () => void;
}) {
  const [clone, setClone] = useState<CloneState>({ state: "idle" });
  if (offline !== undefined) {
    return (
      <div className={styles.block} data-away="offline">
        <p className={styles.note}>
          {t("machines.panel.off", { name: offline })}
        </p>
      </div>
    );
  }
  if (away.kind === "link") {
    return (
      <div className={styles.block} data-away="link">
        <div className={styles.line}>
          <span className={styles.label}>{t("machines.group.not-here")}</span>
          <Button
            size="sm"
            icon={actionIcons.connect}
            data-link-project=""
            onClick={onLink}
          >
            {t("machines.group.link")}
          </Button>
        </div>
      </div>
    );
  }
  const { url } = away;
  if (url === null || cloneHere === undefined) {
    return (
      <div className={styles.block} data-away="clone">
        <p className={styles.note}>{t("machines.group.no-remote")}</p>
      </div>
    );
  }
  const run = async () => {
    setClone({ state: "cloning" });
    const outcome = await cloneHere({
      url,
      identity: away.identity,
      title: away.title,
    });
    if (outcome.ok) {
      setClone({
        state: "done",
        text: t("machines.group.cloned", { path: outcome.path }),
      });
    } else if (outcome.reason === "cancelled") setClone({ state: "idle" });
    else {
      setClone({
        state: "failed",
        text:
          outcome.reason === "git_auth"
            ? t("machines.group.git-auth", { command: outcome.command })
            : t("machines.group.clone-failed", { message: outcome.message }),
      });
    }
  };
  return (
    <div className={styles.block} data-away="clone">
      <div className={styles.line}>
        <span className={styles.label}>{t("machines.group.not-here")}</span>
        <Button
          size="sm"
          icon={actionIcons.download}
          disabled={clone.state === "cloning"}
          data-clone-here=""
          onClick={() => void run()}
        >
          {clone.state === "cloning"
            ? t("machines.group.cloning")
            : t("machines.group.clone")}
        </Button>
      </div>
      {clone.state === "done" ? (
        <p className={styles.note}>{clone.text}</p>
      ) : clone.state === "failed" ? (
        <p className={styles.error}>{clone.text}</p>
      ) : null}
    </div>
  );
}
