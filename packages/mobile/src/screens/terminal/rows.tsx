// The terminal's screen as text rows: one mono `Text` per line (scrollback above the screen), each run a nested `Text`
// with its colors and flags. Every cell is the mono font's advance wide, so columns line up; a wide (CJK, emoji) run gets
// the letter spacing that makes each of its glyphs two cells. The advance, a Hangul glyph's and an emoji's width are
// measured once on the phone (the wide ones come from fallback fonts whose width differs by phone), so a row is as wide
// as its columns. The text is one size; the phone sizes the terminal to its own grid (`onGrid`), and a screen wider than
// that (the computer took the size back) scrolls sideways. The newest line is at the bottom and stays there while the
// screen changes; scrolling up to read holds the screen still until the person goes back to the latest.
import { t } from "@lophn/i18n";
import { Icon, Text, type Theme, useTheme } from "@lophn/ui-native";
import { ArrowDown, Minimize2 } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
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

// JetBrains Mono's advance is 600 of 1000 units: one cell is 0.6 of the font size until the phone measured it. A wide
// glyph is taken as one em until then.
const CELL = 0.6;
const PROBE = "0".repeat(100);
const WIDE_PROBE = "가".repeat(50);
const EMOJI_PROBE = "😀".repeat(20);
// An emoji (with its variation selector and joined parts): drawn by the emoji font, measured on its own.
const EMOJI = /(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/u;
// The smallest grid the core takes (`terminal_view/resize`).
const MIN_COLUMNS = 10;
const MIN_ROWS = 4;
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

/** Widths over the font size: one cell, one Hangul glyph, one emoji. */
interface Metrics {
  readonly cell: number;
  readonly wide: number;
  readonly emoji: number;
}

/** The phone's own grid: how many cells fit the view. */
export interface Grid {
  readonly columns: number;
  readonly rows: number;
}

function runStyle(run: TerminalRun, theme: Theme): TextStyle {
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
  };
}

/** A wide run's text: spacing after each glyph makes it two cells, by the measured width of its kind. */
function WideText({
  text,
  font,
  metrics,
}: {
  text: string;
  font: Font;
  metrics: Metrics;
}) {
  const spacing = (width: number) => (2 * metrics.cell - width) * font.fontSize;
  return text
    .split(EMOJI)
    .map((piece, i) =>
      piece === "" ? null : (
        <NativeText
          key={i}
          style={{
            letterSpacing: spacing(i % 2 === 1 ? metrics.emoji : metrics.wide),
          }}
        >
          {piece}
        </NativeText>
      ),
    );
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
  metrics,
}: {
  line: TerminalLine;
  /** The cursor's column on this line. */
  cursor: number | null;
  width: number;
  font: Font;
  metrics: Metrics;
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
                runStyle(run, theme),
                i === at && {
                  color: theme.color.surface.base,
                  backgroundColor: theme.color.text.primary,
                },
              ]}
            >
              {run.wide ? (
                <WideText text={run.text} font={font} metrics={metrics} />
              ) : JOINS.test(run.text)
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

// A touch that ends where it started, quickly, is a tap; anything else scrolls.
const TAP_MOVE = 8;
const TAP_MS = 300;

export function TerminalRows({
  screen,
  onGrid,
  onTap,
}: {
  screen: TerminalSnapshot;
  /** The phone's grid once measured, and again whenever the view's size changes (rotation, keyboard). */
  onGrid(grid: Grid): void;
  /** The person tapped the screen. */
  onTap(): void;
}) {
  const theme = useTheme();
  const list = useRef<FlatList<Item>>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  // The screen held while the person reads above the latest.
  const [held, setHeld] = useState<TerminalSnapshot | null>(null);
  const shown = held ?? screen;
  const font: Font = theme.type.note;
  const [cell, setCell] = useState<number | null>(null);
  const [wide, setWide] = useState(1);
  const [emoji, setEmoji] = useState(1);
  const metrics: Metrics = { cell: cell ?? CELL, wide, emoji };
  const rowWidth = Math.ceil(shown.columns * metrics.cell * font.fontSize) + 1;
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);

  const grid: Grid | null =
    size === null || cell === null
      ? null
      : {
          columns: Math.min(
            512,
            Math.max(
              MIN_COLUMNS,
              Math.floor((size.width - 2 * PAD_X) / (cell * font.fontSize)),
            ),
          ),
          rows: Math.min(
            256,
            Math.max(
              MIN_ROWS,
              Math.floor((size.height - 2 * PAD_Y) / font.lineHeight),
            ),
          ),
        };
  const gridKey = grid === null ? null : `${grid.columns}x${grid.rows}`;
  const latestGrid = useRef(onGrid);
  latestGrid.current = onGrid;
  useEffect(() => {
    if (grid !== null) latestGrid.current(grid);
  }, [gridKey]);

  const probe = (text: string, fontSize: number, set: (width: number) => void) => (
    <NativeText
      numberOfLines={1}
      onTextLayout={(event) => {
        const line = event.nativeEvent.lines[0];
        if (line !== undefined && line.width > 0) {
          set(line.width / Array.from(text).length / fontSize);
        }
      }}
      style={{
        position: "absolute",
        top: -1000,
        width: 4000,
        opacity: 0,
        fontFamily: theme.font.mono,
        ...font,
      }}
    >
      {text}
    </NativeText>
  );

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
            metrics={metrics}
          />
        )}
        style={{
          width: Math.max(size.width, rowWidth + 2 * PAD_X),
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
      {probe(PROBE, font.fontSize, setCell)}
      {probe(WIDE_PROBE, font.fontSize, setWide)}
      {probe(EMOJI_PROBE, font.fontSize, setEmoji)}
      <View
        style={{ flex: 1, minHeight: 0 }}
        onTouchStart={(event) => {
          const { pageX, pageY } = event.nativeEvent;
          touch.current = { x: pageX, y: pageY, at: Date.now() };
        }}
        onTouchEnd={(event) => {
          const start = touch.current;
          touch.current = null;
          if (start === null) return;
          const { pageX, pageY } = event.nativeEvent;
          if (
            Math.abs(pageX - start.x) < TAP_MOVE &&
            Math.abs(pageY - start.y) < TAP_MOVE &&
            Date.now() - start.at < TAP_MS
          ) {
            onTap();
          }
        }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator>
          {rows}
        </ScrollView>
      </View>
      {grid !== null && shown.columns > grid.columns && (
        <Pressable
          accessibilityRole="button"
          onPress={onTap}
          style={{
            position: "absolute",
            top: 10,
            alignSelf: "center",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            height: 34,
            paddingHorizontal: 14,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.color.border.base,
            backgroundColor: theme.color.surface.base,
            boxShadow: theme.shadow.popover,
          }}
        >
          <Icon icon={Minimize2} size={16} />
          <Text variant="small" weight="medium">
            {t("mobile.terminal.button.fit-phone")}
          </Text>
        </Pressable>
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
