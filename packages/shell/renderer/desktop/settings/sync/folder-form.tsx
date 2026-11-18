// 폴더 하나를 고치는 form. 이름 붙인 폴더는 이름과 path, 같이 보는 폴더는 path만이다. 저장 전에 평문 경고를 보이고, core가
// 거절하면(겹침, data root 안, 예약된 이름) 그 글을 form 안에 보인다.
import { t } from "@lophn/i18n";
import { Field, Input } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import { useState } from "react";

import { actionIcons, homeIcons } from "../../../icons/mod.ts";
import styles from "../settings.module.css";
import type { SaveOutcome, SyncSettingsSource } from "./source.ts";
import syncStyles from "./sync.module.css";

interface FolderFormProps {
  source: SyncSettingsSource;
  /** 이름 붙인 폴더면 그 이름(새로 더하면 ""), 같이 보는 폴더면 null이다. */
  name: string | null;
  path: string;
  /** 저장했다. */
  onSaved: () => void;
  onCancel: () => void;
  /** 이름 붙인 폴더를 저장하는 일. `was`는 고치는 폴더의 옛 이름이다. */
  save: (name: string, path: string) => Promise<SaveOutcome>;
}

export function FolderForm({
  source,
  name: initialName,
  path: initialPath,
  onSaved,
  onCancel,
  save,
}: FolderFormProps) {
  const [name, setName] = useState(initialName ?? "");
  const [path, setPath] = useState(initialPath);
  const [problem, setProblem] = useState<string | null>(null);

  async function choose(): Promise<void> {
    const picked = await source.pickFolder();
    if (picked.ok && picked.value !== null) setPath(picked.value);
  }

  async function submit(): Promise<void> {
    const saved = await save(name.trim(), path.trim());
    if (saved.ok) onSaved();
    else setProblem(saved.message ?? t("settings.error.value-not-saved"));
  }

  const named = initialName !== null;
  return (
    <li className={styles.line} data-sync-form="">
      <div className={styles.lineMain}>
        {named ? (
          <Field label={t("settings-sync.label.folder-name")}>
            <Input
              value={name}
              maxLength={32}
              autoFocus
              data-sync-name=""
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        ) : null}
        <Field label={t("settings-sync.label.folder-path")}>
          <div className={syncStyles.pathRow}>
            <Input
              data-sync-path=""
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
            <Button
              icon={homeIcons.chooseFolder}
              data-sync-choose=""
              onClick={() => void choose()}
            >
              {t("settings-sync.button.choose")}
            </Button>
          </div>
        </Field>
        <p className={syncStyles.warning} data-sync-warning="">
          {t("settings-sync.warning.plain")}
        </p>
        {problem === null ? null : (
          <p className={styles.rejected} role="alert" data-sync-problem="">
            {problem}
          </p>
        )}
      </div>
      <div className={styles.lineControl}>
        <div className={styles.actions}>
          <Button onClick={onCancel}>{t("settings.button.cancel")}</Button>
          <Button
            variant="primary"
            icon={actionIcons.save}
            disabled={path.trim() === "" || (named && name.trim() === "")}
            data-sync-save=""
            onClick={() => void submit()}
          >
            {t("settings.button.save")}
          </Button>
        </div>
      </div>
    </li>
  );
}
