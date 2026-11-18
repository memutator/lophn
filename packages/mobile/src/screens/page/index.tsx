// The computer's browser pages (tools/wireframes/drafts/phone/page.tsx): the list with a field that opens a new one, and
// one page: its address with back and reload, who drives it with Take control or Hand back, its picture, and a text box
// with a key row. A phone the computer does not let type in terminals sees the same without anything that uses the page.
// Watching stops in the background.
import { type MessageKey, t } from "@lophn/i18n";
import {
  Button,
  Icon,
  IconButton,
  Input,
  Label,
  Row,
  Screen,
  Tag,
  Text,
  TopBar,
  useTheme,
} from "@lophn/ui-native";
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  EyeOff,
  Globe,
  KeyboardOff,
  RotateCw,
  WifiOff,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { AppState, Pressable, TextInput, View } from "react-native";
import type { PageInput } from "../../../../protocol/lophn-agent/page-view.ts";
import { normalizeAddress } from "../../../../shell/main/browser/address.ts";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import { type SourceResult, useCurrentComputer } from "../../data/mod.ts";
import {
  type PageItem,
  type PageView,
  useOpenPage,
  usePage,
  usePages,
} from "../../data/page.ts";
import { DIM, EmptyNote, OfflineBanner, useLocked } from "../../parts/mod.ts";
import { ReadFailed } from "../jobs/parts.tsx";
import { PagePicture } from "./picture.tsx";

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

const shortUrl = (url: string) => url.replace(/^https?:\/\//, "");

// ── list ─────────────────────────────────────────────

export function PagesScreen(_: { place: PlaceOf<"pages"> }) {
  const nav = useNav();
  const computer = useCurrentComputer()?.name ?? "";
  const locked = useLocked();
  const { loaded, reload } = usePages();
  const open = useOpenPage();
  const [address, setAddress] = useState("");
  // The list does not say whether this phone may open pages; the first refusal does, and the field gives way to why.
  const [watchOnly, setWatchOnly] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    const url = normalizeAddress(address);
    if (url === null) return;
    const done = await open(url);
    setFailed(!done.ok && done.code !== "forbidden");
    if (done.ok) {
      setAddress("");
      nav.open({ name: "page", tab: done.value });
    } else if (done.code === "forbidden") {
      setWatchOnly(true);
    }
  };

  const row = (page: PageItem) => (
    <Row
      key={page.tab}
      lead={<Icon icon={Globe} size={22} tone="muted" />}
      title={page.title === "" ? shortUrl(page.url) : page.title}
      sub={shortUrl(page.url)}
      end={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text variant="note" tone="muted" numberOfLines={1}>
            {page.by ?? t("mobile.page.label.you")}
          </Text>
          <Icon icon={ChevronRight} size={16} />
        </View>
      }
      onPress={() => nav.open({ name: "page", tab: page.tab })}
    />
  );

  return (
    <Screen
      top={
        <TopBar
          {...nav.menuButton}
          title={t("mobile.page.title")}
          under={computer === "" ? undefined : computer}
        />
      }
      scroll
    >
      <OfflineBanner note={t("mobile.offline.note")} />
      <View style={{ opacity: locked ? DIM : 1 }}>
        {watchOnly ? (
          <Line icon={KeyboardOff}>
            {t("mobile.page.notice.view-only", { computer })}
          </Line>
        ) : (
          <View style={{ paddingTop: 4, paddingHorizontal: 20, paddingBottom: 8 }}>
            <Input
              value={address}
              onChangeText={setAddress}
              placeholder={t("mobile.page.placeholder.open", { computer })}
              icon={Globe}
              compact
              keyboardType="url"
              onSubmit={() => void submit()}
            />
            {failed && (
              <Text
                variant="caption"
                tone="critical"
                style={{ marginTop: 4, marginLeft: 4 }}
              >
                {t("mobile.page.error.open-failed", { computer })}
              </Text>
            )}
          </View>
        )}
        {loaded.state === "failed" && (
          <ReadFailed target={t("mobile.page.title")} onRetry={reload} />
        )}
        {loaded.state === "ready" && (
          <>
            <Label>{t("mobile.page.label.open-on", { computer })}</Label>
            {loaded.value.pages.length === 0 ? (
              <EmptyNote>{t("mobile.page.empty", { computer })}</EmptyNote>
            ) : (
              loaded.value.pages.map(row)
            )}
          </>
        )}
      </View>
    </Screen>
  );
}

// ── one page ─────────────────────────────────────────

export function PageScreen({ place }: { place: PlaceOf<"page"> }) {
  const nav = useNav();
  const theme = useTheme();
  const computer = useCurrentComputer()?.name ?? "";
  const page = usePage(useForeground() ? place.tab : null);
  const shot = page.snapshot;
  const control = shot?.control ?? false;
  const send = (input: PageInput) => void page.send(input);

  let bottom = null;
  if (page.status === "gone") {
    bottom = (
      <Line icon={Globe}>{t("mobile.page.notice.gone", { computer })}</Line>
    );
  } else if (page.status === "offline") {
    bottom = (
      <Line icon={WifiOff}>
        {t("mobile.page.notice.unreachable", { computer })}
      </Line>
    );
  } else if (control) {
    bottom = <Typing send={page.send} />;
  } else if (shot !== null) {
    bottom = (
      <Line icon={KeyboardOff}>
        {t("mobile.page.notice.view-only", { computer })}
      </Line>
    );
  }

  return (
    <Screen
      top={
        <>
          <TopBar
            left="back"
            onLeft={nav.back}
            title={shot === null ? "" : shot.title === "" ? shortUrl(shot.url) : shot.title}
            under={computer === "" ? undefined : computer}
            right={
              shot !== null && !control ? (
                <View style={{ marginRight: 14 }}>
                  <Tag>{t("mobile.terminal.label.view-only")}</Tag>
                </View>
              ) : undefined
            }
          />
          <OfflineBanner note={t("mobile.offline.note")} />
          {shot !== null && (
            <Address url={shot.url} control={control} send={send} />
          )}
          {shot !== null && (shot.agent || shot.held) && (
            <Driver page={page} />
          )}
        </>
      }
      footer={bottom}
    >
      {shot?.frame == null ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          {page.status !== "gone" && (
            <Text variant="detail" tone="muted" align="center">
              {t("mobile.page.label.loading")}
            </Text>
          )}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <PagePicture
            frame={shot.frame}
            dim={!shot.painting}
            onInput={control ? send : null}
          />
          {!shot.painting && (
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 24,
                right: 24,
                top: 0,
                bottom: 0,
                justifyContent: "center",
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  gap: 10,
                  alignItems: "flex-start",
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  backgroundColor: theme.color.surface.base,
                  boxShadow: theme.shadow.popover,
                }}
              >
                <View style={{ marginTop: 1 }}>
                  <Icon icon={EyeOff} size={18} />
                </View>
                <Text variant="detail" grow>
                  {t("mobile.page.notice.not-painting", { computer })}
                </Text>
              </View>
            </View>
          )}
        </View>
      )}
    </Screen>
  );
}

/** Back, the address and Reload; a phone that may only watch sees the address alone. */
function Address({
  url,
  control,
  send,
}: {
  url: string;
  control: boolean;
  send: (input: PageInput) => void;
}) {
  const theme = useTheme();
  // What the person is writing; null shows the page's address.
  const [draft, setDraft] = useState<string | null>(null);
  if (!control) {
    return (
      <View style={{ paddingTop: 2, paddingHorizontal: 20, paddingBottom: 8 }}>
        <View
          style={{
            minHeight: 40,
            justifyContent: "center",
            paddingHorizontal: 14,
            borderRadius: 12,
            backgroundColor: theme.color.surface.muted,
          }}
        >
          <Text tone="secondary" numberOfLines={1}>
            {shortUrl(url)}
          </Text>
        </View>
      </View>
    );
  }
  const go = () => {
    const next = normalizeAddress(draft ?? "");
    setDraft(null);
    if (next !== null) send({ type: "navigate", url: next });
  };
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingTop: 2,
        paddingHorizontal: 8,
        paddingBottom: 8,
      }}
    >
      <IconButton
        icon={ArrowLeft}
        label={t("browser.button.back")}
        size={20}
        onPress={() => send({ type: "back" })}
      />
      <View style={{ flex: 1 }}>
        <Input
          value={draft ?? url}
          onChangeText={setDraft}
          placeholder={t("browser.label.address-placeholder")}
          soft
          compact
          keyboardType="url"
          onSubmit={go}
        />
      </View>
      <IconButton
        icon={RotateCw}
        label={t("browser.button.reload")}
        size={20}
        onPress={() => send({ type: "reload" })}
      />
    </View>
  );
}

/** Who drives the page now, and at the right end the button that changes it (only for a phone that may use the page). */
function Driver({ page }: { page: PageView }) {
  const shot = page.snapshot;
  if (shot === null) return null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 20,
        paddingBottom: 8,
      }}
    >
      <Text variant="detail" grow>
        {shot.held
          ? t("browser.text.agent-held")
          : shot.by === null
            ? t("browser.text.agent-controlling")
            : t("mobile.page.text.agent-using", { agent: shot.by })}
      </Text>
      {shot.control && (
        <Button size="sm" onPress={() => void page.control(!shot.held)}>
          {t(shot.held ? "browser.button.agent-release" : "browser.button.agent-take")}
        </Button>
      )}
    </View>
  );
}

/** One quiet line: why the phone cannot use the page, or why the picture is not live. */
function Line({ icon, children }: { icon: typeof KeyboardOff; children: string }) {
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

// The key row. Names are the ones the computer's `press` takes (shell/main/browser/agent/keys.ts).
const KEYS: readonly { key: string; label: MessageKey; cap: string | null }[] = [
  { key: "Enter", label: "mobile.terminal.key.enter", cap: null },
  { key: "Backspace", label: "mobile.page.key.backspace", cap: "⌫" },
  { key: "Tab", label: "mobile.terminal.key.tab", cap: null },
  { key: "ArrowLeft", label: "mobile.terminal.key.left", cap: "←" },
  { key: "ArrowUp", label: "mobile.terminal.key.up", cap: "↑" },
  { key: "ArrowDown", label: "mobile.terminal.key.down", cap: "↓" },
  { key: "ArrowRight", label: "mobile.terminal.key.right", cap: "→" },
];

/** The text box (its send types the text only, no Enter) and the key row. */
function Typing({
  send,
}: {
  send: (input: PageInput) => Promise<SourceResult<void>>;
}) {
  const theme = useTheme();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [failed, setFailed] = useState(false);
  const type = async (input: PageInput) => {
    const done = await send(input);
    setFailed(!done.ok);
    return done.ok;
  };
  const submit = async () => {
    if (text === "") return;
    if (await type({ type: "text", text })) setText("");
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
            placeholder={t("mobile.page.placeholder.type")}
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
            accessibilityLabel={t("mobile.page.button.send")}
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
            {t("mobile.page.error.send-failed")}
          </Text>
        )}
      </View>
      <View
        style={{
          flexDirection: "row",
          gap: 5,
          paddingTop: 6,
          paddingHorizontal: 12,
          paddingBottom: 8,
        }}
      >
        {KEYS.map((one) => (
          <Pressable
            key={one.key}
            accessibilityRole="button"
            accessibilityLabel={t(one.label)}
            onPress={() => void type({ type: "key", key: one.key })}
            style={({ pressed }) => ({
              flexGrow: 1,
              flexShrink: 1,
              flexBasis: 0,
              height: 34,
              paddingHorizontal: 4,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: theme.color.border.base,
              borderRadius: 8,
              backgroundColor: pressed
                ? theme.color.surface.muted
                : theme.color.surface.base,
            })}
          >
            <Text variant="small" weight="medium" tone="secondary" numberOfLines={1}>
              {one.cap ?? t(one.label)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
