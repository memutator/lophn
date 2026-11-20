// Home (tools/wireframes/drafts/phone/shell.tsx HomeScreen and Offline) over every computer the list shows: what needs the
// person, the apps, what is working now, and a message box that starts a session in a workspace. While more than one
// computer shows each line says its computer, and a computer that is not reached is one line on top that opens its own
// Home. With one computer shown and away, Home is that computer's offline page. A line opens on its own computer.
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
  useTheme,
} from "@lophn/ui-native";
import { ChevronRight, Monitor } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { lophnIdOf } from "../../../../protocol/lophn-agent/workspaces.ts";
import { filterStateOf, stateOf } from "../../app/computer-state.ts";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import {
  type ComputerItem,
  type ComputerLines,
  ComputerScope,
  useComputers,
  useEveryComputer,
  type WorkspaceView,
} from "../../data/mod.ts";
import { ago, EmptyScreen, Face, LOPHN, SessionDot, unreachableOf } from "../../parts/mod.ts";
import { type AppTile, Apps } from "./apps.tsx";
import { type Choice, choiceKey, HomeComposer } from "./compose.tsx";
import { NewAppSheet } from "./new-app.tsx";
import { frontOf, NeedsYou } from "./needs.tsx";
import { OfflineBody } from "./offline.tsx";

export function HomeScreen(_: { place: PlaceOf<"home"> }) {
  const nav = useNav();
  const { computers, disputed, current } = useComputers();
  const { shown, many, filter } = useEveryComputer();
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const reached = shown.filter((one) => one.computer.status === "connected");
  const away = shown.filter((one) => one.computer.status !== "connected");
  // One computer shown and away: its own offline page.
  const alone = !many && away.length === 1 ? away[0]! : null;

  const choices = reached.flatMap((lines) =>
    lines.workspaces.map(
      (workspace): Choice => ({
        computer: lines.computer.key,
        tag: many ? lines.computer.name : null,
        workspace,
      }),
    ),
  );
  // The Home of the computer on screen until the person picks another workspace.
  const choice =
    choices.find((one) => choiceKey(one) === picked) ??
    choices.find((one) => one.computer === current && one.workspace.kind === "home") ??
    choices[0];
  const quiet = computers.find((one) => one.key === (choice?.computer ?? current)) ?? null;

  // The filter on the top bar: the computer it shows (or the only one), else every computer.
  const one =
    computers.find((each) => each.key === filter) ??
    (computers.length === 1 ? computers[0]! : null);
  const filterState =
    one === null
      ? filterStateOf(computers)
      : stateOf(one, disputed.has(one.key));
  const [creating, setCreating] = useState(false);
  const startApp = () => setCreating(true);
  const empty =
    alone === null &&
    away.length === 0 &&
    reached.every(
      (lines) =>
        lines.computer.waiting === 0 &&
        !lines.workspaces.some((workspace) => workspace.kind === "app") &&
        workingOf([lines]).length === 0,
    );

  return (
    <Screen
      top={
        <TopBar
          {...nav.menuButton}
          title={t("left-sidebar.label.home")}
          right={
            <View style={{ marginRight: 8 }}>
              <Pill lead={<Dot tone={filterState.tone} />} onPress={nav.openComputers}>
                {one?.name ?? t("mobile.computer.filter.all")}
              </Pill>
            </View>
          }
        />
      }
      scroll={!empty}
      footer={
        <ComputerScope computer={choice?.computer ?? current ?? ""}>
          <HomeComposer
            choices={choices}
            picked={choice}
            onPick={(next) => setPicked(choiceKey(next))}
            locked={choice === undefined}
            unreachable={quiet === null ? "" : unreachableOf(quiet)}
            onStarted={(target) =>
              choice !== undefined && nav.openOn(choice.computer, { name: "session", ...target })
            }
            onFailed={setFailed}
          />
        </ComputerScope>
      }
      over={
        failed ? <Toast>{t("waiting.notice.action-failed")}</Toast> : undefined
      }
    >
      <NewAppSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={(text) =>
          choice !== undefined &&
          nav.openOn(choice.computer, { name: "new-session", workspace: null, text })
        }
      />
      {empty ? (
        <EmptyScreen title={t("waiting.notice.empty")}>
          {t("mobile.home.empty.caption")}
        </EmptyScreen>
      ) : alone !== null ? (
        <ComputerScope computer={alone.computer.key}>
          <Alone lines={alone} />
        </ComputerScope>
      ) : (
        <Lines reached={reached} away={away} many={many} onNewApp={startApp} />
      )}
    </Screen>
  );
}

/** The one computer shown, while it is away. */
function Alone({ lines }: { lines: ComputerLines }) {
  const nav = useNav();
  const { status } = lines.computer;
  // When the phone last heard from the computer: set the moment a connection ends.
  const [leftAt, setLeftAt] = useState<number | null>(null);
  useEffect(() => {
    if (status !== "connected") return;
    return () => setLeftAt(Date.now());
  }, [status]);
  return (
    <OfflineBody
      lines={lines}
      onOpen={(tile) => nav.openOn(tile.computer, { name: "app", id: tile.app.key })}
      leftAt={leftAt}
    />
  );
}

/** Every session working now on the reached computers, newest first, with its workspace and computer. */
function workingOf(reached: readonly ComputerLines[]) {
  return reached
    .flatMap(({ computer, workspaces }) =>
      workspaces.flatMap((workspace) =>
        workspace.groups
          .flatMap((group) => group.rows)
          .filter((row) => row.status === "working")
          .map((row) => ({ row, workspace, computer })),
      ),
    )
    .sort((a, b) => b.row.at - a.row.at);
}

function Lines({
  reached,
  away,
  many,
  onNewApp,
}: {
  reached: readonly ComputerLines[];
  away: readonly ComputerLines[];
  many: boolean;
  onNewApp: () => void;
}) {
  const nav = useNav();
  const { setFilter } = useEveryComputer();
  const now = Date.now();
  const needs = frontOf(reached);
  const waiting = reached.reduce((sum, one) => sum + one.computer.waiting, 0);
  // An app with a phone screen or on this phone opens it, one whose only phone screen is in its running preview opens
  // the preview, and any other app opens its workspace.
  const apps = reached.flatMap((lines) =>
    lines.workspaces
      .filter((one) => one.kind === "app")
      .map(
        (app): AppTile => ({
          computer: lines.computer.key,
          app,
          preview: lines.phone.get(app.key) === "preview",
          dim: false,
        }),
      ),
  );
  const phoneOf = (tile: AppTile) =>
    reached.find((one) => one.computer.key === tile.computer)?.phone.get(tile.app.key);
  const working = workingOf(reached);
  return (
    <>
      {away.map(({ computer }) => (
        <Away
          key={computer.key}
          computer={computer}
          // Its own Home says why it is away and has Try again.
          onPress={() => {
            setFilter(computer.key);
            nav.openOn(computer.key, { name: "home" });
          }}
        />
      ))}
      {waiting > 0 && (
        <>
          <Label
            end={
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() =>
                  nav.openOn(needs[0]?.lines.computer.key ?? reached[0]!.computer.key, { name: "inbox" })
                }
                style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
              >
                <Text variant="small" weight="medium">
                  {t("mobile.home.button.inbox-count", { count: waiting })}
                </Text>
                <Icon icon={ChevronRight} size={15} />
              </Pressable>
            }
          >
            {t("mobile.home.heading.needs-you")}
          </Label>
          <NeedsYou
            needs={needs}
            many={many}
            onInbox={(computer) => nav.openOn(computer, { name: "inbox" })}
            onUpdate={(computer, id) => nav.openOn(computer, { name: "app-update", id })}
          />
        </>
      )}
      {reached.length > 0 && (
        <>
          <Label
            end={
              <Pressable accessibilityRole="button" hitSlop={8} onPress={onNewApp}>
                <Text variant="small" weight="medium">
                  {t("home.button.new-app")}
                </Text>
              </Pressable>
            }
          >
            {t("common.heading.apps")}
          </Label>
          {reached.length > 0 && (
            <Apps
              apps={apps}
              onNewApp={onNewApp}
              onOpen={(tile) => {
                const phone = phoneOf(tile);
                if (tile.app.workspace === null) return;
                nav.openOn(
                  tile.computer,
                  phone === "screen"
                    ? { name: "app", id: tile.app.key }
                    : phone === "preview"
                      ? { name: "app", id: tile.app.key, preview: true }
                      : { name: "workspace", workspace: tile.app.workspace },
                );
              }}
            />
          )}
        </>
      )}
      {working.length > 0 && (
        <>
          <Label>{t("mobile.home.heading.working")}</Label>
          {working.map(({ row, workspace, computer }) => (
            <Row
              key={`${computer.key}:${row.id}`}
              lead={<Face profile={row.who?.profile ?? LOPHN} />}
              title={row.title ?? t("left-sidebar.label.untitled")}
              sub={[
                row.who?.name,
                nameOf(workspace),
                many ? computer.name : undefined,
                row.at > 0 ? ago(row.at, now) : undefined,
              ]
                .filter((part) => part !== undefined)
                .join(" · ")}
              end={<SessionDot status={row.status} />}
              onPress={() =>
                nav.openOn(computer.key, {
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

const nameOf = (workspace: WorkspaceView) => workspace.name ?? t("left-sidebar.label.home");

/** A computer that is not reached: its name and state. */
function Away({ computer, onPress }: { computer: ComputerItem; onPress: () => void }) {
  const theme = useTheme();
  const { disputed } = useComputers();
  const state = stateOf(computer, disputed.has(computer.key));
  return (
    <Row
      lead={
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.color.surface.muted,
          }}
        >
          <Icon icon={Monitor} />
        </View>
      }
      title={computer.name}
      strong
      sub={
        <>
          <Dot tone={state.tone} />
          <Text variant="small">{state.text}</Text>
        </>
      }
      end={<Icon icon={ChevronRight} size={18} />}
      onPress={onPress}
    />
  );
}
