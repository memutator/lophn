// project 화면의 Terminal 탭 본문.
import { IconButton, Menu } from "@lophn/design/components";
import { editorIcons } from "../../../../packages/shell/renderer/icons/mod.ts";

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
            { id: "clear", label: "Clear" },
            { id: "rename", label: "Rename" },
            { id: "split", label: "Split" },
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
