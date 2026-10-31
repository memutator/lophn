// App details의 Domains 절. 이름 아래에 놓이고 줄마다 domain과 tool 수, 줄 끝 menu(Open DOMAIN.md, Archive)가 있다.
// Open DOMAIN.md는 그 줄 바로 아래를 파일 탭과 같은 markdown 편집기로 바꾼다. 다른 화면으로 옮겨 가지 않는다.
// 앱은 domain이 0개가 되지 못하므로 마지막 active domain 줄은 Archive가 꺼진다. core가 그래도 거절하면 그 이유를 목록 위에 보인다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import { actionIcons } from "../../icons/mod.ts";
import { InstructionsEditor } from "../../workspace/agents/editor/instructions-editor.tsx";
import type { InstructionsFile } from "../../workspace/agents/views.ts";
import { DomainMenu } from "../../workspace/domains/domain-menu.tsx";
import { DomainNotice } from "../../workspace/domains/domain-notice.tsx";
import { CreateDomainDialog } from "../../workspace/domains/create-domain-dialog.tsx";
import { useDomains } from "../../workspace/domains/use-domains.ts";
import type { AppDetailSource } from "./source.ts";
import styles from "./domains-section.module.css";

/** 연 DOMAIN.md 하나. 읽는 중이면 file이 null이다. */
interface OpenDoc {
  readonly domain: string;
  readonly file: InstructionsFile | null;
  readonly failed: boolean;
}

export function DomainsSection({
  app,
  source,
}: {
  app: string;
  source: AppDetailSource;
}) {
  const owner = { kind: "app" as const, id: app };
  const domains = useDomains(owner, () => source.domains(app), source);
  const [creating, setCreating] = useState(false);
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  const { loaded, notice } = domains;
  const rows = loaded.state === "ready" ? loaded.domains : [];

  const openDoc = async (domain: string) => {
    setDoc({ domain, file: null, failed: false });
    const read = await source.readDomainDoc(domain);
    setDoc((open) =>
      open?.domain === domain
        ? { domain, file: read.ok ? read.value : null, failed: !read.ok }
        : open,
    );
  };

  return (
    <section className={styles.section} aria-label={t("domain.heading.list")}>
      <div className={styles.head}>
        <h4 className={styles.label}>{t("domain.heading.list")}</h4>
        <Button
          size="sm"
          icon={actionIcons.add}
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
          <div
            key={domain.id}
            className={styles.item}
            data-domain={domain.name}
          >
            <div className={styles.row}>
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
                  onOpenDoc={() => void openDoc(domain.id)}
                  onArchive={() => void domains.archive(domain)}
                />
              </span>
            </div>
            {doc?.domain !== domain.id ? null : doc.failed ? (
              <p className={styles.failed}>{t("domain.error.doc-failed")}</p>
            ) : doc.file === null ? null : (
              <div className={styles.doc} data-domain-doc="">
                <InstructionsEditor
                  head={t("domain.label.doc", { name: domain.name })}
                  file={doc.file}
                  empty=""
                  port={{
                    read: async () => {
                      const read = await source.readDomainDoc(domain.id);
                      return read.ok ? read : { ok: false, message: read.code };
                    },
                    write: async (text, hash) => {
                      const written = await source.writeDomainDoc(
                        domain.id,
                        text,
                        hash,
                      );
                      return written.ok
                        ? written
                        : { ok: false, message: written.code };
                    },
                  }}
                  onClose={() => setDoc(null)}
                />
              </div>
            )}
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
