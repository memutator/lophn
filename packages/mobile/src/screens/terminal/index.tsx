// A terminal on the computer as the phone sees it (tools/wireframes/drafts/phone/terminal.tsx): a coding session's
// terminal (the session screen shows it in place of the chat while the session runs in a terminal), or one the phone
// opened (its place's session is `term:<terminal>`). The screen's text and colors at one size,
// and under it either the line that typing is off for this phone or a text box and a key bar. The phone sizes the terminal
// to its own grid when it opens the screen and when the person taps it; while it holds the size (the screen it gets is
// its grid) it follows the grid as the keyboard or rotation changes it. Watching stops in the background.
import { type MessageKey, t } from "@lophn/i18n";
import { Icon, IconButton, Screen, Tag, Text, TopBar, type TopBarProps, useTheme } from "@lophn/ui-native";
import * as Clipboard from "expo-clipboard";
import {
  ClipboardPaste,
  Ellipsis,
  KeyboardOff,
  SquareTerminal,
  WifiOff,
} from "lucide-react-native";
import { type ComponentRef, type RefObject, useEffect, useRef, useState } from "react";
import { type TextInput, View } from "react-native";
import { HOME_TERMINAL_PROJECT } from "../../../../protocol/coding-agent/terminals.ts";
import { TERMINAL_SESSION_PREFIX } from "../../../../protocol/lophn-agent/session-tag.ts";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import {
  type SourceResult,
  useCodingSessions,
  useCurrentComputer,
  useNames,
  useSessionDraft,
  useTerminal,
} from "../../data/mod.ts";
import { Face, OfflineBanner } from "../../parts/mod.ts";
import { KeyCap, KeyRow, NoticeLine, TypeBox, useForeground } from "../../parts/typing.tsx";
import { harnessAvatar, stateOf } from "../coding/parts.tsx";
import { type BarKey, barKeyBytes, charBytes, type Mods, NO_MODS } from "./keys.ts";
import { type Grid, TerminalRows } from "./rows.tsx";

// Grid changes while the keyboard slides or the phone turns come in a burst; the last one is claimed.
const GRID_SETTLE_MS = 150;

export function TerminalScreen({ place }: { place: PlaceOf<"terminal"> }) {
  const nav = useNav();
  return (
    <TerminalView
      session={place.session}
      project={place.project}
      left={{ left: "back", onLeft: nav.back }}
    />
  );
}

/**
 * The terminal of `session` (a coding session, or `term:<terminal>`) with its top bar. `left` is the bar's left button
 * (back, or the sidebar's menu on a top-level screen); `onMore`, when given, puts the more-actions button on the right.
 */
export function TerminalView({
  session,
  project: projectId,
  left,
  onMore,
}: {
  session: string;
  project: string;
  left: Pick<TopBarProps, "left" | "onLeft">;
  onMore?: () => void;
}) {
  const theme = useTheme();
  const computer = useCurrentComputer()?.name ?? "";
  const names = useNames();
  const coding = useCodingSessions(projectId);
  // A terminal the phone opened has no coding session; its place carries the terminal.
  const opened = session.startsWith(TERMINAL_SESSION_PREFIX)
    ? session.slice(TERMINAL_SESSION_PREFIX.length)
    : null;
  const row =
    opened !== null
      ? null
      : (coding.sessions.find((one) => one.session === session) ?? null);
  const terminal = opened ?? row?.terminal ?? null;
  const foreground = useForeground();
  const view = useTerminal(foreground ? terminal : null);
  const gone =
    view.status === "gone" ||
    (opened === null && coding.status === "ready" && row === null);
  const screen = view.screen;
  const typing = useRef<ComponentRef<typeof TextInput>>(null);

  // The size this phone asked for last. It still holds the size while the screen it gets is that size.
  const claimed = useRef<Grid | null>(null);
  const grid = useRef<Grid | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(settle.current ?? undefined), []);
  const claim = () => {
    if (grid.current === null) return;
    claimed.current = grid.current;
    view.resize(grid.current.columns, grid.current.rows);
  };
  const onGrid = (next: Grid) => {
    grid.current = next;
    clearTimeout(settle.current ?? undefined);
    settle.current = setTimeout(() => {
      const held = claimed.current;
      const owner =
        held === null ||
        (screen !== null &&
          screen.columns === held.columns &&
          screen.rows === held.rows);
      if (owner) claim();
    }, GRID_SETTLE_MS);
  };
  const onTap = () => {
    claim();
    if (view.input) typing.current?.focus();
  };

  const project =
    projectId === HOME_TERMINAL_PROJECT ? t("left-sidebar.label.home") : (names.projects.get(projectId) ?? "");
  const title =
    row === null
      ? t("terminal.label.output")
      : (row.title ?? row.label);
  // A coding session's line says how it is doing (working, waiting, idle) where a chat would show its agent.
  const under =
    row === null
      ? project
      : t("mobile.session.label.where", {
          agent: stateOf(row).text ?? row.label,
          workspace: project,
        });

  let bottom = null;
  if (gone) {
    bottom = (
      <NoticeLine icon={SquareTerminal}>
        {t("mobile.terminal.notice.gone", { computer })}
      </NoticeLine>
    );
  } else if (view.status === "offline") {
    bottom = (
      <NoticeLine icon={WifiOff}>
        {t("mobile.terminal.notice.unreachable", { computer })}
      </NoticeLine>
    );
  } else if (view.input) {
    bottom = <Typing session={session} send={view.send} input={typing} />;
  } else if (screen !== null) {
    bottom = (
      <NoticeLine icon={KeyboardOff}>{t("mobile.terminal.notice.typing-off")}</NoticeLine>
    );
  }

  return (
    <Screen
      top={
        <>
          <TopBar
            {...left}
            lead={
              row === null ? undefined : (
                <Face look={harnessAvatar(row.harness, row.label)} size={26} />
              )
            }
            title={title}
            under={under === "" ? undefined : under}
            right={
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {screen !== null && !view.input && (
                  <View style={{ marginRight: onMore === undefined ? 14 : 4 }}>
                    <Tag>{t("mobile.terminal.label.view-only")}</Tag>
                  </View>
                )}
                {onMore !== undefined && (
                  <IconButton
                    icon={Ellipsis}
                    label={t("conversation.label.more-actions")}
                    onPress={onMore}
                  />
                )}
              </View>
            }
          />
          <OfflineBanner note={t("mobile.offline.note")} />
        </>
      }
      footer={bottom}
    >
      {screen === null ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
            backgroundColor: theme.color.surface.base,
          }}
        >
          {!gone && (
            <Text variant="detail" tone="muted" align="center">
              {t("mobile.terminal.label.loading")}
            </Text>
          )}
        </View>
      ) : (
        <TerminalRows screen={screen} onGrid={onGrid} onTap={onTap} />
      )}
    </Screen>
  );
}

type Modifier = keyof Mods;

// The key bar in two rows. Ctrl, Alt and Shift hold for the next key, from the bar or the text box, then let go.
const ROWS: readonly (readonly (
  | { kind: "key"; key: BarKey; label: MessageKey; cap: string | null }
  | { kind: "mod"; mod: Modifier; label: MessageKey }
  | { kind: "bytes"; bytes: string; label: MessageKey }
  | { kind: "paste"; label: MessageKey }
)[])[] = [
  [
    { kind: "key", key: "escape", label: "mobile.terminal.key.escape", cap: null },
    { kind: "key", key: "tab", label: "mobile.terminal.key.tab", cap: null },
    { kind: "mod", mod: "ctrl", label: "mobile.terminal.key.ctrl" },
    { kind: "mod", mod: "alt", label: "mobile.terminal.key.alt" },
    { kind: "mod", mod: "shift", label: "mobile.terminal.key.shift" },
    { kind: "bytes", bytes: "\x03", label: "mobile.terminal.key.interrupt" },
  ],
  [
    { kind: "paste", label: "mobile.terminal.key.paste" },
    { kind: "key", key: "left", label: "mobile.terminal.key.left", cap: "←" },
    { kind: "key", key: "up", label: "mobile.terminal.key.up", cap: "↑" },
    { kind: "key", key: "down", label: "mobile.terminal.key.down", cap: "↓" },
    { kind: "key", key: "right", label: "mobile.terminal.key.right", cap: "→" },
    { kind: "key", key: "enter", label: "mobile.terminal.key.enter", cap: null },
  ],
];

/** The text box (its send types the text only, no Enter) and the key bar. */
function Typing({
  session,
  send,
  input,
}: {
  session: string;
  send: (text: string) => Promise<SourceResult<void>>;
  input: RefObject<ComponentRef<typeof TextInput> | null>;
}) {
  const { draft, save } = useSessionDraft(session);
  const text = draft.terminalText;
  const setText = (terminalText: string) => save({ terminalText });
  const [failed, setFailed] = useState(false);
  const [mods, setMods] = useState<Mods>(NO_MODS);
  const armed = mods.ctrl || mods.alt || mods.shift;
  const type = async (bytes: string) => {
    const done = await send(bytes);
    setFailed(!done.ok);
    return done.ok;
  };
  const submit = async () => {
    if (text === "") return;
    if (await type(text)) setText("");
  };
  // With a modifier held, one character typed in the box goes to the terminal with it instead of into the box.
  const change = (next: string) => {
    if (armed && next.length === text.length + 1 && next.startsWith(text)) {
      setMods(NO_MODS);
      void type(charBytes(next.slice(-1), mods));
      return;
    }
    setText(next);
  };
  const press = async (key: (typeof ROWS)[number][number]) => {
    if (key.kind === "mod") {
      setMods((now) => ({ ...now, [key.mod]: !now[key.mod] }));
      return;
    }
    setMods(NO_MODS);
    if (key.kind === "key") await type(barKeyBytes(key.key, mods));
    else if (key.kind === "bytes") await type(key.bytes);
    else {
      const pasted = await Clipboard.getStringAsync().catch(() => "");
      if (pasted !== "") await type(pasted);
    }
  };
  return (
    <View>
      <TypeBox
        value={text}
        onChangeText={change}
        onSend={() => void submit()}
        placeholder={t("mobile.terminal.placeholder.type")}
        sendLabel={t("mobile.terminal.button.send")}
        failed={failed ? t("mobile.terminal.error.send-failed") : null}
        input={input}
      />
      {ROWS.map((row, at) => (
        <KeyRow key={at} last={at === ROWS.length - 1}>
          {row.map((key) => (
            <KeyCap
              key={key.label}
              label={t(key.label)}
              on={key.kind === "mod" ? mods[key.mod] : undefined}
              onPress={() => void press(key)}
            >
              {key.kind === "paste" ? (
                <Icon icon={ClipboardPaste} size={16} tone="secondary" />
              ) : key.kind === "key" && key.cap !== null ? (
                key.cap
              ) : (
                t(key.label)
              )}
            </KeyCap>
          ))}
        </KeyRow>
      ))}
    </View>
  );
}
