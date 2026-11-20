// App details의 Folders 절. 앱 source 밖에 이은 폴더 목록이다. 이 앱 workspace의 agent가 이 폴더들을 file tool로
// 읽고 쓴다. 줄 끝 단추가 폴더를 앱에서 빼고(디스크는 그대로), Add folder가 OS 선택기로 폴더를 더한다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import { actionIcons } from "../../icons/mod.ts";
import { useReadOnly } from "./read-only.ts";
import { useFolders } from "./reads.ts";
import type { AppDetailSource } from "./source.ts";
import styles from "./app-section.module.css";

export function FoldersSection({
  app,
  source,
}: {
  app: string;
  source: AppDetailSource;
}) {
  const readOnly = useReadOnly();
  const read = useFolders(app).loaded;
  const folders = read.state === "ready" ? read.value : null;
  // 더하기·빼기가 실패했다. 목록은 apps 변경으로 다시 읽는다.
  const [changeFailed, setChangeFailed] = useState(false);
  const failed = changeFailed || read.state === "failed";

  const add = async () => {
    setChangeFailed(!(await source.addFolder(app)).ok);
  };

  const remove = async (path: string) => {
    setChangeFailed(!(await source.removeFolder(app, path)).ok);
  };

  return (
    <section
      className={styles.section}
      aria-label={t("app-detail.heading.folders")}
      data-app-folders=""
    >
      <div className={styles.head}>
        <h4 className={styles.label}>{t("app-detail.heading.folders")}</h4>
        {readOnly ? null : (
          <Button size="sm" icon={actionIcons.add} onClick={() => void add()}>
            {t("app-detail.button.add-folder")}
          </Button>
        )}
      </div>
      {failed ? (
        <p className={styles.failed}>{t("app-detail.error.folders-failed")}</p>
      ) : null}
      {folders !== null && folders.length === 0 ? (
        <p className={styles.counts}>{t("app-detail.note.no-folders")}</p>
      ) : null}
      <div>
        {(folders ?? []).map((path) => (
          <div key={path} className={styles.item} data-app-folder={path}>
            <div className={styles.row}>
              <span className={styles.text}>
                <span className={styles.name}>{path}</span>
              </span>
              {readOnly ? null : (
                <span className={styles.action}>
                  <Button
                    size="sm"
                    icon={actionIcons.remove}
                    onClick={() => void remove(path)}
                  >
                    {t("app-detail.button.remove-folder")}
                  </Button>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
