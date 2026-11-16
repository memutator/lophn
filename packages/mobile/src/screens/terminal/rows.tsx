// The terminal's screen as text rows: one mono `Text` per line (scrollback above the screen), each run a nested `Text`
// with its colors and flags. Every cell is the mono font's advance wide, so columns line up; a wide (CJK) run gets the
// letter spacing that makes each of its glyphs two cells. The advance is measured once on the phone (Android rounds it
// to its pixels), so a row is as wide as its columns. The newest line is at the bottom and stays there while the
// screen changes; scrolling up to read holds the screen still until the person goes back to the latest.
import { t } from "@lophn/i18n";
import { Icon, type Theme, useTheme } from "@lophn/ui-native";
import { ArrowDown } from "lucide-react-native";
import { useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  Text as NativeText,
  type TextStyle,
  View,
} from "react-native";
import type {
  TerminalLine,
  TerminalRun,
  TerminalSnapshot,
} from "../../data/mod.ts";
import { terminalColor } from "./colors.ts";

// JetBrains Mono's advance is 600 of 1000 units: one cell is 0.6 of the font size until the phone measured it.
const CELL = 0.6;
const PROBE = "0".repeat(100);
// Dim text: the desktop drafts draw it at 0.55.
const DIM_ALPHA = "8c";
const PAD_X = 12;
const PAD_Y = 6;
// A terminal shows `->` and `!=` as typed, but JetBrains Mono joins them (contextual alternates) and Android's text
// layout does not turn that off (`fontVariant` drops `no-contextual`, and a zero-width non-joiner does not stop it).
// Text is shaped per span, so two symbols in a row go into two spans; the cells stay the same.
const JOINS = /(?<=[-<>=!&|+*/\\:.~#_^%?$@;])(?=[-<>=!&|+*/\\:.~#_^%?$@;[{(])/;

interface Font {
  readonly fontSize: number;
  readonly lineHeight: number;
}

/** Font size and line height that fit `columns` cells in `width`, in the 13/19 proportion of the 100% size. */
function fitFont(width: number, columns: number, cell: number): Font {
  const fontSize = Math.max(
    1,
    Math.floor(((width - 2 * PAD_X) / (columns * cell)) * 10) / 10,
  );
  return { fontSize, lineHeight: Math.round(fontSize * (19 / 13) * 10) / 10 };
}

function runStyle(
  run: TerminalRun,
  theme: Theme,
  font: Font,
  cell: number,
): TextStyle {
  const scheme = theme.scheme;
  let fg = terminalColor(run.fg, scheme);
  let bg = terminalColor(run.bg, scheme);
  if (run.inverse) {
    [fg, bg] = [
      bg ?? theme.color.surface.base,
      fg ?? theme.color.text.primary,
    ];
  }
  if (run.dim) fg = `${(fg ?? theme.color.text.primary).slice(0, 7)}${DIM_ALPHA}`;
  return {
    color: fg,
    backgroundColor: bg,
    fontWeight: run.bold ? "600" : undefined,
    fontStyle: run.italic ? "italic" : undefined,
    textDecorationLine: run.underline ? "underline" : undefined,
    // A CJK glyph from the system fallback font is one em wide; spacing makes it two cells.
    letterSpacing: run.wide ? (2 * cell - 1) * font.fontSize : undefined,
  };
}

/** The runs of a line with the cursor's cell cut out of them as its own run (padded with spaces past the end). */
function withCursor(
  runs: readonly TerminalRun[],
  x: number,
): { runs: TerminalRun[]; at: number } {
  const out: TerminalRun[] = [];
  let column = 0;
  let at = -1;
  for (const run of runs) {
    const chars = Array.from(run.text);
    const width = run.wide ? 2 : 1;
    const end = column + chars.length * width;
    if (at === -1 && x >= column && x < end) {
      const i = Math.floor((x - column) / width);
      const before = chars.slice(0, i).join("");
      const after = chars.slice(i + 1).join("");
      if (before !== "") out.push({ ...run, text: before });
      at = out.length;
      out.push({ ...run, text: chars[i]! });
      if (after !== "") out.push({ ...run, text: after });
    } else {
      out.push(run);
    }
    column = end;
  }
  if (at === -1) {
    if (x > column) out.push({ text: " ".repeat(x - column) });
    at = out.length;
    out.push({ text: " " });
  }
  return { runs: out, at };
}

function Row({
  line,
  cursor,
  width,
  font,
  cell,
}: {
  line: TerminalLine;
  /** The cursor's column on this line. */
  cursor: number | null;
  width: number;
  font: Font;
  /** One cell's width over the font size. */
  cell: number;
}) {
  const theme = useTheme();
  const { runs, at } =
    cursor === null ? { runs: line.runs, at: -1 } : withCursor(line.runs, cursor);
  return (
    <NativeText
      numberOfLines={1}
      ellipsizeMode="clip"
      style={{
        width,
        fontFamily: theme.font.mono,
        ...font,
        color: theme.color.text.primary,
      }}
    >
      {runs.length === 0
        ? " "
        : runs.map((run, i) => (
            <NativeText
              key={i}
              style={[
                runStyle(run, theme, font, cell),
                i === at && {
                  color: theme.color.surface.base,
                  backgroundColor: theme.color.text.primary,
                },
              ]}
            >
              {JOINS.test(run.text)
                ? run.text
                    .split(JOINS)
                    .map((piece, j) => <NativeText key={j}>{piece}</NativeText>)
                : run.text}
            </NativeText>
          ))}
    </NativeText>
  );
}

type Item = { line: TerminalLine; cursor: number | null; key: string };

function itemsOf(screen: TerminalSnapshot): Item[] {
  const { scrollback, lines, cursor } = screen;
  const all = [...scrollback, ...lines];
  const cursorAt = cursor.hidden ? -1 : scrollback.length + cursor.y;
  // Newest first: the list is inverted.
  return all
    .map((line, i) => ({
      line,
      cursor: i === cursorAt ? cursor.x : null,
      key: String(all.length - i),
    }))
    .reverse();
}

export function TerminalRows({
  screen,
  fit,
}: {
  screen: TerminalSnapshot;
  /** Shrinks the text so every column fits the width; otherwise the 100% size scrolls sideways. */
  fit: boolean;
}) {
  const theme = useTheme();
  const list = useRef<FlatList<Item>>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  // The screen held while the person reads above the latest.
  const [held, setHeld] = useState<TerminalSnapshot | null>(null);
  const shown = held ?? screen;
  const [cell, setCell] = useState(CELL);
  const font: Font =
    fit && size !== null
      ? fitFont(size.width, shown.columns, cell)
      : theme.type.note;
  const rowWidth = Math.ceil(shown.columns * cell * font.fontSize) + 1;

  const rows =
    size === null ? null : (
      <FlatList
        // Android drops a run's underline when the theme's colors change under it; a new list draws it again.
        key={theme.scheme}
        ref={list}
        inverted
        data={itemsOf(shown)}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <Row
            line={item.line}
            cursor={item.cursor}
            width={rowWidth}
            font={font}
            cell={cell}
          />
        )}
        style={{
          width: fit ? size.width : rowWidth + 2 * PAD_X,
          height: size.height,
        }}
        contentContainerStyle={{
          paddingHorizontal: PAD_X,
          paddingVertical: PAD_Y,
        }}
        scrollEventThrottle={64}
        onScroll={(event) => {
          const away = event.nativeEvent.contentOffset.y > 2 * font.lineHeight;
          if (away && held === null) setHeld(screen);
          if (!away && held !== null) setHeld(null);
        }}
      />
    );

  return (
    <View
      style={{ flex: 1, minHeight: 0, backgroundColor: theme.color.surface.base }}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize({ width, height });
      }}
    >
      <NativeText
        numberOfLines={1}
        onTextLayout={(event) => {
          const line = event.nativeEvent.lines[0];
          if (line !== undefined && line.width > 0) {
            setCell(line.width / PROBE.length / theme.type.note.fontSize);
          }
        }}
        style={{
          position: "absolute",
          top: -1000,
          width: 4000,
          opacity: 0,
          fontFamily: theme.font.mono,
          ...theme.type.note,
        }}
      >
        {PROBE}
      </NativeText>
      {fit ? (
        rows
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator>
          {rows}
        </ScrollView>
      )}
      {held !== null && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mobile.terminal.button.latest")}
          onPress={() => {
            list.current?.scrollToOffset({ offset: 0, animated: true });
            setHeld(null);
          }}
          style={{
            position: "absolute",
            bottom: 12,
            alignSelf: "center",
            width: 40,
            height: 40,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: theme.color.border.base,
            backgroundColor: theme.color.surface.base,
            boxShadow: theme.shadow.popover,
          }}
        >
          <Icon icon={ArrowDown} size={20} />
        </Pressable>
      )}
    </View>
  );
}
