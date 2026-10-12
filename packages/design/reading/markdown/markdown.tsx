import { type MouseEvent, type ReactNode, useMemo } from "react";
import { Square, SquareCheck } from "lucide-react";
import {
  type Clipboard,
  Icon,
  iconPixels,
  systemClipboard,
} from "../../components/mod.ts";
import { CodeBlock } from "../code-block/code-block.tsx";
import styles from "../reading.module.css";
import type { Align, Block, Inline, ListItem } from "./model.ts";
import { parseMarkdown, type ParseOptions } from "./parse.ts";

export interface MarkdownProps extends ParseOptions {
  source: string;
  // 있으면 link를 창 안에서 따라가지 않고 호출자가 연다(외부 링크 정책은 shell이 맡는다).
  onOpenLink?: (href: string) => void;
  clipboard?: Clipboard;
}

interface RenderContext {
  onOpenLink?: (href: string) => void;
  clipboard: Clipboard;
}

const HEADING_CLASS = [styles.h1, styles.h2, styles.h3, styles.h4];
const HEADING_TAG = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

function inlines(
  content: readonly Inline[],
  context: RenderContext,
): ReactNode[] {
  return content.map((inline, index) => {
    switch (inline.kind) {
      case "text":
        return inline.text;
      case "emphasis":
        return <em key={index}>{inlines(inline.children, context)}</em>;
      case "strong":
        return <strong key={index}>{inlines(inline.children, context)}</strong>;
      case "strike":
        return <del key={index}>{inlines(inline.children, context)}</del>;
      case "code":
        return (
          <code key={index} className={styles.inlineCode}>{inline.text}</code>
        );
      case "break":
        return <br key={index} />;
      case "image":
        return inline.src === undefined
          ? <span key={index}>{inline.alt}</span>
          : (
            <img
              key={index}
              className={styles.image}
              src={inline.src}
              alt={inline.alt}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          );
      case "link": {
        const children = inlines(inline.children, context);
        const href = inline.href;
        if (href === undefined) return <span key={index}>{children}</span>;
        const open = context.onOpenLink;
        return (
          <a
            key={index}
            className={styles.link}
            href={href}
            rel="noreferrer noopener"
            onClick={open
              ? (event: MouseEvent) => {
                event.preventDefault();
                open(href);
              }
              : undefined}
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
      <span className={styles.taskMark}>
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
      return item.ordered
        ? (
          <ol key={index} className={styles.list} start={item.start}>
            {items}
          </ol>
        )
        : <ul key={index} className={styles.list}>{items}</ul>;
    }
    case "rule":
      return <hr key={index} className={styles.rule} />;
    case "html":
      return <pre key={index} className={styles.html}>{item.text}</pre>;
    case "table":
      return (
        <table key={index} className={styles.table}>
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
export function Markdown(
  { source, resolveImage, onOpenLink, clipboard = systemClipboard }:
    MarkdownProps,
) {
  const document = useMemo(
    () => parseMarkdown(source, { resolveImage }),
    [source, resolveImage],
  );
  return (
    <div className={styles.markdown}>
      {blocks(document.blocks, { onOpenLink, clipboard })}
    </div>
  );
}
