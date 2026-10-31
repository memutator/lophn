// project sidebar의 Domains 탭. 머리 줄의 [New domain], 줄마다 이름과 한 줄 목적, 줄 끝 menu(Open DOMAIN.md, Archive).
// 목록은 이 탭이 읽고, 만들기·보관 뒤에 다시 읽는다. 마지막 domain 규칙은 앱에만 있어 project는 0개가 될 수 있다.
import { useState } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { ErrorState } from "@lophn/ui/feedback";
import { Tooltip } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { commonIcons, shellIcons } from "../../icons/mod.ts";
import {
  PanelEmpty,
  PanelRow,
  PanelRows,
  TileIcon,
} from "../../shell/panel-rows.tsx";
import { PanelActions } from "../../shell/right-sidebar.tsx";
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
      <PanelActions>
        <Tooltip content={t("domain.button.new")}>
          <IconButton
            size="sm"
            icon={commonIcons.add}
            label={t("domain.button.new")}
            onClick={() => setCreating(true)}
          />
        </Tooltip>
      </PanelActions>
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
        <PanelEmpty>{t("domain.empty.project")}</PanelEmpty>
      ) : null}
      {loaded.state === "ready" && loaded.domains.length > 0 ? (
        <PanelRows label={t("domain.heading.list")}>
          {loaded.domains.map((domain) => (
            <PanelRow
              key={domain.id}
              data-domain={domain.name}
              leading={<TileIcon icon={shellIcons.domain} />}
              title={domain.title}
              tag={domain.name}
              meta={domain.purpose}
              hoverTrailing
              trailing={
                <DomainMenu
                  title={domain.title}
                  onOpenDoc={() => onOpenDoc(domain.id)}
                  onArchive={() => void domains.archive(domain)}
                />
              }
            />
          ))}
        </PanelRows>
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
