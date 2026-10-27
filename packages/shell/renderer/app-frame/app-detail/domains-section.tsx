// App details의 Domains 절. 이름 아래에 놓이고 줄마다 domain과 tool 수, 줄 끝 menu(Open DOMAIN.md, Archive)가 있다.
// 앱은 domain이 0개가 되지 못하므로 마지막 active domain 줄은 Archive가 꺼진다. core가 그래도 거절하면 그 이유를 목록 위에 보인다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/wording";

import { commonIcons } from "../../icons/mod.ts";
import { DomainMenu } from "../../workspace/domains/domain-menu.tsx";
import { DomainNotice } from "../../workspace/domains/domain-notice.tsx";
import { CreateDomainDialog } from "../../workspace/domains/create-domain-dialog.tsx";
import { useDomains } from "../../workspace/domains/use-domains.ts";
import type { AppDetailSource } from "./source.ts";
import styles from "./domains-section.module.css";

export function DomainsSection({
  app,
  source,
  onOpenDoc,
}: {
  app: string;
  source: AppDetailSource;
  /** DOMAIN.md를 편집기로 연다. 없으면 menu의 Open DOMAIN.md는 아무것도 하지 않는다. */
  onOpenDoc?: (domain: string) => void;
}) {
  const owner = { kind: "app" as const, id: app };
  const domains = useDomains(owner, () => source.domains(app), source);
  const [creating, setCreating] = useState(false);
  const { loaded, notice } = domains;
  const rows = loaded.state === "ready" ? loaded.domains : [];
  return (
    <section className={styles.section} aria-label={t("domain.heading.list")}>
      <div className={styles.head}>
        <h4 className={styles.label}>{t("domain.heading.list")}</h4>
        <Button
          size="sm"
          icon={commonIcons.add}
          onClick={() => setCreating(true)}
        >
          {t("domain.button.new")}
        </Button>
      </div>
      {notice === null ? null : (
        <DomainNotice
          notice={notice}
          onUndo={() => void domains.undo(notice.domain)}
          onClose={domains.closeNotice}
        />
      )}
      {loaded.state === "failed" ? (
        <p className={styles.failed}>{t("domain.error.load-failed")}</p>
      ) : null}
      <div>
        {rows.map((domain) => (
          <div key={domain.id} className={styles.row} data-domain={domain.name}>
            <span className={styles.text}>
              <span className={styles.title}>{domain.title}</span>
              <span className={styles.name}>{domain.name}</span>
            </span>
            <span className={styles.counts}>
              {t("domain.label.tool-counts", {
                tools: domain.tools,
                shared: domain.shared,
              })}
            </span>
            <span className={styles.action}>
              <DomainMenu
                title={domain.title}
                archiveBlocked={rows.length <= 1}
                onOpenDoc={() => onOpenDoc?.(domain.id)}
                onArchive={() => void domains.archive(domain)}
              />
            </span>
          </div>
        ))}
      </div>
      {creating ? (
        <CreateDomainDialog
          onCreate={domains.create}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </section>
  );
}
