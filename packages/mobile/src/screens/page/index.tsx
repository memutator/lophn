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
  ChevronRight,
  EyeOff,
  Globe,
  KeyboardOff,
  RotateCw,
  WifiOff,
} from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import type { PageInput } from "../../../../protocol/lophn-agent/page-view.ts";
import { normalizeAddress } from "../../../../shell/main/browser/address.ts";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import {
  type PageItem,
  type PageView,
  type SourceResult,
  useCurrentComputer,
  useOpenPage,
  usePage,
  usePages,
} from "../../data/mod.ts";
import { DIM, EmptyNote, OfflineBanner, useLocked } from "../../parts/mod.ts";
import { KeyCap, KeyRow, NoticeLine, TypeBox, useForeground } from "../../parts/typing.tsx";
import { ReadFailed } from "../jobs/parts.tsx";
import { PagePicture } from "./picture.tsx";

const shortUrl = (url: string) => url.replace(/^https?:\/\//, "");

// ── list ─────────────────────────────────────────────

export function PagesScreen(_: { place: PlaceOf<"pages"> }) {
  const nav = useNav();
  const computer = useCurrentComputer()?.name ?? "";
  const locked = useLocked();
  const { loaded, reload } = usePages();
  const open = useOpenPage();
  const [address, setAddress] = useState("");
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    const url = normalizeAddress(address);
    if (url === null) return;
    const done = await open(url);
    setFailed(!done.ok);
    if (done.ok) {
      setAddress("");
      nav.open({ name: "page", tab: done.value });
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
        {loaded.state === "ready" && !loaded.value.control && (
          <NoticeLine icon={KeyboardOff}>
            {t("mobile.page.notice.view-only", { computer })}
          </NoticeLine>
        )}
        {loaded.state === "ready" && loaded.value.control && (
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
      <NoticeLine icon={Globe}>{t("mobile.page.notice.gone", { computer })}</NoticeLine>
    );
  } else if (page.status === "offline") {
    bottom = (
      <NoticeLine icon={WifiOff}>
        {t("mobile.page.notice.unreachable", { computer })}
      </NoticeLine>
    );
  } else if (control) {
    bottom = <Typing send={page.send} />;
  } else if (shot !== null) {
    bottom = (
      <NoticeLine icon={KeyboardOff}>
        {t("mobile.page.notice.view-only", { computer })}
      </NoticeLine>
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
  const [text, setText] = useState("");
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
      <TypeBox
        value={text}
        onChangeText={setText}
        onSend={() => void submit()}
        placeholder={t("mobile.page.placeholder.type")}
        sendLabel={t("mobile.page.button.send")}
        failed={failed ? t("mobile.page.error.send-failed") : null}
      />
      <KeyRow last>
        {KEYS.map((one) => (
          <KeyCap
            key={one.key}
            label={t(one.label)}
            onPress={() => void type({ type: "key", key: one.key })}
          >
            {one.cap ?? t(one.label)}
          </KeyCap>
        ))}
      </KeyRow>
    </View>
  );
}
