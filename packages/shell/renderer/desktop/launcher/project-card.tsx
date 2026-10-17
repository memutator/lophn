import { Icon } from "@lophn/ui/primitives";
import { Button } from "@lophn/ui/primitives";
import { StatusMark } from "@lophn/ui/feedback";
import { iconPixels } from "@lophn/ui/shared";
import { commonIcons, launcherIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import { CardMenu } from "./card-menu.tsx";
import { missingFolder } from "./model.ts";
import type { ProjectItem } from "./projects/source.ts";
import styles from "./launcher.module.css";

interface ProjectCardProps {
  card: ProjectItem;
  onOpen: (id: string) => void;
  onDetails: (card: ProjectItem) => void;
  onArchive: (card: ProjectItem) => void;
  /** 사라진 폴더의 새 위치를 OS 선택기로 고른다. */
  onRelocate: (card: ProjectItem, folder: string) => void;
}

// 카드: 폴더 아이콘·이름 한 줄과 ⋯ 메뉴, 목적 두 줄, 폴더 수나 "Folder not found"와 새 위치 고르기 한 줄.
// 카드 전체가 작업대로 가는 단추다. 폴더 경로와 편집은 [Details] dialog에 둔다.
export function ProjectCard(
  { card, onOpen, onDetails, onArchive, onRelocate }: ProjectCardProps,
) {
  const missing = missingFolder(card);
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
          <CardMenu
            name={card.title}
            items={[
              {
                id: "details",
                label: t("launcher.button.details"),
                icon: launcherIcons.details,
              },
              {
                id: "archive",
                label: t("launcher.button.archive"),
                icon: commonIcons.archive,
              },
            ]}
            onSelect={(id) =>
              id === "details" ? onDetails(card) : onArchive(card)}
          />
        </span>
      </div>
      {card.purpose.trim() === ""
        ? null
        : <p className={styles.cardPurpose}>{card.purpose}</p>}
      {missing !== undefined
        ? (
          <div className={styles.cardMissing} data-status="missing">
            <StatusMark
              tone="warning"
              label={t("launcher.label.folder-missing")}
            />
            <Button
              size="sm"
              data-relocate=""
              onClick={() => onRelocate(card, missing.path)}
            >
              {t("launcher.button.choose-location")}
            </Button>
          </div>
        )
        : (
          <p className={styles.cardStatus} data-status="ok">
            {t("launcher.label.folder-count", { count: card.folders.length })}
          </p>
        )}
    </article>
  );
}
