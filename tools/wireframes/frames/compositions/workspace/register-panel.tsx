// 프로젝트 등록 dialog. 이름, 목적, 폴더와 폴더 설명이다. 짧은 이름 고르기는 없다.
// 눌러 여는 창이 아니라 window 위에 올려 두는 look-alike다. 런처와 Projects 목록의 + 단추가 같이 쓴다.
import {
  Button,
  Field,
  IconButton,
  Input,
  Textarea,
  Tooltip,
} from "@lophn/design/components";
import {
  launcherIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import dialog from "../../../../../packages/shell/renderer/desktop/launcher/register-dialog.module.css";
import styles from "./workspace.module.css";

export function RegisterPanel({ onClose }: { onClose?: () => void } = {}) {
  return (
    <div className={styles.dialogLayer}>
      <div
        className={styles.panel}
        role="dialog"
        aria-label="Register project"
      >
        <h2 className={styles.panelTitle}>Register project</h2>
        <div className={dialog.form}>
          <p className={dialog.note}>
            A project is a name, a purpose and the folders it works in.
          </p>
          <Field label="Name">
            <Input defaultValue="trip-planner" />
          </Field>
          <Field
            label="Purpose"
            help="What the project is for. Agents read this."
          >
            <Textarea
              rows={3}
              defaultValue="Plan the autumn trip and keep the bookings in one place."
            />
          </Field>
          <section className={dialog.folders}>
            <div className={dialog.foldersHead}>
              <span className={dialog.foldersLabel}>Folders</span>
              <Tooltip content="Add folder">
                <IconButton
                  icon={launcherIcons.addFolder}
                  label="Add folder"
                  size="sm"
                />
              </Tooltip>
            </div>
            <ul className={dialog.folderList}>
              <li className={dialog.folder}>
                <div className={dialog.folderHead}>
                  <span className={dialog.path}>/home/mina/trips/autumn</span>
                  <IconButton
                    icon={launcherIcons.remove}
                    label="Remove folder"
                    size="sm"
                  />
                </div>
                <Field label="Folder description">
                  <Input size="sm" defaultValue="Bookings and itineraries" />
                </Field>
              </li>
            </ul>
          </section>
        </div>
        <div className={styles.panelActions}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onClose}>Register</Button>
        </div>
      </div>
    </div>
  );
}
