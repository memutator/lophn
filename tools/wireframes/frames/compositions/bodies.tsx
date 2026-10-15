// project 화면의 Terminal 탭 본문.
import { IconButton, Menu } from "@lophn/design/components";
import { Eraser } from "lucide-react";
import {
  editorIcons,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";
import { menuIcon } from "./project-files/menu-icons.tsx";

import { ViewBar } from "./documents.tsx";
import styles from "./compose.module.css";

const PROMPT = "mina@lophn:~/work/phroner$ ";

/** 새 터미널 탭. PTY 없이 고정된 출력만 보인다. */
export function TerminalBody() {
  return (
    <div className={styles.docTab}>
      <ViewBar path="">
        <Menu
          trigger={
            <IconButton icon={editorIcons.menu} label="More" size="sm" />
          }
          items={[
            { id: "clear", label: "Clear", leading: menuIcon(Eraser) },
            {
              id: "rename",
              label: "Rename",
              leading: menuIcon(editorIcons.edit),
            },
            {
              id: "split",
              label: "Split",
              leading: menuIcon(workspaceIcons.splitPane),
            },
          ]}
          onSelect={() => {}}
        />
      </ViewBar>
      <pre className={styles.terminal}>
        {`${PROMPT}ls\ndocs  eval  loop\n${PROMPT}git status --short\n M eval/experiments/exp-008-query-tools.md\n${PROMPT}`}
      </pre>
    </div>
  );
}
