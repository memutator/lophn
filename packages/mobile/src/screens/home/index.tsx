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
  type SessionStatus,
  useComputers,
  useCurrentComputer,
  useInbox,
  useNames,
  useWorkspaces,
} from "../../data/mod.ts";
import { Face, LOPHN } from "../../parts/mod.ts";
import { ago } from "./ago.ts";
import { Apps } from "./apps.tsx";
import { HomeComposer } from "./compose.tsx";
import { frontOf, NeedsYou } from "./needs.tsx";
import { OfflineBody } from "./offline.tsx";

export function HomeScreen(_: { place: PlaceOf<"home"> }) {
  const nav = useNav();
  const computer = useCurrentComputer();
  const { retry } = useComputers();
  const workspaces = useWorkspaces();
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
      scroll
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
      {online || computer === null ? (
        <Online
          apps={apps}
          workspaces={workspaces}
          inbox={inbox}
          names={names}
        />
      ) : (
        <OfflineBody
          computer={computer}
          apps={apps}
          workspaces={workspaces}
          leftAt={leftAt}
          onRetry={retry}
        />
      )}
    </Screen>
  );
}

const DOT: Partial<Record<SessionStatus, "good">> = { working: "good" };

function Online({
  apps,
  workspaces,
  inbox,
  names,
}: {
  apps: ReturnType<typeof useWorkspaces>;
  workspaces: ReturnType<typeof useWorkspaces>;
  inbox: ReturnType<typeof useInbox>;
  names: ReturnType<typeof useNames>;
}) {
  const nav = useNav();
  const now = Date.now();
  const working = workspaces
    .flatMap((workspace) =>
      workspace.groups
        .flatMap((group) => group.rows)
        .filter((row) => row.status === "working")
        .map((row) => ({ row, workspace })),
    )
    .sort((a, b) => b.row.at - a.row.at);
  if (inbox.count === 0 && apps.length === 0 && working.length === 0) {
    return (
      <View
        style={{
          alignItems: "center",
          paddingTop: 120,
          paddingHorizontal: 40,
          gap: 6,
        }}
      >
        <Text weight="medium" align="center">
          {t("waiting.notice.empty")}
        </Text>
        <Text variant="detail" tone="muted" align="center">
          {t("mobile.home.empty.caption")}
        </Text>
      </View>
    );
  }
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
              nav.open({ name: "workspace", workspace: app.workspace })
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
              end={<Dot tone={DOT[row.status]} />}
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
