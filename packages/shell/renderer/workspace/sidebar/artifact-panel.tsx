// project sidebar의 Artifacts 쪽. 탭이 그려질 때 한 번 목록을 읽고, 폴더 변경은 따라가지 않는다(다시 보일 때 읽는다).
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import { artifactIcons } from "../../icons/mod.ts";
import { useArtifactList } from "../../artifact/use-artifact-list.ts";
import styles from "./artifact-panel.module.css";

export function ArtifactPanel(
  { domains, onOpen }: {
    domains: readonly string[];
    onOpen: (domain: string, name: string) => void;
  },
) {
  const { items } = useArtifactList(domains);
  if (items.length === 0) {
    return <p className={styles.empty}>{t("artifact.empty.none")}</p>;
  }
  return (
    <ul className={styles.rows} aria-label={t("artifact.label.list")}>
      {items.map((item) => (
        <li key={`${item.domain}/${item.name}`}>
          <button
            type="button"
            className={styles.row}
            data-artifact={item.name}
            onClick={() => onOpen(item.domain, item.name)}
          >
            <span className={styles.icon}>
              <Icon icon={artifactIcons.kind} pixels={iconPixels("base")} />
            </span>
            <span className={styles.text}>
              <span className={styles.head}>
                <span className={styles.title}>{item.title}</span>
                <span className={styles.name}>{item.name}</span>
              </span>
              <span className={styles.desc}>{item.description}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
