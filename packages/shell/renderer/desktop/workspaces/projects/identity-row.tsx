import { useEffect, useState } from "react";
import { t } from "@lophn/i18n";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Dialog, Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";

import { homeIcons, shellIcons } from "../../../icons/mod.ts";
import type { IdentityStatus, ProjectItem, ProjectsSource } from "./source.ts";
import styles from "./identity-row.module.css";

/** 글의 key 끝(`projects.state.identity-<state>`). */
type LineState = "not-git" | "no-remote" | "same-repository" | "matched";

interface Line {
  readonly state: LineState;
  readonly title?: string;
  /** 줄 오른쪽 끝에 [Separate project] 단추를 둔다. */
  readonly button?: true;
  /** 줄 끝 menu에 [Separate project]를 둔다. */
  readonly menu?: true;
}

// 상태마다 글 하나. 폴더를 못 찾으면(폴더 줄이 이미 알린다) 줄을 그리지 않는다.
function lineOf(status: IdentityStatus): Line | null {
  if (!status.found || status.repo === null) return null;
  if (status.repo === "none") return { state: "not-git" };
  if (!status.remote) return { state: "no-remote" };
  if (status.sameRepository !== null) {
    return {
      state: "same-repository",
      title: status.sameRepository.title,
      button: true,
    };
  }
  return { state: "matched", menu: true };
}

const SEPARATE = {
  icon: shellIcons.splitRemove,
  label: () => t("projects.button.identity-separate"),
} as const;

// 상세의 "Other computers" 줄. 열 때 한 번 읽고, [Separate project]를 누르면 그 결과로 줄을 다시 그린다.
// 단추가 실패하면 줄 아래에 알리고 줄은 다시 읽는다.
export function IdentityRow({
  source,
  project,
}: {
  source: ProjectsSource;
  project: ProjectItem;
}) {
  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let stale = false;
    void source.identity(project).then((read) => {
      if (!stale && read.ok) setStatus(read.value);
    });
    return () => {
      stale = true;
    };
  }, [source, project.id]);

  const separate = async () => {
    setBusy(true);
    setFailed(false);
    const result = await source.renewIdentity(project);
    if (result.ok) {
      setStatus(result.value);
    } else {
      setFailed(true);
      const read = await source.identity(project);
      if (read.ok) setStatus(read.value);
    }
    setBusy(false);
  };

  const line = status === null ? null : lineOf(status);
  if (line === null) return null;
  const more = t("projects.button.identity-more");

  return (
    <section className={styles.row} data-identity-row={line.state}>
      <div className={styles.line}>
        <div className={styles.text}>
          <span className={styles.label}>
            {t("projects.label.other-computers")}
          </span>
          <span className={styles.state}>
            {t(`projects.state.identity-${line.state}`, {
              title: line.title ?? "",
            })}
          </span>
        </div>
        {line.button ? (
          <Button
            size="sm"
            icon={SEPARATE.icon}
            disabled={busy}
            data-identity-action="separate"
            onClick={() => setConfirming(true)}
          >
            {SEPARATE.label()}
          </Button>
        ) : null}
        {line.menu ? (
          <Menu
            trigger={
              <Tooltip content={more}>
                <IconButton
                  icon={homeIcons.more}
                  label={more}
                  size="sm"
                  data-identity-menu=""
                />
              </Tooltip>
            }
            items={[
              {
                id: "separate",
                label: SEPARATE.label(),
                data: { "data-menu-item": "separate" },
                leading: <MenuIcon icon={SEPARATE.icon} />,
              },
            ]}
            onSelect={() => setConfirming(true)}
          />
        ) : null}
      </div>
      {failed ? (
        <p className={styles.error} role="alert" data-identity-failed="">
          {t("projects.error.identity-failed")}
        </p>
      ) : null}
      {confirming ? (
        <Dialog
          open
          title={t("projects.dialog.identity-separate-title")}
          onOpenChange={(open) => {
            if (!open) setConfirming(false);
          }}
          actions={
            <>
              <Button onClick={() => setConfirming(false)}>
                {t("common.button.cancel")}
              </Button>
              <Button
                variant="secondary"
                icon={SEPARATE.icon}
                data-identity-confirm=""
                onClick={() => {
                  setConfirming(false);
                  void separate();
                }}
              >
                {SEPARATE.label()}
              </Button>
            </>
          }
        >
          <p className={styles.state}>
            {t("projects.dialog.identity-separate-note")}
          </p>
        </Dialog>
      ) : null}
    </section>
  );
}
