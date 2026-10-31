// App details의 Icon 절. 지금 앱 표식과 올리기·지우기다. 올린 icon이 앱이 선언한 icon보다 앞서고,
// 지우면 선언한 icon, 그것도 없으면 첫 글자 표식으로 돌아간다.
import { t } from "@lophn/i18n";
import { useCallback, useEffect, useState } from "react";

import type { IconView } from "../../parts/icon-upload/icon-reader.ts";
import { IconUpload } from "../../parts/icon-upload/icon-upload.tsx";
import { PlaceMark } from "../../parts/place-mark/place-mark.tsx";
import { useAppViews } from "../app-views.tsx";
import type { AppDetailSource } from "./source.ts";
import styles from "./domains-section.module.css";

export function IconSection({
  app,
  name,
  source,
}: {
  app: string;
  name: string;
  source: AppDetailSource;
}) {
  const appIcons = useAppViews()?.icon;
  const [view, setView] = useState<IconView | null>(null);

  const load = useCallback(async () => {
    const read = await source.icon(app);
    if (read.ok) setView(read.value);
  }, [app, source]);

  useEffect(() => {
    void load();
  }, [load]);

  // 탭 줄·앱 목록의 표식도 바로 다시 읽게 한다.
  const changed = async (done: Promise<{ ok: boolean }>) => {
    const result = await done;
    if (!result.ok) return false;
    appIcons?.forget?.(app);
    await load();
    return true;
  };

  return (
    <section
      className={styles.section}
      aria-label={t("app-detail.heading.icon")}
      data-app-icon=""
    >
      <div className={styles.head}>
        <h4 className={styles.label}>{t("app-detail.heading.icon")}</h4>
      </div>
      <IconUpload
        preview={
          <PlaceMark
            kind="app"
            id={app}
            name={name}
            {...(view?.src ? { icon: view.src } : {})}
          />
        }
        onUpload={(bytes, type) =>
          changed(source.setIcon(app, { type, bytes }))
        }
        {...(view?.uploaded
          ? { onRemove: () => changed(source.setIcon(app, null)) }
          : {})}
      />
    </section>
  );
}
