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
import { type Theme, useTheme } from "../theme.tsx";
import { CodeBlock } from "./code-block.tsx";

export interface MarkdownProps {
  source: string;
  /** The tail of text still being written. Hides endings that would redraw differently once more arrives and skips the parse cache. The caller closes an open code fence first. */
  streaming?: boolean;
  /** reading (default): document body 16/26. chat: conversation text 16/24 with tighter gaps. */
  variant?: "reading" | "chat";
  /** Opens a link. Defaults to the phone's browser. */
  onOpenLink?: (href: string) => void;
}

interface Look {
  theme: Theme;
  base: TextStyle;
  gap: number;
  open: (href: string) => void;
}

const TABLE_CELL = 148;

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
      case "math":
        return (
          <NativeText
            key={key}
            style={{
              fontFamily: theme.font.mono,
              fontSize: (look.base.fontSize ?? 16) - 2,
              backgroundColor: theme.color.surface.muted,
            }}
          >
            {node.kind === "code" ? node.text : node.tex}
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
    <NativeText selectable style={[look.base, style]}>
      {inlines(look, children)}
    </NativeText>
  );
}

function listItem(look: Look, item: ListItem, marker: string, key: number) {
  const { theme } = look;
  const Box = item.task ? SquareCheck : Square;
  return (
    <View key={key} style={{ flexDirection: "row", gap: theme.space[4] }}>
      {item.task === undefined ? (
        <NativeText
          style={[
            look.base,
            { color: theme.color.text.muted, minWidth: 16, textAlign: "right" },
          ]}
        >
          {marker}
        </NativeText>
      ) : (
        <View
          style={{
            height: look.base.lineHeight,
            justifyContent: "center",
          }}
        >
          <Box
            size={theme.icon.small}
            strokeWidth={theme.icon.stroke}
            color={theme.color.text.muted}
          />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0, gap: theme.space[2] }}>
        {blocks(look, item.children)}
      </View>
    </View>
  );
}

function blocks(look: Look, nodes: readonly Block[]): ReactNode {
  const { theme } = look;
  return nodes.map((node, index) => {
    const key = index;
    switch (node.kind) {
      case "heading": {
        const size =
          node.level === 1
            ? theme.type.title
            : node.level === 2
              ? { fontSize: 18, lineHeight: 26 }
              : look.base;
        return (
          <Fragment key={key}>
            {paragraph(look, node.children, {
              ...size,
              fontWeight: "600",
              marginTop: index === 0 ? 0 : theme.space[2],
            })}
          </Fragment>
        );
      }
      case "paragraph":
        return <Fragment key={key}>{paragraph(look, node.children)}</Fragment>;
      case "math":
        return <CodeBlock key={key} code={node.tex} language="math" />;
      case "code":
        return (
          <CodeBlock key={key} code={node.text} language={node.language} />
        );
      case "quote":
        return (
          <View
            key={key}
            style={{
              borderLeftWidth: 2,
              borderLeftColor: theme.color.border.strong,
              paddingLeft: theme.space[5],
              gap: look.gap,
            }}
          >
            {blocks(look, node.children)}
          </View>
        );
      case "list":
        return (
          <View key={key} style={{ gap: theme.space[2] }}>
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
      case "rule":
        return (
          <View
            key={key}
            style={{ height: 1, backgroundColor: theme.color.border.base }}
          />
        );
      case "html":
        return (
          <Fragment key={key}>
            {paragraph(look, [{ kind: "text", text: node.text }], {
              fontFamily: theme.font.mono,
              fontSize: 13,
            })}
          </Fragment>
        );
      // Native has no table layout. Fixed-width cells in a sideways scroll keep columns aligned.
      default:
        return (
          <ScrollView
            key={key}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.color.border.subtle,
                borderRadius: theme.radius.sm,
                overflow: "hidden",
              }}
            >
              {[node.header, ...node.rows].map((row, at) => (
                <View
                  key={at}
                  style={{
                    flexDirection: "row",
                    backgroundColor:
                      at === 0 ? theme.color.surface.subtle : undefined,
                    borderTopWidth: at === 0 ? 0 : 1,
                    borderTopColor: theme.color.border.subtle,
                  }}
                >
                  {row.map((cell, column) => (
                    <View
                      key={column}
                      style={{
                        width: TABLE_CELL,
                        paddingHorizontal: theme.space[5],
                        paddingVertical: theme.space[4],
                      }}
                    >
                      {paragraph(look, cell, {
                        fontSize: 14,
                        lineHeight: 20,
                        fontWeight: at === 0 ? "600" : "400",
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
  const chat = variant === "chat";
  const look: Look = {
    theme,
    base: {
      ...(chat ? theme.type.body : theme.type.reading),
      color: theme.color.text.primary,
    },
    gap: chat ? theme.space[4] : theme.space[5],
    open: onOpenLink ?? ((href) => void Linking.openURL(href)),
  };
  return <View style={{ gap: look.gap }}>{blocks(look, document.blocks)}</View>;
}
