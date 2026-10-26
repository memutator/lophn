import { List, ListItem } from "@lophn/ui/data";
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
