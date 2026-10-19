// project sidebar의 Artifacts 쪽. 탭이 그려질 때 한 번 목록을 읽고, 폴더 변경은 따라가지 않는다(다시 보일 때 읽는다).
// domain이 둘 이상이면 domain 제목 아래 접을 수 있는 묶음이고, 하나뿐이면 묶음 없이 한 줄 목록이다.
import { useState } from "react";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import { artifactIcons, commonIcons } from "../../icons/mod.ts";
import {
  type DomainArtifactItem,
  useArtifactList,
} from "../../artifact/use-artifact-list.ts";
import type { DomainView } from "../source.ts";
import styles from "./artifact-panel.module.css";

function Rows(
  { items, onOpen }: {
    items: readonly DomainArtifactItem[];
    onOpen: (domain: string, name: string) => void;
  },
) {
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

export function ArtifactPanel(
  { domains, onOpen }: {
    domains: readonly DomainView[];
    onOpen: (domain: string, name: string) => void;
  },
) {
  const { items } = useArtifactList(domains.map((domain) => domain.id));
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  if (items.length === 0) {
    return <p className={styles.empty}>{t("artifact.empty.none")}</p>;
  }
  if (domains.length <= 1) return <Rows items={items} onOpen={onOpen} />;
  return (
    <>
      {domains.map((domain) => {
        const own = items.filter((item) => item.domain === domain.id);
        const isFolded = folded.has(domain.id);
        return (
          <section key={domain.id} className={styles.group}>
            <button
              type="button"
              className={styles.groupHead}
              data-domain={domain.name}
              aria-expanded={!isFolded}
              onClick={() => {
                const next = new Set(folded);
                if (!next.delete(domain.id)) next.add(domain.id);
                setFolded(next);
              }}
            >
              <Icon
                icon={isFolded ? commonIcons.expand : commonIcons.collapse}
                pixels={iconPixels("small")}
              />
              <span className={styles.groupTitle}>{domain.title}</span>
              <span className={styles.groupCount}>{own.length}</span>
            </button>
            {isFolded
              ? null
              : own.length === 0
              ? <p className={styles.empty}>{t("artifact.empty.none")}</p>
              : <Rows items={own} onOpen={onOpen} />}
          </section>
        );
      })}
    </>
  );
}
