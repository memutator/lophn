// The phone app's own settings (tools/wireframes/drafts/phone/more.tsx SettingsFlow): the paired computers, this
// phone, its look, and each computer's providers (providers.tsx). The rest of lophn's settings (agents, models) stay on the
// computer. Notifications is its own screen (src/push).
import { t } from "@lophn/i18n";
import {
  AgentTurn,
  Button,
  Divider,
  Dot,
  Group,
  Icon,
  Input,
  Label,
  Markdown,
  Menu,
  Row,
  Screen,
  SegmentedControl,
  Sheet,
  Text,
  TopBar,
  UserBubble,
  useTheme,
} from "@lophn/ui-native";
import * as Clipboard from "expo-clipboard";
import {
  ArrowLeftRight,
  Bell,
  ChevronRight,
  Copy,
  Info,
  type LucideIcon,
  Monitor,
  Palette,
  Plus,
  Shapes,
  Smartphone,
  Trash2,
} from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { Pressable, View } from "react-native";
import {
  type TextSize,
  type ThemeChoice,
  useAppearance,
} from "../../app/appearance.tsx";
import { stateOf } from "../../app/computer-state.ts";
import { formatSize } from "../../../../shell/renderer/editor/model.ts";
import { CARRY_LIMITS } from "../../apps/carry/carry.ts";
import { useCarry } from "../../apps/carry/native.ts";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import { Gallery } from "../../gallery/gallery.tsx";
import { type ComputerItem, useComputers } from "../../data/mod.ts";
import { Face, LOPHN } from "../../parts/mod.ts";
import { PHONE_NAME_MAX } from "../../pairing/store.ts";
import { usePush } from "../../push/provider.tsx";

export { ProvidersScreen } from "./providers.tsx";

function Lead({ icon }: { icon: LucideIcon }) {
  return (
    <View
      style={{
        width: 24,
        height: 24,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon icon={icon} />
    </View>
  );
}

const NEXT = <Icon icon={ChevronRight} size={16} />;

function Value({ children, next }: { children: ReactNode; next?: boolean }) {
  return (
    <>
      {typeof children === "string" ? (
        <Text variant="small">{children}</Text>
      ) : (
        children
      )}
      {next && NEXT}
    </>
  );
}

function State({ computer }: { computer: ComputerItem }) {
  const state = stateOf(computer);
  return (
    <>
      <Dot tone={state.tone} />
      <Text variant="small">{state.text}</Text>
    </>
  );
}

const THEMES: readonly ThemeChoice[] = ["system", "light", "dark"];
const THEME_LABEL = {
  system: "settings.label.mode-system",
  light: "settings.label.mode-light",
  dark: "settings.label.mode-dark",
} as const;
const SIZES: readonly TextSize[] = ["small", "default", "large"];
const SIZE_LABEL = {
  small: "settings.label.size-small",
  default: "settings.label.size-default",
  large: "settings.label.size-large",
} as const;

const LIMIT_LABEL = [
  "mobile.carry.limit.small",
  "mobile.carry.limit.medium",
  "mobile.carry.limit.large",
  "mobile.carry.limit.any",
] as const;

// Files the phone carries between the computers, and the biggest it carries over mobile data (apps/carry).
function Carrying() {
  const carry = useCarry();
  return (
    <>
      <Label>{t("mobile.carry.heading")}</Label>
      <Group>
        <Row
          lead={<Lead icon={ArrowLeftRight} />}
          title={t("mobile.carry.label.holding")}
          end={
            <Value>
              {t("mobile.carry.value.holding", {
                files: carry.files,
                size: formatSize(carry.bytes),
              })}
            </Value>
          }
        />
      </Group>
      <Label>{t("mobile.carry.label.limit")}</Label>
      <View style={{ paddingHorizontal: 20 }}>
        <SegmentedControl
          items={LIMIT_LABEL.map((key) => t(key))}
          on={CARRY_LIMITS.indexOf(carry.limit as (typeof CARRY_LIMITS)[number])}
          onChange={(at) => carry.setLimit(CARRY_LIMITS[at]!)}
        />
      </View>
      <Text
        variant="note"
        tone="muted"
        style={{ marginTop: 8, marginHorizontal: 20 }}
      >
        {t("mobile.carry.note")}
      </Text>
    </>
  );
}

// The product version (the root package.json), put in by metro.config.js when the app is bundled.
const VERSION = process.env.EXPO_PUBLIC_LOPHN_VERSION ?? "";

// A name typed in a sheet: Cancel and Save, with `extra` (a button that clears the name) above them. Save needs a name unless
// `saveEmpty` (empty puts the default back).
function NameSheet({
  open,
  title,
  value,
  placeholder,
  onChange,
  onClose,
  onSave,
  saveEmpty,
  extra,
}: {
  open: boolean;
  title: string;
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
  onClose: () => void;
  onSave: () => void;
  saveEmpty?: boolean;
  extra?: ReactNode;
}) {
  const ok = saveEmpty || value.trim() !== "";
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <View style={{ gap: 12, paddingHorizontal: 20, paddingBottom: 14 }}>
        <Input
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          autoFocus
          onSubmit={() => ok && onSave()}
        />
        {extra}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button block onPress={onClose}>
            {t("common.button.cancel")}
          </Button>
          <Button block variant="primary" disabled={!ok} onPress={onSave}>
            {t("settings.button.device-save")}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

export function SettingsScreen(_: { place: PlaceOf<"settings"> }) {
  const nav = useNav();
  const { computers, deviceName, setDeviceName } = useComputers();
  const { appearance } = useAppearance();
  const push = usePush();
  const [naming, setNaming] = useState<string | null>(null);
  return (
    <Screen
      tone="floor"
      top={
        <TopBar
          left="back"
          onLeft={nav.back}
          title={t("settings.title.screen")}
        />
      }
      scroll
    >
      <Label>{t("mobile.computer.heading.computers")}</Label>
      <Group>
        {computers.map((computer) => (
          <View key={computer.key}>
            <Row
              lead={<Lead icon={Monitor} />}
              title={computer.name}
              sub={<State computer={computer} />}
              end={NEXT}
              onPress={() => nav.open({ name: "computer", key: computer.key })}
            />
            <Divider />
          </View>
        ))}
        <Row
          lead={<Lead icon={Plus} />}
          title={t("mobile.computer.button.pair-another")}
          onPress={() => nav.open({ name: "pair" })}
        />
      </Group>
      <Label>{t("mobile.settings.heading.phone")}</Label>
      <Group>
        <Row
          lead={<Lead icon={Smartphone} />}
          title={t("settings.label.remote-device-name")}
          end={<Value next>{deviceName}</Value>}
          onPress={() => setNaming(deviceName)}
        />
        <Divider />
        <Row
          lead={<Lead icon={Bell} />}
          title={t("mobile.notifications.title.screen")}
          end={
            <Value next>
              {t(
                push.status === "on"
                  ? "settings.label.value-on"
                  : "settings.label.value-off",
              )}
            </Value>
          }
          onPress={() => nav.open({ name: "notifications" })}
        />
        <Divider />
        <Row
          lead={<Lead icon={Palette} />}
          title={t("settings.label.tab-appearance")}
          end={<Value next>{t(THEME_LABEL[appearance.theme])}</Value>}
          onPress={() => nav.open({ name: "appearance" })}
        />
      </Group>
      <Text
        variant="note"
        tone="muted"
        style={{ marginTop: 8, marginHorizontal: 20 }}
      >
        {t("mobile.settings.note.phone-name")}
      </Text>
      <NameSheet
        open={naming !== null}
        title={t("settings.label.remote-device-name")}
        value={naming ?? ""}
        onChange={(next) => setNaming(next.slice(0, PHONE_NAME_MAX))}
        onClose={() => setNaming(null)}
        onSave={() => {
          void setDeviceName(naming ?? "");
          setNaming(null);
        }}
        saveEmpty
      />
      <Carrying />
      <Label>{t("mobile.settings.heading.about")}</Label>
      <Group>
        <Row
          lead={<Lead icon={Info} />}
          title={t("mobile.settings.label.app")}
          end={<Value>{VERSION}</Value>}
        />
      </Group>
      {__DEV__ && (
        <View style={{ marginTop: 20 }}>
          <Group>
            <Row
              lead={<Lead icon={Shapes} />}
              title={t("mobile.settings.button.gallery")}
              end={NEXT}
              onPress={() => nav.open({ name: "gallery" })}
            />
          </Group>
        </View>
      )}
    </Screen>
  );
}

function short(key: string): string {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

// The wireframe's Remove is a plain button with red words; the kit's danger button is filled.
function RemoveButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const red = theme.color.status.critical.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        height: 42,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        borderWidth: 1,
        borderColor: theme.color.border.base,
        borderRadius: 10,
        backgroundColor: pressed
          ? theme.color.surface.muted
          : theme.color.surface.base,
      })}
    >
      <Icon icon={Trash2} size={17} color={red} />
      <Text variant="control" weight="medium" style={{ color: red }}>
        {t("mobile.computer.button.remove")}
      </Text>
    </Pressable>
  );
}

export function ComputerScreen({ place }: { place: PlaceOf<"computer"> }) {
  const nav = useNav();
  const { computers, rename, remove } = useComputers();
  const computer = computers.find((one) => one.key === place.key);
  const [naming, setNaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [copied, setCopied] = useState(false);
  if (computer === undefined) return null;
  return (
    <Screen
      tone="floor"
      top={<TopBar left="back" onLeft={nav.back} title={computer.name} />}
      scroll
      footer={
        computer.sample ? undefined : (
          <View
            style={{
              gap: 8,
              paddingTop: 12,
              paddingHorizontal: 20,
              paddingBottom: 10,
            }}
          >
            <RemoveButton onPress={() => setRemoving(true)} />
            <Text variant="note" tone="muted" align="center">
              {t("mobile.computer.note.remove")}
            </Text>
          </View>
        )
      }
    >
      <Label>{t("mobile.computer.heading.connection")}</Label>
      <Group>
        <Row
          title={t("mobile.computer.label.status")}
          end={<State computer={computer} />}
        />
        {computer.path !== null && (
          <>
            <Divider />
            <Row
              title={t("mobile.computer.label.path")}
              end={
                <Value>
                  {t(
                    computer.path === "relay"
                      ? "mobile.computer.path.relay"
                      : "mobile.computer.path.direct",
                  )}
                </Value>
              }
            />
          </>
        )}
      </Group>
      {computer.path === "relay" && (
        <Text
          variant="note"
          tone="muted"
          style={{ marginTop: 8, marginHorizontal: 20 }}
        >
          {t("mobile.computer.note.relay")}
        </Text>
      )}
      <Label>{t("mobile.computer.heading.setup")}</Label>
      <Group>
        <Row
          title={t("settings.label.tab-providers")}
          end={NEXT}
          onPress={() => nav.open({ name: "providers", key: computer.key })}
        />
      </Group>
      <Label>{t("mobile.computer.heading.on-phone")}</Label>
      <Group>
        <Row
          title={t("mobile.computer.label.shown-as")}
          sub={
            computer.alias !== null &&
            computer.announced !== null &&
            computer.alias !== computer.announced
              ? t("mobile.computer.label.announced-name", {
                  name: computer.announced,
                })
              : undefined
          }
          end={<Value next>{computer.name}</Value>}
          onPress={() => setNaming(computer.alias ?? "")}
        />
        <Divider />
        <Row
          title={t("mobile.computer.label.key")}
          end={
            <>
              <Text variant="caption" mono>
                {copied ? t("common.label.copied") : short(computer.key)}
              </Text>
              <Icon icon={Copy} size={15} />
            </>
          }
          onPress={() =>
            void Clipboard.setStringAsync(computer.key).then(() =>
              setCopied(true),
            )
          }
        />
      </Group>
      <NameSheet
        open={naming !== null}
        title={t("mobile.computer.label.shown-as")}
        value={naming ?? ""}
        placeholder={computer.announced ?? computer.name}
        onChange={setNaming}
        onClose={() => setNaming(null)}
        onSave={() => {
          rename(computer.key, naming);
          setNaming(null);
        }}
        extra={
          computer.alias !== null && (
            <Button
              block
              onPress={() => {
                rename(computer.key, null);
                setNaming(null);
              }}
            >
              {t("mobile.computer.button.use-computer-name")}
            </Button>
          )
        }
      />
      <Menu
        open={removing}
        onClose={() => setRemoving(false)}
        title={t("mobile.computer.heading.remove-confirm")}
        items={[
          {
            label: t("settings.button.device-remove"),
            icon: Trash2,
            danger: true,
            onSelect: () => {
              nav.back();
              remove(computer.key);
            },
          },
        ]}
      />
    </Screen>
  );
}

export function AppearanceScreen(_: { place: PlaceOf<"appearance"> }) {
  const nav = useNav();
  const { appearance, set } = useAppearance();
  return (
    <Screen
      tone="floor"
      top={
        <TopBar
          left="back"
          onLeft={nav.back}
          title={t("settings.label.tab-appearance")}
        />
      }
      scroll
    >
      <Label>{t("mobile.settings.label.theme")}</Label>
      <View style={{ paddingHorizontal: 20 }}>
        <SegmentedControl
          items={THEMES.map((one) => t(THEME_LABEL[one]))}
          on={THEMES.indexOf(appearance.theme)}
          onChange={(at) => set({ theme: THEMES[at] })}
        />
      </View>
      <Label>{t("settings.label.text-size")}</Label>
      <View style={{ paddingHorizontal: 20 }}>
        <SegmentedControl
          items={SIZES.map((one) => t(SIZE_LABEL[one]))}
          on={SIZES.indexOf(appearance.textSize)}
          onChange={(at) => set({ textSize: SIZES[at] })}
        />
      </View>
      <Label>{t("mobile.settings.heading.preview")}</Label>
      <PreviewCard />
      <Text
        variant="note"
        tone="muted"
        style={{ marginTop: 10, marginHorizontal: 20 }}
      >
        {t("mobile.settings.note.appearance")}
      </Text>
    </Screen>
  );
}

// Made-up words that show the theme and the text size (the wireframe's own example).
function PreviewCard() {
  const theme = useTheme();
  return (
    <View
      style={{
        marginHorizontal: 16,
        padding: 14,
        gap: 12,
        borderWidth: 1,
        borderColor: theme.color.border.subtle,
        borderRadius: 16,
        backgroundColor: theme.color.surface.base,
      }}
    >
      <UserBubble>Write this week’s eval report.</UserBubble>
      <AgentTurn face={<Face profile={LOPHN} size={20} />} name="lophn">
        <Markdown
          variant="chat"
          source="I wrote the report from the three findings. The regression share fell to **0.4%**."
        />
      </AgentTurn>
    </View>
  );
}

export function GalleryScreen(_: { place: PlaceOf<"gallery"> }) {
  const nav = useNav();
  return <Gallery onExit={nav.back} />;
}
