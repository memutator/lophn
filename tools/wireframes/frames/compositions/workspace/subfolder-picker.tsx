// 하위 폴더 고르기 dialog. 폴더 고르기는 그 등록 폴더 안으로만 열려서 등록 폴더가 트리의 맨 위다.
// 눌러 여는 창이 아니라 한 화면에 올려 두는 정적 look-alike다.
import {
  Button,
  Field,
  Icon,
  iconPixels,
  Input,
} from "@lophn/design/components";
import {
  launcherIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import dialog from "../../../../../packages/shell/renderer/desktop/launcher/register-dialog.module.css";
import styles from "./workspace.module.css";

interface Entry {
  readonly name: string;
  readonly added?: boolean;
  readonly selected?: boolean;
  readonly children?: readonly Entry[];
}

const TREE: readonly Entry[] = [
  { name: "docs/", added: true },
  { name: "eval/", added: true },
  { name: "scripts/" },
  {
    name: "src/",
    children: [
      { name: "harness/", added: true },
      { name: "tools/", selected: true },
    ],
  },
  { name: "tests/" },
];

function Rows({ entries }: { entries: readonly Entry[] }) {
  return (
    <>
      {entries.map((entry) => (
        <li key={entry.name}>
          <div
            className={styles.pickRow}
            role="treeitem"
            aria-selected={entry.selected === true}
            aria-disabled={entry.added === true}
          >
            <Icon
              icon={entry.children === undefined
                ? launcherIcons.project
                : launcherIcons.collapse}
              pixels={iconPixels("base")}
            />
            <span>{entry.name}</span>
            {entry.added === true
              ? <span className={styles.caption}>Added</span>
              : null}
          </div>
          {entry.children === undefined ? null : (
            <ul role="group">
              <Rows entries={entry.children} />
            </ul>
          )}
        </li>
      ))}
    </>
  );
}

export function SubfolderPicker() {
  return (
    <div className={styles.dialogLayer}>
      <div className={styles.panel} role="dialog" aria-label="Add subfolder">
        <h2 className={styles.panelTitle}>Add subfolder</h2>
        <div className={dialog.form}>
          <p className={dialog.note}>
            Pick a folder inside the registered folder and describe it. You
            can't go above it.
          </p>
          <ul className={styles.pickTree} role="tree">
            <li>
              <div className={`${styles.pickRow} ${styles.pickRoot}`}>
                <Icon
                  icon={launcherIcons.project}
                  pixels={iconPixels("base")}
                />
                <span className={styles.mono}>/home/mina/work/phroner</span>
              </div>
              <ul role="group">
                <Rows entries={TREE} />
              </ul>
            </li>
          </ul>
          <Field label="Subfolder description">
            <Input defaultValue="Small command-line helpers" />
          </Field>
        </div>
        <div className={styles.panelActions}>
          <Button>Cancel</Button>
          <Button variant="primary">Add subfolder</Button>
        </div>
      </div>
    </div>
  );
}
