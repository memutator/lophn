import { Square, SquareCheck } from "lucide-react-native";
import { Fragment, type ReactNode, useMemo } from "react";
import {
  Linking,
  Text as NativeText,
  ScrollView,
  type TextStyle,
  View,
} from "react-native";
import { parseCached } from "../../components/reading/markdown/cache.ts";
import type {
  Block,
  Inline,
  ListItem,
} from "../../components/reading/markdown/model.ts";
import { parseMarkdown } from "../../components/reading/markdown/parse.ts";
import { presentStreamingTail } from "../../components/reading/markdown/stream.ts";
import { scaleText, type Theme, useTheme } from "../theme.tsx";
import { CodeBlock } from "./code-block.tsx";
import { MathBlock, MermaidBlock } from "./diagram-blocks.tsx";
import { formatMath } from "./math.ts";

export interface MarkdownProps {
  source: string;
  /** The tail of text still being written. Hides endings that would redraw differently once more arrives and skips the parse cache. The caller closes an open code fence first. */
  streaming?: boolean;
  /** chat: an agent's answer, 16/25 with 8 between blocks. reading (default): a document, 16/26 with headings. */
  variant?: "reading" | "chat";
  /** Opens a link. Defaults to the phone's browser. */
  onOpenLink?: (href: string) => void;
}

interface Look {
  theme: Theme;
  chat: boolean;
  base: TextStyle;
  open: (href: string) => void;
}

function inlines(look: Look, nodes: readonly Inline[]): ReactNode {
  const { theme } = look;
  return nodes.map((node, index) => {
    const key = index;
    switch (node.kind) {
      case "text":
        return node.text;
      case "emphasis":
        return (
          <NativeText key={key} style={{ fontStyle: "italic" }}>
            {inlines(look, node.children)}
          </NativeText>
        );
      case "strong":
        return (
          <NativeText key={key} style={{ fontWeight: "600" }}>
            {inlines(look, node.children)}
          </NativeText>
        );
      case "strike":
        return (
          <NativeText key={key} style={{ textDecorationLine: "line-through" }}>
            {inlines(look, node.children)}
          </NativeText>
        );
      case "code":
        return (
          <NativeText
            key={key}
            style={{
              fontFamily: theme.font.mono,
              fontWeight: "400",
              fontSize: Math.round((look.base.fontSize ?? 16) * 0.86),
            }}
          >
            {node.text}
          </NativeText>
        );
      case "math":
        return (
          <NativeText
            key={key}
            style={{
              fontStyle: "italic",
            }}
          >
            {formatMath(node.tex)}
          </NativeText>
        );
      case "link": {
        const href = node.href;
        return href === undefined ? (
          <Fragment key={key}>{inlines(look, node.children)}</Fragment>
        ) : (
          <NativeText
            key={key}
            accessibilityRole="link"
            onPress={() => look.open(href)}
            style={{ color: theme.color.link }}
          >
            {inlines(look, node.children)}
          </NativeText>
        );
      }
      // An image cannot sit inside a line of native text; it shows as its alt text and opens on press.
      case "image": {
        const src = node.src;
        return (
          <NativeText
            key={key}
            onPress={src === undefined ? undefined : () => look.open(src)}
            style={{ color: src === undefined ? undefined : theme.color.link }}
          >
            {node.alt || src || ""}
          </NativeText>
        );
      }
      default:
        return "\n";
    }
  });
}

function paragraph(look: Look, children: readonly Inline[], style?: TextStyle) {
  return (
    <NativeText
      selectable
      style={[look.base, style && scaleText(look.theme, style)]}
    >
      {inlines(look, children)}
    </NativeText>
  );
}

function listItem(look: Look, item: ListItem, marker: string, key: number) {
  const { theme } = look;
  const Box = item.task ? SquareCheck : Square;
  return (
    <View key={key} style={{ flexDirection: "row" }}>
      <View
        style={{
          width: 20,
          height: look.base.lineHeight,
          justifyContent: "center",
        }}
      >
        {item.task === undefined ? (
          <NativeText style={[look.base, { paddingLeft: 4 }]}>
            {marker}
          </NativeText>
        ) : (
          <Box size={16} strokeWidth={1.6} color={theme.color.text.muted} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        {blocks(look, item.children, true)}
      </View>
    </View>
  );
}

// Space between two blocks: a flat gap in chat; in a document the larger of the first's space below and the
// second's space above, as CSS margins collapse (heading 1: 8 below, other headings 18 above and 6 below, others 10 below).
function between(look: Look, before: Block, node: Block): number {
  if (look.chat) return 8;
  const below = before.kind === "heading" ? (before.level === 1 ? 8 : 6) : 10;
  const aboveNext = node.kind === "heading" ? 18 : 0;
  return Math.max(below, aboveNext);
}

function blocks(look: Look, nodes: readonly Block[], tight = false): ReactNode {
  const { theme } = look;
  return nodes.map((node, index) => {
    const key = index;
    const before = nodes[index - 1];
    const top =
      before === undefined ? 0 : tight ? 4 : between(look, before, node);
    let body: ReactNode;
    switch (node.kind) {
      case "heading": {
        const size: TextStyle =
          node.level === 1
            ? { fontSize: 24, lineHeight: 32, letterSpacing: -0.48 }
            : node.level === 2
              ? { fontSize: 18, lineHeight: 26 }
              : {};
        body = paragraph(look, node.children, { ...size, fontWeight: "600" });
        break;
      }
      case "paragraph":
        body = paragraph(
          look,
          node.children,
          look.chat ? undefined : { lineHeight: 26 },
        );
        break;
      case "math":
        body = <MathBlock tex={node.tex} />;
        break;
      case "code":
        body =
          node.language?.toLowerCase() === "mermaid" ? (
            <MermaidBlock code={node.text} />
          ) : (
            <CodeBlock code={node.text} language={node.language} />
          );
        break;
      case "quote":
        body = (
          <View
            style={{
              borderLeftWidth: 2,
              borderLeftColor: theme.color.border.strong,
              paddingLeft: 12,
            }}
          >
            {blocks(look, node.children)}
          </View>
        );
        break;
      case "list":
        body = (
          <View style={{ gap: 4 }}>
            {node.items.map((item, at) =>
              listItem(
                look,
                item,
                node.ordered ? `${(node.start ?? 1) + at}.` : "•",
                at,
              ),
            )}
          </View>
        );
        break;
      case "rule":
        body = (
          <View
            style={{ height: 1, backgroundColor: theme.color.border.base }}
          />
        );
        break;
      case "html":
        body = paragraph(look, [{ kind: "text", text: node.text }], {
          fontFamily: theme.font.mono,
          fontSize: 13,
        });
        break;
      // Native has no table layout. Cells share the width and scroll sideways once they reach their minimum.
      default:
        body = (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ minWidth: "100%" }}>
              {[node.header, ...node.rows].map((row, at) => (
                <View
                  key={at}
                  style={{
                    flexDirection: "row",
                    borderBottomWidth: 1,
                    borderBottomColor: theme.color.border.subtle,
                  }}
                >
                  {row.map((cell, column) => (
                    <View
                      key={column}
                      style={{
                        flex: 1,
                        minWidth: 96,
                        paddingVertical: 8,
                        paddingHorizontal: 10,
                      }}
                    >
                      {paragraph(look, cell, {
                        fontSize: 14,
                        lineHeight: 20,
                        fontWeight: at === 0 ? "500" : "400",
                        color:
                          at === 0
                            ? theme.color.text.secondary
                            : theme.color.text.primary,
                        textAlign: node.align[column],
                      })}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        );
    }
    return (
      <View key={key} style={{ marginTop: top }}>
        {body}
      </View>
    );
  });
}

// Draws the same parsed document model as the desktop Markdown, with native text instead of HTML.
export function Markdown({
  source,
  streaming,
  variant = "reading",
  onOpenLink,
}: MarkdownProps) {
  const theme = useTheme();
  const document = useMemo(
    () =>
      streaming
        ? parseMarkdown(presentStreamingTail(source))
        : parseCached(source),
    [source, streaming],
  );
  const look: Look = {
    theme,
    chat: variant === "chat",
    base: scaleText(theme, {
      fontFamily: theme.font.sans,
      fontSize: 16,
      lineHeight: variant === "chat" ? 25 : 26,
      color: theme.color.text.primary,
    }),
    open: onOpenLink ?? ((href) => void Linking.openURL(href)),
  };
  return <View>{blocks(look, document.blocks)}</View>;
}
