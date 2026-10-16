import {
  Icon,
  IconButton,
  iconPixels,
  List,
  ListItem,
  Tooltip,
} from "@lophn/design/components";
import { workspaceIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import type { TerminalFolderChoice } from "../../ipc/terminal.ts";
import { folderTitle } from "./model.ts";
import styles from "./terminal.module.css";

interface FolderChoiceProps {
  folders: readonly TerminalFolderChoice[];
  onChoose: (folderRef: string) => void;
}

// 등록 폴더가 여럿이면 고르기 전에는 시작하지 않는다. 정확한 경로를
// 숨기지 않는다.
export function FolderChoice({ folders, onChoose }: FolderChoiceProps) {
  return (
    <section className={styles.choice} data-folder-choice="">
      <h2 className={styles.choiceHeading}>
        {t("terminal.heading.choose-folder")}
      </h2>
      <div aria-label={t("terminal.label.folders")} role="group">
        <List>
          {folders.map((folder) => (
            <ListItem
              key={folder.folder_ref}
              title={folderTitle(folder.path) ?? folder.path}
              meta={<span className={styles.path}>{folder.path}</span>}
              onSelect={() => onChoose(folder.folder_ref)}
            />
          ))}
        </List>
      </div>
    </section>
  );
}

interface StartNoticeProps {
  /** 주면 오른쪽에 숨기기 버튼을 둔다. */
  onHide?: () => void;
}

// 첫 열기 안내. OS 사용자 권한과 시작 위치를 서로 다른 문장으로 보인다. 프로젝트
// 폴더 밖 접근을 lophn이 막는다고 말하지 않는다.
export function StartNotice({ onHide }: StartNoticeProps) {
  const hideLabel = t("terminal.button.hide-notice");
  return (
    <aside className={styles.notice} data-start-notice="">
      <ul className={styles.noticeList}>
        <li className={styles.noticeItem} data-notice="account">
          <Icon
            icon={workspaceIcons.terminal}
            pixels={iconPixels("small")}
            className={styles.noticeIcon}
          />
          <span>{t("terminal.notice.account")}</span>
        </li>
        <li className={styles.noticeItem} data-notice="folder">
          <Icon
            icon={workspaceIcons.folder}
            pixels={iconPixels("small")}
            className={styles.noticeIcon}
          />
          <span>{t("terminal.notice.folder")}</span>
        </li>
      </ul>
      {onHide
        ? (
          <Tooltip content={hideLabel}>
            <IconButton
              icon={workspaceIcons.close}
              label={hideLabel}
              size="sm"
              data-hide-notice=""
              onClick={onHide}
            />
          </Tooltip>
        )
        : null}
    </aside>
  );
}
