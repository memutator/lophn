import { useState } from "react";
import { t } from "@lophn/i18n";
import { List, ListItem } from "@lophn/ui/data";
import { Dialog } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";

import { actionIcons } from "../../../icons/mod.ts";
import type { ProjectItem, SourceResult } from "./source.ts";
import styles from "./link-dialog.module.css";

export interface LinkProjectDialogProps {
  /** 다른 기계의 git이 아닌 project. */
  readonly remote: {
    readonly machineName: string;
    readonly title: string;
    readonly identity: string;
  };
  /** 이 컴퓨터의 git이 아닌 project 가운데 그 id가 아닌 것. 거르는 것은 부르는 쪽이다. */
  readonly candidates: readonly ProjectItem[];
  /** 고른 project에 remote의 id를 적는다(`ProjectsSource.linkIdentity`). 성공하면 dialog가 닫힌다. */
  readonly onLink: (project: ProjectItem) => Promise<SourceResult<unknown>>;
  readonly onClose: () => void;
}

// 다른 기계의 git이 아닌 project 하나를 이 컴퓨터의 git이 아닌 project 하나와 잇는다. 잇기 전에 고른 project가 어느 기계의
// 무엇과 같은 project가 되는지 한 줄로 보인다.
export function LinkProjectDialog({
  remote,
  candidates,
  onLink,
  onClose,
}: LinkProjectDialogProps) {
  const [chosen, setChosen] = useState<ProjectItem | null>(
    candidates.length === 1 ? candidates[0]! : null,
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const link = async () => {
    if (chosen === null) return;
    setBusy(true);
    setFailed(null);
    const done = await onLink(chosen);
    setBusy(false);
    if (done.ok) onClose();
    else setFailed(done.code);
  };

  return (
    <Dialog
      open
      title={t("projects.link.title")}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          <Button onClick={onClose}>{t("common.button.cancel")}</Button>
          {candidates.length > 0 ? (
            <Button
              variant="primary"
              icon={actionIcons.connect}
              disabled={chosen === null || busy}
              data-link-confirm=""
              onClick={() => void link()}
            >
              {t("projects.link.button")}
            </Button>
          ) : null}
        </>
      }
    >
      <div className={styles.body} data-link-dialog="">
        <p className={styles.note}>
          {candidates.length === 0
            ? t("projects.link.empty", {
                title: remote.title,
                machine: remote.machineName,
              })
            : t("projects.link.intro", {
                title: remote.title,
                machine: remote.machineName,
              })}
        </p>
        {candidates.length > 0 ? (
          <div className={styles.candidates} data-link-candidates="">
            <List>
              {candidates.map((project) => (
                <ListItem
                  key={project.id}
                  title={project.title}
                  meta={project.folders[0]?.path}
                  selected={chosen?.id === project.id}
                  onSelect={() => setChosen(project)}
                />
              ))}
            </List>
          </div>
        ) : null}
        {chosen !== null ? (
          <p className={styles.result} data-link-result="">
            {t("projects.link.result", {
              project: chosen.title,
              title: remote.title,
              machine: remote.machineName,
            })}
          </p>
        ) : null}
        {failed !== null ? (
          <p className={styles.error} role="alert" data-link-failed={failed}>
            {failed === "conflict"
              ? t("projects.link.error-in-use")
              : t("projects.link.error-failed")}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
