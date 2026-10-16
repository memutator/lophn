import { useId, useState } from "react";
import {
  Icon,
  IconButton,
  iconPixels,
  StatusMark,
  Tooltip,
} from "@lophn/design/components";
import { launcherIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import { folderMissing } from "./model.ts";
import type { ProjectCard as Card } from "./source.ts";
import styles from "./launcher.module.css";

interface ProjectCardProps {
  card: Card;
  onOpen: (id: string) => void;
}

// 카드: 폴더 아이콘·이름 한 줄, 목적 두 줄, 폴더 수나 "Folder not found" 한 줄. 카드 전체가 작업대로 가는
// 단추다. 폴더 경로는 펼친 상세에만 둔다.
export function ProjectCard({ card, onOpen }: ProjectCardProps) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const toggle = t(
    open ? "launcher.button.hide-details" : "launcher.button.show-details",
  );
  return (
    <article
      className={styles.card}
      data-card="project"
      data-project={card.id}
    >
      <div className={styles.cardHead}>
        <button
          type="button"
          className={styles.cardOpen}
          onClick={() => onOpen(card.id)}
        >
          <Icon
            icon={launcherIcons.project}
            pixels={iconPixels("base")}
            className={styles.cardIcon}
          />
          <span className={styles.cardTitle}>{card.title}</span>
        </button>
        <span className={styles.cardAside}>
          <Tooltip content={toggle}>
            <IconButton
              icon={open ? launcherIcons.collapse : launcherIcons.expand}
              label={toggle}
              size="sm"
              aria-expanded={open}
              aria-controls={detailsId}
              data-details-toggle=""
              onClick={() => setOpen(!open)}
            />
          </Tooltip>
        </span>
      </div>
      {card.purpose.trim() === ""
        ? null
        : <p className={styles.cardPurpose}>{card.purpose}</p>}
      {folderMissing(card)
        ? (
          <div className={styles.cardStatus} data-status="missing">
            <StatusMark
              tone="warning"
              label={t("launcher.label.folder-missing")}
            />
          </div>
        )
        : (
          <p className={styles.cardStatus} data-status="ok">
            {t("launcher.label.folder-count", { count: card.folders.length })}
          </p>
        )}
      {open
        ? (
          <div className={styles.details} id={detailsId} data-details="">
            <ul className={styles.detailList}>
              {card.folders.map((folder) => (
                <li key={folder.path} className={styles.mono}>
                  {folder.path}
                </li>
              ))}
            </ul>
          </div>
        )
        : null}
    </article>
  );
}
