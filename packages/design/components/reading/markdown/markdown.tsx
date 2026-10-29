import { Fragment, type MouseEvent, type ReactNode, useMemo } from "react";
import { Square, SquareCheck } from "lucide-react";
import { Icon } from "../../primitives/icon/icon.tsx";
import {
  type Clipboard,
  iconPixels,
  systemClipboard,
} from "../../_shared/shared.ts";
import { CodeBlock } from "../code-block/code-block.tsx";
import styles from "../reading.module.css";
import type { Align, Block, Inline, ListItem } from "./model.ts";
import { parseMarkdown, type ParseOptions } from "./parse.ts";

export interface MarkdownProps extends ParseOptions {
  source: string;
  /** reading(기본): 읽기 본문 16/28. chat: 대화 글 body 14/22와 좁은 간격. */
  variant?: "reading" | "chat";
  /** show(기본): image를 그린다. link: 불러오지 않고 alt 글(비면 주소)의 link로 둔다. */
  images?: "show" | "link";
  /** 글 조각(kind "text")과 inline code 하나(kind "code")를 호출자가 그린다. undefined를 돌려주면 기본으로 그린다. link 글 안에서는 부르지 않는다. */
  renderText?: (text: string, kind: "text" | "code") => ReactNode;
  // 있으면 link를 창 안에서 따라가지 않고 호출자가 연다(외부 링크 정책은 shell이 맡는다).
  onOpenLink?: (href: string) => void;
  clipboard?: Clipboard;
  // 있으면 code block마다 복사 단추 앞에 둘 단추를 그린다(대화의 실행 단추). 없으면 undefined를 낸다.
  codeAction?: (code: string, language: string | undefined) => ReactNode;
}

interface RenderContext {
  onOpenLink?: (href: string) => void;
  clipboard: Clipboard;
  images: "show" | "link";
  renderText?: (text: string, kind: "text" | "code") => ReactNode;
  codeAction?: MarkdownProps["codeAction"];
  // <a> 안에서는 다른 <a>를 만들지 않는다.
  inLink?: boolean;
}

function linkOnClick(
  open: ((href: string) => void) | undefined,
  href: string,
): ((event: MouseEvent) => void) | undefined {
  return open === undefined
    ? undefined
    : (event: MouseEvent) => {
        event.preventDefault();
        open(href);
      };
}

const HEADING_CLASS = [styles.h1, styles.h2, styles.h3, styles.h4];
const HEADING_TAG = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

function inlines(
  content: readonly Inline[],
  context: RenderContext,
): ReactNode[] {
  return content.map((inline, index) => {
    switch (inline.kind) {
      case "text": {
        const rendered = context.renderText?.(inline.text, "text");
        return rendered === undefined ? (
          inline.text
        ) : (
          <Fragment key={index}>{rendered}</Fragment>
        );
      }
      case "emphasis":
        return <em key={index}>{inlines(inline.children, context)}</em>;
      case "strong":
        return <strong key={index}>{inlines(inline.children, context)}</strong>;
      case "strike":
        return <del key={index}>{inlines(inline.children, context)}</del>;
      case "code": {
        const rendered = context.renderText?.(inline.text, "code");
        return rendered === undefined ? (
          <code key={index} className={styles.inlineCode}>
            {inline.text}
          </code>
        ) : (
          <Fragment key={index}>{rendered}</Fragment>
        );
      }
      case "break":
        return <br key={index} />;
      case "image": {
        if (context.images === "link" && inline.src !== undefined) {
          const href = inline.src;
          if (context.inLink) {
            return <span key={index}>{inline.alt || href}</span>;
          }
          return (
            <a
              key={index}
              className={styles.link}
              href={href}
              rel="noreferrer noopener"
              onClick={linkOnClick(context.onOpenLink, href)}
            >
              {inline.alt || href}
            </a>
          );
        }
        return inline.src === undefined ? (
          <span key={index}>{inline.alt}</span>
        ) : (
          <img
            key={index}
            className={styles.image}
            src={inline.src}
            alt={inline.alt}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        );
      }
      case "link": {
        // <a> 안에 button(artifact path link)이나 a(image link)를 넣지 않는다.
        const children = inlines(inline.children, {
          ...context,
          renderText: undefined,
          inLink: true,
        });
        const href = inline.href;
        if (href === undefined) return <span key={index}>{children}</span>;
        return (
          <a
            key={index}
            className={styles.link}
            href={href}
            rel="noreferrer noopener"
            onClick={linkOnClick(context.onOpenLink, href)}
          >
            {children}
          </a>
        );
      }
    }
  });
}

const ALIGN_CLASS: Record<Exclude<Align, undefined>, string | undefined> = {
  left: undefined,
  center: styles.center,
  right: styles.right,
};

function alignClass(align: Align): string | undefined {
  return align === undefined ? undefined : ALIGN_CLASS[align];
}

function listItem(item: ListItem, index: number, context: RenderContext) {
  if (item.task === undefined) {
    return <li key={index}>{blocks(item.children, context)}</li>;
  }
  return (
    <li key={index} className={styles.task} data-task={item.task}>
      <span
        className={styles.taskMark}
        role="checkbox"
        aria-checked={item.task}
        aria-disabled="true"
      >
        <Icon
          icon={item.task ? SquareCheck : Square}
          pixels={iconPixels("base")}
        />
      </span>
      <div>{blocks(item.children, context)}</div>
    </li>
  );
}

function block(item: Block, index: number, context: RenderContext): ReactNode {
  switch (item.kind) {
    case "heading": {
      const Tag = HEADING_TAG[item.level - 1];
      return (
        <Tag
          key={index}
          id={item.id}
          className={HEADING_CLASS[Math.min(item.level, 4) - 1]}
        >
          {inlines(item.children, context)}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={index} className={styles.paragraph}>
          {inlines(item.children, context)}
        </p>
      );
    case "code":
      return (
        <CodeBlock
          key={index}
          code={item.text}
          language={item.language}
          clipboard={context.clipboard}
          action={context.codeAction?.(item.text, item.language)}
        />
      );
    case "quote":
      return (
        <blockquote key={index} className={styles.quote}>
          {blocks(item.children, context)}
        </blockquote>
      );
    case "list": {
      const items = item.items.map((entry, at) => listItem(entry, at, context));
      return item.ordered ? (
        <ol key={index} className={styles.list} start={item.start}>
          {items}
        </ol>
      ) : (
        <ul key={index} className={styles.list}>
          {items}
        </ul>
      );
    }
    case "rule":
      return <hr key={index} className={styles.rule} />;
    case "html":
      return (
        <pre key={index} className={styles.html}>
          {item.text}
        </pre>
      );
    case "table":
      return (
        <div key={index} className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {item.header.map((cell, column) => (
                  <th key={column} className={alignClass(item.align[column])}>
                    {inlines(cell, context)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {item.rows.map((row, at) => (
                <tr key={at}>
                  {row.map((cell, column) => (
                    <td key={column} className={alignClass(item.align[column])}>
                      {inlines(cell, context)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function blocks(
  content: readonly Block[],
  context: RenderContext,
): ReactNode[] {
  return content.map((item, index) => block(item, index, context));
}

// Lezer Markdown을 React 글과 element로만 그린다. raw HTML은 실행하지 않는다.
export function Markdown({
  source,
  resolveImage,
  onOpenLink,
  variant = "reading",
  images = "show",
  renderText,
  clipboard = systemClipboard,
  codeAction,
}: MarkdownProps) {
  const document = useMemo(
    () => parseMarkdown(source, { resolveImage }),
    [source, resolveImage],
  );
  return (
    <div
      className={
        variant === "chat"
          ? `${styles.markdown} ${styles.chat}`
          : styles.markdown
      }
    >
      {blocks(document.blocks, {
        onOpenLink,
        clipboard,
        images,
        renderText,
        codeAction,
      })}
    </div>
  );
}
