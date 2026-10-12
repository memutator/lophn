import { useId, useState } from "react";
import {
  Icon,
  IconButton,
  iconPixels,
  Tooltip,
} from "@lophn/design/components";
import { launcherIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import { WaitingPill } from "../notification-chip/space-decisions.tsx";
import { cardStatus } from "./model.ts";
import type { ProjectCard as Card } from "./source.ts";
import styles from "./launcher.module.css";

export interface ProjectCardProps {
  card: Card;
  /** 이 프로젝트에서 사람의 결정을 기다리는 approval 수. */
  waiting: number;
  onOpen: (id: string) => void;
}

const STATUS_KEYS = {
  "tracking": "launcher.label.status-tracking",
  "not-tracking": "launcher.label.status-not-tracking",
  "no-folder": "launcher.label.status-no-folder",
} as const;

// 이전 lophn 런처 카드: 폴더 아이콘·이름·대기 pill 한 줄, 목적 두 줄, 상태 한 줄. 카드 전체가
// 작업대로 가는 단추다. 안쪽 짧은 이름·ID·경로·규칙·문서 수는 펼친 상세에만 둔다
// (documents/projects#R8, shell/wording#R4, R12).
export function ProjectCard({ card, waiting, onOpen }: ProjectCardProps) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const status = cardStatus(card);
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
          <WaitingPill count={waiting} />
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
      <p className={styles.cardStatus} data-status={status}>
        {t(STATUS_KEYS[status])}
      </p>
      {open
        ? (
          <div className={styles.details} id={detailsId} data-details="">
            <dl className={styles.detailGrid}>
              <dt>{t("launcher.label.detail-name")}</dt>
              <dd className={styles.mono}>{card.name}</dd>
              <dt>{t("launcher.label.detail-id")}</dt>
              <dd className={styles.mono}>{card.id}</dd>
              <dt>{t("launcher.label.folders")}</dt>
              <dd>
                {card.folders.length === 0
                  ? t("launcher.label.detail-no-folders")
                  : (
                    <ul className={styles.detailList}>
                      {card.folders.map((folder) => (
                        <li key={folder.path} className={styles.mono}>
                          {folder.path}
                        </li>
                      ))}
                    </ul>
                  )}
              </dd>
              {card.tracking.enabled
                ? (
                  <>
                    <dt>{t("launcher.label.status-tracking")}</dt>
                    <dd>
                      <ul className={styles.detailList}>
                        {card.tracking.patterns.map((rule, index) => (
                          <li key={index}>
                            {t(
                              rule.effect === "include"
                                ? "launcher.label.rule-include"
                                : "launcher.label.rule-exclude",
                              { glob: rule.glob },
                            )}
                          </li>
                        ))}
                        {card.tracking.useGitignore
                          ? <li>{t("launcher.label.detail-gitignore")}</li>
                          : null}
                      </ul>
                    </dd>
                  </>
                )
                : null}
            </dl>
            <p className={styles.detailNote}>
              {t("launcher.label.detail-documents", {
                count: card.documentCount,
              })}
            </p>
          </div>
        )
        : null}
    </article>
  );
}
