import { Button, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";
import { appSpaceIcons, commonIcons, launcherIcons } from "../../icons/mod.ts";

import styles from "./launcher.module.css";

/** 보관한 project 또는 앱 한 줄. */
export interface ArchivedItem {
  readonly kind: "project" | "app";
  readonly id: string;
  readonly name: string;
}

interface ArchivedSectionProps {
  items: readonly ArchivedItem[];
  onRestore: (item: ArchivedItem) => void;
}

// 카드 묶음 아래 접힌 Archived 묶음. 보관한 project와 앱을 한 줄씩 보이고 [Unarchive]로 되살린다.
export function ArchivedSection({ items, onRestore }: ArchivedSectionProps) {
  if (items.length === 0) return null;
  return (
    <details className={styles.archived} data-section="archived">
      <summary className={styles.archivedSummary}>
        {t("launcher.heading.archived")}
        <span className={styles.count}>{items.length}</span>
      </summary>
      <p className={styles.archivedNote}>{t("launcher.note.archived")}</p>
      <ul className={styles.archivedList}>
        {items.map((item) => (
          <li
            key={`${item.kind}:${item.id}`}
            className={styles.archivedRow}
            data-archived={item.kind}
            data-archived-id={item.id}
          >
            <span className={styles.archivedName}>
              <Icon
                icon={item.kind === "project"
                  ? launcherIcons.project
                  : appSpaceIcons.app}
                pixels={iconPixels("base")}
                className={styles.cardIcon}
              />
              {item.name}
            </span>
            <Button
              size="sm"
              icon={commonIcons.unarchive}
              data-action="unarchive"
              onClick={() => onRestore(item)}
            >
              {t("launcher.button.unarchive")}
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
