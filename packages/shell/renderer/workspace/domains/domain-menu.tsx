// 줄 끝 menu. Open DOMAIN.md와 Archive. archiveBlocked면 Archive가 꺼지고 이유를 tooltip으로 보인다(앱의 마지막 domain).
import type { ReactElement } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon, type MenuItem, Tooltip } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { commonIcons, editorIcons, workspaceIcons } from "../../icons/mod.ts";

export function DomainMenu({
  title,
  archiveBlocked = false,
  onOpenDoc,
  onArchive,
}: {
  title: string;
  archiveBlocked?: boolean;
  onOpenDoc: () => void;
  onArchive: () => void;
}) {
  const archive = t("domain.button.archive");
  const items: MenuItem[] = [
    {
      id: "doc",
      leading: <MenuIcon icon={workspaceIcons.document} />,
      label: t("domain.button.open-doc"),
    },
    {
      id: "archive",
      leading: <MenuIcon icon={commonIcons.archive} />,
      label: archiveBlocked ? (
        <Tooltip content={t("domain.notice.app-last")} placement="beside">
          <span>{archive}</span>
        </Tooltip>
      ) : (
        archive
      ),
      textValue: archive,
      disabled: archiveBlocked,
    },
  ];
  const trigger: ReactElement = (
    <IconButton
      icon={editorIcons.menu}
      label={t("domain.label.row-menu", { title })}
      size="sm"
    />
  );
  return (
    <Menu
      trigger={trigger}
      items={items}
      onSelect={(id) => (id === "doc" ? onOpenDoc() : onArchive())}
    />
  );
}
