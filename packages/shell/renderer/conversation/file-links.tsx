// 답 아래의 결과. 파일은 경로로 열고, context는 그 context의 탭을 연다. 4개 이상이면 첫 3개와 남은 개수만 보인다.
import { type ReactElement, useState } from "react";
import { Icon, iconPixels } from "@lophn/design/components";
import { conversationIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "./file-links.module.css";

/** 답이 만들거나 바꾼 것. 파일은 프로젝트 안 경로다. */
export type ResultItem =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "context"; readonly context: string };

/** 대화 속 context 이름 링크가 작업대와 나누는 것. */
export interface ContextLinks {
  open(context: string): void;
  /** 알려진 context의 이름. 모르면 undefined다. */
  titleOf(context: string): string | undefined;
}

export interface FileLinksProps {
  links: readonly ResultItem[];
  /** 파일 경로의 탭을 연다. 없으면 링크를 누를 수 없다. */
  onOpenFile?: ((path: string) => void) | undefined;
  /** context 링크가 그 context의 탭을 여는 길과 이름. 없으면 링크를 누를 수 없다. */
  contexts?: ContextLinks | undefined;
}

const FOLD_AT = 4;
const SHOWN = 3;

function keyOf(link: ResultItem): string {
  return link.kind === "file" ? `file:${link.path}` : `ctx:${link.context}`;
}

export function FileLinks(
  { links, onOpenFile, contexts }: FileLinksProps,
): ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  if (links.length === 0) return null;
  const folded = !expanded && links.length >= FOLD_AT;
  const shown = folded ? links.slice(0, SHOWN) : links;
  const hidden = links.length - shown.length;
  return (
    <div className={styles.results} data-results={links.length}>
      <span className={styles.heading}>{t("conversation.label.results")}</span>
      <ul className={styles.list}>
        {shown.map((link) => (
          <li key={keyOf(link)}>
            {link.kind === "context"
              ? (
                <button
                  type="button"
                  className={styles.link}
                  data-result-context={link.context}
                  disabled={contexts === undefined}
                  onClick={() => contexts?.open(link.context)}
                >
                  <Icon
                    icon={conversationIcons.result}
                    pixels={iconPixels("base")}
                  />
                  <span className={styles.title}>
                    {contexts?.titleOf(link.context) ??
                      t("contexts.label.frame-chip")}
                  </span>
                </button>
              )
              : (
                <button
                  type="button"
                  className={styles.link}
                  data-result-file={link.path}
                  disabled={onOpenFile === undefined}
                  onClick={() => onOpenFile?.(link.path)}
                >
                  <Icon
                    icon={conversationIcons.result}
                    pixels={iconPixels("base")}
                  />
                  <span className={styles.title}>{link.path}</span>
                </button>
              )}
          </li>
        ))}
      </ul>
      {hidden > 0
        ? (
          <button
            type="button"
            className={styles.more}
            data-more-results={hidden}
            aria-label={t("conversation.button.show-all-results")}
            onClick={() => setExpanded(true)}
          >
            {t("conversation.label.more-results", { count: hidden })}
          </button>
        )
        : null}
    </div>
  );
}
