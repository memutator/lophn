// project sidebar의 Domains 탭. 위쪽 [New domain], 줄마다 이름과 한 줄 목적, 줄 끝 menu(Open DOMAIN.md, Archive).
// 목록은 이 탭이 읽고, 만들기·보관 뒤에 다시 읽는다. 마지막 domain 규칙은 앱에만 있어 project는 0개가 될 수 있다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { ErrorState } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";

import { commonIcons } from "../../icons/mod.ts";
import { DomainMenu } from "../domains/domain-menu.tsx";
import { DomainNotice } from "../domains/domain-notice.tsx";
import { CreateDomainDialog } from "../domains/create-domain-dialog.tsx";
import { useDomains } from "../domains/use-domains.ts";
import type { WorkspaceSource } from "../source.ts";
import styles from "./domain-panel.module.css";

export function DomainPanel({
  project,
  source,
  onOpenDoc,
}: {
  project: string;
  source: WorkspaceSource;
  /** DOMAIN.md를 편집기로 연다. */
  onOpenDoc: (domain: string) => void;
}) {
  const owner = { kind: "project" as const, id: project };
  const domains = useDomains(owner, () => source.domains(project), source);
  const [creating, setCreating] = useState(false);
  const { loaded, notice } = domains;
  return (
    <>
      <div className={styles.head}>
        <h2 className={styles.headLabel}>{t("domain.heading.list")}</h2>
        <Button
          size="sm"
          icon={commonIcons.add}
          onClick={() => setCreating(true)}
        >
          {t("domain.button.new")}
        </Button>
      </div>
      {notice === null ? null : (
        <div className={styles.notice}>
          <DomainNotice
            notice={notice}
            onUndo={() => void domains.undo(notice.domain)}
            onClose={domains.closeNotice}
          />
        </div>
      )}
      {loaded.state === "failed" ? (
        <ErrorState target={t("domain.label.pick")} onRetry={domains.reload} />
      ) : null}
      {loaded.state === "ready" && loaded.domains.length === 0 ? (
        <p className={styles.empty}>{t("domain.empty.project")}</p>
      ) : null}
      {loaded.state === "ready" && loaded.domains.length > 0 ? (
        <ul className={styles.rows} aria-label={t("domain.heading.list")}>
          {loaded.domains.map((domain) => (
            <li
              key={domain.id}
              className={styles.row}
              data-domain={domain.name}
            >
              <span className={styles.text}>
                <span className={styles.rowHead}>
                  <span className={styles.title}>{domain.title}</span>
                  <span className={styles.name}>{domain.name}</span>
                </span>
                <span className={styles.line}>{domain.purpose}</span>
              </span>
              <span className={styles.action}>
                <DomainMenu
                  title={domain.title}
                  onOpenDoc={() => onOpenDoc(domain.id)}
                  onArchive={() => void domains.archive(domain)}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {creating ? (
        <CreateDomainDialog
          onCreate={domains.create}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}
