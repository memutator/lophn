import { useEffect, useState } from "react";
import { conversationIcons, Icon, iconPixels } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { foldResults } from "./model.ts";
import type { ConversationSource, ResultLink } from "./source.ts";
import styles from "./result-links.module.css";

export interface ResultLinksProps {
  links: readonly ResultLink[];
  source: Pick<ConversationSource, "documentTitle">;
  onOpen?: (document: string, version: string | null) => void;
  /** context 링크가 그 context의 탭을 여는 길과 이름. 없으면 링크를 누를 수 없다. */
  contexts?: ContextLinks;
}

/** 대화 속 context 이름 링크가 작업대와 나누는 것(shell/workspace#R31). */
export interface ContextLinks {
  open(context: string): void;
  /** 알려진 context의 이름. 모르면 undefined다. */
  titleOf(context: string): string | undefined;
}

function linkKey(link: ResultLink): string {
  if (link.kind === "context") return link.context;
  return link.kind === "version"
    ? `${link.document}@${link.version}`
    : link.document;
}

// 답 아래의 결과. 4개 이상이면 첫 3개·남은 개수·나머지 보기로 접는다(shell/desktop#R3).
export function ResultLinks(
  { links, source, onOpen, contexts }: ResultLinksProps,
) {
  const [expanded, setExpanded] = useState(false);
  const [titles, setTitles] = useState<Readonly<Record<string, string>>>({});
  const { shown, hidden } = foldResults(links, expanded);
  const documents = [
    ...new Set(
      shown.flatMap((link) => link.kind === "context" ? [] : [link.document]),
    ),
  ].join(" ");

  useEffect(() => {
    let live = true;
    for (const document of documents.split(" ").filter(Boolean)) {
      void source.documentTitle(document).then((title) => {
        if (!live || !title.ok) return;
        setTitles((current) => ({ ...current, [document]: title.value }));
      });
    }
    return () => {
      live = false;
    };
  }, [documents, source]);

  if (links.length === 0) return null;
  return (
    <div className={styles.results} data-results={links.length}>
      <span className={styles.heading}>{t("conversation.label.results")}</span>
      <ul className={styles.list}>
        {shown.map((link) => (
          <li
            key={link.kind === "context"
              ? `ctx:${linkKey(link)}`
              : linkKey(link)}
          >
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
                  data-result={linkKey(link)}
                  disabled={onOpen === undefined}
                  onClick={() =>
                    onOpen?.(
                      link.document,
                      link.kind === "version" ? link.version : null,
                    )}
                >
                  <Icon
                    icon={conversationIcons.result}
                    pixels={iconPixels("base")}
                  />
                  <span className={styles.title}>
                    {titles[link.document] ?? t("conversation.label.document")}
                  </span>
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
