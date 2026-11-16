// A coding session's terminal on the computer, as the phone sees it (tools/wireframes/drafts/phone/coding.tsx Term): the
// screen's text and colors, Fit width or 100% with sideways scroll, and under it either the line that typing is off for
// this phone or a text box and a key bar. The phone never resizes the terminal; watching stops in the background.
import { t } from "@lophn/i18n";
import {
  Icon,
  Screen,
  SegmentedControl,
  Tag,
  Text,
  TopBar,
  useTheme,
} from "@lophn/ui-native";
import {
  ArrowUp,
  KeyboardOff,
  SquareTerminal,
  WifiOff,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { AppState, Pressable, TextInput, View } from "react-native";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import {
  type SourceResult,
  useCodingSessions,
  useCurrentComputer,
  useTerminal,
} from "../../data/mod.ts";
import { Face, OfflineBanner } from "../../parts/mod.ts";
import { harnessProfile } from "../coding/index.tsx";
import { TerminalRows } from "./rows.tsx";

function useForeground(): boolean {
  const [on, setOn] = useState(AppState.currentState !== "background");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setOn(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  return on;
}

export function TerminalScreen({ place }: { place: PlaceOf<"terminal"> }) {
  const nav = useNav();
  const theme = useTheme();
  const computer = useCurrentComputer()?.name ?? "";
  const coding = useCodingSessions(place.project);
  const row =
    coding.sessions.find((one) => one.session === place.session) ?? null;
  const foreground = useForeground();
  const view = useTerminal(foreground && row !== null ? row.terminal : null);
  const [fit, setFit] = useState(false);
  const gone =
    view.status === "gone" || (coding.status === "ready" && row === null);
  const screen = view.screen;

  let bottom = null;
  if (gone) {
    bottom = (
      <Line icon={SquareTerminal}>
        {t("mobile.terminal.notice.gone", { computer })}
      </Line>
    );
  } else if (view.status === "offline") {
    bottom = (
      <Line icon={WifiOff}>
        {t("mobile.terminal.notice.unreachable", { computer })}
      </Line>
    );
  } else if (view.input) {
    bottom = <Typing send={view.send} />;
  } else if (screen !== null) {
    bottom = (
      <Line icon={KeyboardOff}>{t("mobile.terminal.notice.typing-off")}</Line>
    );
  }

  return (
    <Screen
      top={
        <>
          <TopBar
            left="back"
            onLeft={nav.back}
            lead={
              row === null ? undefined : (
                <Face profile={harnessProfile(row.harness, row.label)} size={26} />
              )
            }
            title={row?.label ?? t("terminal.label.output")}
            sub={row?.title ?? undefined}
            right={
              screen !== null && !view.input ? (
                <View style={{ marginRight: 14 }}>
                  <Tag>{t("mobile.terminal.label.view-only")}</Tag>
                </View>
              ) : undefined
            }
          />
          <OfflineBanner note={t("mobile.offline.note")} />
        </>
      }
      footer={
        <View>
          <View style={{ width: 200, paddingTop: 6, paddingHorizontal: 12, paddingBottom: 4 }}>
            <SegmentedControl
              items={[
                t("mobile.terminal.button.fit-width"),
                t("mobile.terminal.button.actual-size"),
              ]}
              on={fit ? 0 : 1}
              onChange={(at) => setFit(at === 0)}
            />
          </View>
          {bottom}
        </View>
      }
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
        <TerminalRows screen={screen} fit={fit} />
      )}
    </Screen>
  );
}

/** One quiet line under the screen: why the phone cannot type, or why the screen is not live. */
function Line({
  icon,
  children,
}: {
  icon: typeof KeyboardOff;
  children: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        paddingTop: 6,
        paddingHorizontal: 20,
        paddingBottom: 10,
      }}
    >
      <View style={{ marginTop: 1 }}>
        <Icon icon={icon} size={16} tone="muted" />
      </View>
      <Text variant="note" tone="muted" grow>
        {children}
      </Text>
    </View>
  );
}

// What each key sends: the bytes a terminal keyboard sends for it.
const KEYS = [
  { label: "mobile.terminal.key.escape", cap: null, bytes: "\x1b" },
  { label: "mobile.terminal.key.tab", cap: null, bytes: "\t" },
  { label: "mobile.terminal.key.interrupt", cap: null, bytes: "\x03" },
  { label: "mobile.terminal.key.up", cap: "↑", bytes: "\x1b[A" },
  { label: "mobile.terminal.key.down", cap: "↓", bytes: "\x1b[B" },
  { label: "mobile.terminal.key.left", cap: "←", bytes: "\x1b[D" },
  { label: "mobile.terminal.key.right", cap: "→", bytes: "\x1b[C" },
  { label: "mobile.terminal.key.enter", cap: null, bytes: "\r" },
] as const;

/** The text box (its send types the text only, no Enter) and the key bar. */
function Typing({
  send,
}: {
  send: (text: string) => Promise<SourceResult<void>>;
}) {
  const theme = useTheme();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [failed, setFailed] = useState(false);
  const type = async (bytes: string) => {
    const done = await send(bytes);
    setFailed(!done.ok);
    return done.ok;
  };
  const submit = async () => {
    if (text === "") return;
    if (await type(text)) setText("");
  };
  return (
    <View>
      <View style={{ paddingTop: 6, paddingHorizontal: 12 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minHeight: 44,
            paddingLeft: 14,
            paddingRight: 6,
            borderWidth: 1,
            borderColor: focused ? theme.color.focus : theme.color.border.base,
            borderRadius: 12,
            backgroundColor: theme.color.surface.base,
          }}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("mobile.terminal.placeholder.type")}
            placeholderTextColor={theme.color.text.muted}
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => void submit()}
            submitBehavior="submit"
            cursorColor={theme.color.text.primary}
            selectionColor={theme.color.ink.soft}
            style={{
              flex: 1,
              minWidth: 0,
              padding: 0,
              fontFamily: theme.font.sans,
              ...theme.type.body,
              color: theme.color.text.primary,
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("mobile.terminal.button.send")}
            disabled={text === ""}
            onPress={() => void submit()}
            hitSlop={4}
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor:
                text === "" ? theme.color.surface.muted : theme.color.ink.background,
            }}
          >
            <Icon
              icon={ArrowUp}
              size={20}
              strokeWidth={2}
              color={text === "" ? theme.color.text.disabled : theme.color.ink.text}
            />
          </Pressable>
        </View>
        {failed && (
          <Text variant="caption" tone="critical" style={{ marginTop: 4, marginLeft: 4 }}>
            {t("mobile.terminal.error.send-failed")}
          </Text>
        )}
      </View>
      <View style={{ flexDirection: "row", gap: 5, paddingTop: 6, paddingHorizontal: 12, paddingBottom: 8 }}>
        {KEYS.map((key) => (
          <Pressable
            key={key.label}
            accessibilityRole="button"
            accessibilityLabel={t(key.label)}
            onPress={() => void type(key.bytes)}
            style={({ pressed }) => ({
              flexGrow: 1,
              flexShrink: 1,
              height: 34,
              paddingHorizontal: 6,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: theme.color.border.base,
              borderRadius: 8,
              backgroundColor: pressed ? theme.color.surface.muted : theme.color.surface.base,
            })}
          >
            <Text variant="small" weight="medium" tone="secondary" numberOfLines={1}>
              {key.cap ?? t(key.label)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
