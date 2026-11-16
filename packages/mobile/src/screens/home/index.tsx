// Home (tools/wireframes/drafts/phone/shell.tsx HomeScreen and Offline): what needs the person, the apps, what is working
// now, and a message box that starts a session in a workspace.
import { t } from "@lophn/i18n";
import {
  Dot,
  Icon,
  Label,
  Pill,
  Row,
  Screen,
  Text,
  Toast,
  TopBar,
} from "@lophn/ui-native";
import { ChevronRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { lophnIdOf } from "../../../../protocol/lophn-agent/workspaces.ts";
import { stateOf } from "../../app/computer-state.ts";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import {
  installedOf,
  type SessionStatus,
  useCurrentComputer,
  useInbox,
  useLocalApps,
  useNames,
  usePhoneApps,
  useWorkspaces,
  withLocalApps,
  type WorkspaceView,
} from "../../data/mod.ts";
import { ago, EmptyScreen, Face, LOPHN, SESSION_DOT } from "../../parts/mod.ts";
import { Apps } from "./apps.tsx";
import { HomeComposer } from "./compose.tsx";
import { frontOf, NeedsYou } from "./needs.tsx";
import { OfflineBody } from "./offline.tsx";

export function HomeScreen(_: { place: PlaceOf<"home"> }) {
  const nav = useNav();
  const computer = useCurrentComputer();
  const installed = installedOf(useLocalApps());
  const onPhone = new Set(installed.map((one) => one.app));
  const workspaces = withLocalApps(useWorkspaces(), installed);
  const names = useNames();
  const inbox = useInbox();
  const [failed, setFailed] = useState(false);

  const status = computer?.status ?? "offline";
  const online = status === "connected";
  // When the phone last heard from the computer: set the moment a connection ends.
  const [leftAt, setLeftAt] = useState<number | null>(null);
  useEffect(() => {
    if (status !== "connected") return;
    return () => setLeftAt(Date.now());
  }, [status]);

  const apps = workspaces.filter((workspace) => workspace.kind === "app");
  const working = workingOf(workspaces);
  const shown = online || computer === null;
  const empty =
    shown && inbox.count === 0 && apps.length === 0 && working.length === 0;
  const state = computer === null ? null : stateOf(computer);
  const name = computer?.name ?? "";

  return (
    <Screen
      top={
        <TopBar
          {...nav.menuButton}
          title={t("left-sidebar.label.home")}
          right={
            computer === null ? undefined : (
              <View style={{ marginRight: 8 }}>
                <Pill
                  lead={<Dot tone={state?.tone} />}
                  onPress={nav.openComputers}
                >
                  {name}
                </Pill>
              </View>
            )
          }
        />
      }
      scroll={!empty}
      footer={
        <HomeComposer
          workspaces={workspaces}
          locked={!online}
          unreachable={t("mobile.start.heading.unreachable", { name })}
          onStarted={(target) => nav.open({ name: "session", ...target })}
          onFailed={setFailed}
        />
      }
      over={
        failed ? <Toast>{t("waiting.notice.action-failed")}</Toast> : undefined
      }
    >
      {empty ? (
        <EmptyScreen title={t("waiting.notice.empty")}>
          {t("mobile.home.empty.caption")}
        </EmptyScreen>
      ) : shown ? (
        <Online
          apps={apps}
          onPhone={onPhone}
          working={working}
          workspaces={workspaces}
          inbox={inbox}
          names={names}
        />
      ) : (
        <OfflineBody
          apps={apps}
          onPhone={onPhone}
          onOpen={(app) => nav.open({ name: "app", id: app.key })}
          workspaces={workspaces}
          leftAt={leftAt}
        />
      )}
    </Screen>
  );
}

/** Every session working now, newest first, with its workspace. */
function workingOf(workspaces: readonly WorkspaceView[]) {
  return workspaces
    .flatMap((workspace) =>
      workspace.groups
        .flatMap((group) => group.rows)
        .filter((row) => row.status === "working")
        .map((row) => ({ row, workspace })),
    )
    .sort((a, b) => b.row.at - a.row.at);
}

function Online({
  apps,
  onPhone,
  working,
  workspaces,
  inbox,
  names,
}: {
  apps: readonly WorkspaceView[];
  onPhone: ReadonlySet<string>;
  working: ReturnType<typeof workingOf>;
  workspaces: readonly WorkspaceView[];
  inbox: ReturnType<typeof useInbox>;
  names: ReturnType<typeof useNames>;
}) {
  const nav = useNav();
  const now = Date.now();
  // An app with a phone screen or on this phone opens it; any other app opens its workspace.
  const phone = new Set([...usePhoneApps().apps.map((one) => one.app), ...onPhone]);
  return (
    <>
      {inbox.count > 0 && (
        <>
          <Label
            end={
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => nav.open({ name: "inbox" })}
                style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
              >
                <Text variant="small" weight="medium">
                  {t("mobile.home.button.inbox-count", { count: inbox.count })}
                </Text>
                <Icon icon={ChevronRight} size={15} />
              </Pressable>
            }
          >
            {t("mobile.home.heading.needs-you")}
          </Label>
          <NeedsYou
            entries={frontOf(inbox.entries)}
            inbox={inbox}
            names={names}
            workspaces={workspaces}
            onInbox={() => nav.open({ name: "inbox" })}
            onUpdate={(id) => nav.open({ name: "app-update", id })}
          />
        </>
      )}
      {apps.length > 0 && (
        <>
          <Label>{t("common.heading.apps")}</Label>
          <Apps
            apps={apps}
            onOpen={(app) =>
              app.workspace !== null &&
              nav.open(
                phone.has(app.key)
                  ? { name: "app", id: app.key }
                  : { name: "workspace", workspace: app.workspace },
              )
            }
          />
        </>
      )}
      {working.length > 0 && (
        <>
          <Label>{t("mobile.home.heading.working")}</Label>
          {working.map(({ row, workspace }) => (
            <Row
              key={row.id}
              lead={<Face profile={row.who?.profile ?? LOPHN} />}
              title={row.title ?? t("left-sidebar.label.untitled")}
              sub={[
                row.who?.name,
                workspace.name ?? t("left-sidebar.label.home"),
                row.at > 0 ? ago(row.at, now) : undefined,
              ]
                .filter((part) => part !== undefined)
                .join(" · ")}
              end={<Dot tone={SESSION_DOT[row.status]} />}
              onPress={() =>
                nav.open({
                  name: "session",
                  session: row.id,
                  agent: row.agent ?? lophnIdOf(row.workspace),
                  workspace: row.workspace,
                })
              }
            />
          ))}
        </>
      )}
    </>
  );
}
