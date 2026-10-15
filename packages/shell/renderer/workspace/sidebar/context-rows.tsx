// sidebar Context 모양의 본문 자리. screens-contexts의 `ContextSidebar`가 오기 전까지 이 project의 context를
// 한 줄씩 보인다. 이 모양을 열 때(마운트) 한 번 읽고 polling하지 않는다.
import { useEffect, useRef, useState } from "react";
import { Icon, iconPixels } from "@lophn/design/components";
import { workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type { ContextListItem, ContextsSource } from "../contexts/source.ts";
import styles from "./project-sidebar.module.css";

export interface ContextRowsProps {
  source: ContextsSource;
  project: string;
  /** 읽은 목록을 작업대에 알린다(탭 이름, 새 탭 menu가 같이 쓴다). */
  onLoaded?: (list: readonly ContextListItem[]) => void;
  onOpen: (context: ContextListItem) => void;
}

export function ContextRows(
  { source, project, onLoaded, onOpen }: ContextRowsProps,
) {
  const [list, setList] = useState<readonly ContextListItem[]>([]);
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  useEffect(() => {
    let live = true;
    void source.list(project).then((read) => {
      if (!live || !read.ok) return;
      setList(read.value);
      loaded.current?.(read.value);
    });
    return () => {
      live = false;
    };
  }, [source, project]);
  return (
    <section className={styles.section} data-contexts="">
      <h2 className={styles.sectionLabel}>
        {t("project-workspace.label.rail-contexts")}
      </h2>
      {list.length === 0
        ? <p className={styles.empty}>{t("contexts.empty.tab-none")}</p>
        : (
          <ul className={styles.list} role="list">
            {list.map((item) => (
              <li key={item.id} className={styles.li}>
                <button
                  type="button"
                  className={styles.item}
                  data-context={item.id}
                  onClick={() => onOpen(item)}
                >
                  <Icon
                    icon={workspaceIcons.context}
                    pixels={iconPixels("base")}
                  />
                  <span className={styles.label}>{item.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
