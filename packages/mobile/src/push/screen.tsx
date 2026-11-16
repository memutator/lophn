// Settings › Notifications (tools/wireframes/drafts/phone/more.tsx Notifications): what to be told about and how.
import { t } from "@lophn/i18n";
import {
  Button,
  Divider,
  Group,
  Label,
  Plain,
  Row,
  Screen,
  Switch,
  Text,
  TopBar,
} from "@lophn/ui-native";
import * as Notifications from "expo-notifications";
import { Bell } from "lucide-react-native";
import { Linking, View } from "react-native";
import { type PlaceOf, useNav } from "../app/nav.ts";
import { useCurrentComputer, useWorkspaces } from "../data/mod.ts";
import { type PushPrefs, usePush } from "./provider.tsx";

type Key = keyof PushPrefs;
type Words = Parameters<typeof t>[0];

// Text keys are literals so a typo fails the type check; `sub` is absent for "An app update waits".
const TELL: readonly (readonly [Key, Words, Words | null])[] = [
  ["needs_you", "mobile.notifications.label.needs-you", "mobile.notifications.sub.needs-you"],
  ["long_finish", "mobile.notifications.label.long-finish", "mobile.notifications.sub.long-finish"],
  ["app_update", "mobile.notifications.label.app-update", null],
  ["job_missed", "mobile.notifications.label.job-missed", null],
  ["app_notify", "mobile.notifications.label.app-notify", "mobile.notifications.sub.app-notify"],
];
const HOW: readonly (readonly [Key, Words, Words])[] = [
  ["quiet_when_present", "mobile.notifications.label.quiet-when-present", "mobile.notifications.sub.quiet-when-present"],
  ["show_names", "mobile.notifications.label.show-names", "mobile.notifications.sub.show-names"],
];

function Toggle({ field, title, sub }: { field: Key; title: Words; sub: Words | null }) {
  const { prefs, setPref } = usePush();
  return (
    <Row
      wrap
      onPress={() => setPref(field, !prefs[field])}
      title={t(title)}
      sub={
        field === "show_names" ? (
          // Showing names sends session titles through Expo and Google; say so beside the switch that does it.
          <View>
            <Text variant="small">{t("mobile.notifications.sub.show-names")}</Text>
            <Text variant="small">{t("mobile.notifications.sub.show-names-warning")}</Text>
          </View>
        ) : sub === null ? undefined : (
          t(sub)
        )
      }
      end={
        <Switch
          label={t(title)}
          on={prefs[field]}
          onChange={(on) => setPref(field, on)}
        />
      }
    />
  );
}

// Why notifications are not coming, and what the person can do about it.
function Status() {
  const { status, turnOn } = usePush();
  if (status === "on" || status === "loading") return null;
  const note =
    status === "denied"
      ? "mobile.notifications.denied.note"
      : status === "unavailable"
        ? "mobile.notifications.note.unavailable"
        : "mobile.notifications.note.off";
  return (
    <Plain style={{ marginHorizontal: 16, marginTop: 12, padding: 16, gap: 12 }}>
      <Text variant="small" tone="muted">
        {t(note)}
      </Text>
      {status === "denied" && (
        <Button icon={Bell} onPress={() => void Linking.openSettings()}>
          {t("mobile.notifications.button.open-settings")}
        </Button>
      )}
      {status === "off" && (
        <Button variant="primary" icon={Bell} onPress={() => void turnOn()}>
          {t("mobile.notifications.button.turn-on")}
        </Button>
      )}
    </Plain>
  );
}

// Dev builds only: a local notification with the data core would send, to try a tap without a push server.
function TestRow() {
  const computer = useCurrentComputer();
  const session = useWorkspaces()
    .flatMap((one) => one.groups.flatMap((group) => group.rows))
    .at(0)?.id;
  if (computer === null) return null;
  const send = () =>
    void Notifications.scheduleNotificationAsync({
      content: {
        title: t("mobile.notifications.test.title"),
        body: t("mobile.notifications.test.body"),
        data:
          session === undefined
            ? { host: computer.key, kind: "inbox" }
            : { host: computer.key, kind: "session", session },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 5,
        channelId: "needs-you",
      },
    });
  return (
    <>
      <Label>{t("mobile.notifications.heading.test")}</Label>
      <Group>
        <Row title={t("mobile.notifications.button.test")} onPress={send} />
      </Group>
      <Text variant="note" tone="muted" style={{ marginTop: 8, marginHorizontal: 20 }}>
        {t("mobile.notifications.note.test")}
      </Text>
    </>
  );
}

export function NotificationsScreen(_: { place: PlaceOf<"notifications"> }) {
  const nav = useNav();
  return (
    <Screen
      tone="floor"
      top={
        <TopBar
          left="back"
          onLeft={nav.back}
          title={t("mobile.notifications.title.screen")}
        />
      }
      scroll
    >
      <Status />
      <Label>{t("mobile.notifications.heading.tell-me-when")}</Label>
      <Group>
        {TELL.map(([field, title, sub], at) => (
          <View key={field}>
            {at > 0 && <Divider />}
            <Toggle field={field} title={title} sub={sub} />
          </View>
        ))}
      </Group>
      <Label>{t("mobile.notifications.heading.how")}</Label>
      <Group>
        {HOW.map(([field, title, sub], at) => (
          <View key={field}>
            {at > 0 && <Divider />}
            <Toggle field={field} title={title} sub={sub} />
          </View>
        ))}
      </Group>
      <Text variant="note" tone="muted" style={{ marginTop: 8, marginHorizontal: 20 }}>
        {t("mobile.notifications.note.footer")}
      </Text>
      {__DEV__ && <TestRow />}
    </Screen>
  );
}
