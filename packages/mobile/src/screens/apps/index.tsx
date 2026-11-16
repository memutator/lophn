// A user app's phone screen (tools/wireframes/drafts/phone/apps.tsx Orders, NeedsComputer and New version is live):
// lophn's line on top (sidebar, the app's mark and name, ⋯) and under it the app's own screen in its guest runtime, or
// why it cannot show: the computer is away, the app does not run, this phone and the screen do not fit, it failed.
// An app that runs on the phone opens from the phone's own copy (useLocalScreen), with or without its computer; the
// line under its name says so and when it last synced (apps.tsx Calendar), and its body says when it is being put on
// the phone or that could not be done.
import { formatRelativeTime, LOPHN_LOCALE, t } from "@lophn/i18n";
import {
  Button,
  Dot,
  IconButton,
  Mark,
  type MarkTone,
  Screen,
  Text,
  Toast,
  TopBar,
  useTheme,
} from "@lophn/ui-native";
import { Ellipsis, RefreshCw } from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Rich } from "../../app/rich.tsx";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import { GuestScreen } from "../../apps/guest/mod.ts";
import { type LocalScreenState, useLocalScreen } from "../../apps/local/use-local-screen.ts";
import { type AppScreenState, useAppScreen } from "../../apps/use-app-screen.ts";
import {
  installedOf,
  type LocalApp,
  useAppRelease,
  useComputers,
  useCurrentComputer,
  useLocalApps,
  usePhoneApps,
  useWorkspaces,
  withLocalApps,
} from "../../data/mod.ts";
import { WorkspaceScreen } from "../workspace/index.tsx";
import { AppMenu } from "./menu.tsx";

// How long "Updated to Release N" stays.
const UPDATE_SHOWN_MS = 8_000;
// How often "synced 3 minutes ago" is said again.
const UNDER_TICK_MS = 30_000;

export function AppScreen({ place }: { place: PlaceOf<"app"> }) {
  const nav = useNav();
  const computer = useCurrentComputer();
  const { retry: redial } = useComputers();
  const apps = usePhoneApps();
  const app = apps.apps.find((one) => one.app === place.id);
  const local = useLocalApps();
  // An app on this phone keeps its mark while the computer's list is not there.
  const workspace = withLocalApps(useWorkspaces(), installedOf(local)).find(
    (one) => one.key === place.id,
  );
  const onPhone = useLocalScreen({
    computer,
    local,
    app: place.id,
    phoneApp: app,
    screen: place.screen,
  });
  const screen = useAppScreen({
    computer,
    apps,
    app: onPhone === null ? app : undefined,
    screen: place.screen,
  });
  const [menu, setMenu] = useState(false);
  const entry = local.apps.find((one) => one.app === place.id);
  const installed = local.store?.installed(place.id) != null;
  const now = useNow(entry !== undefined && installed);

  // An app without a phone screen (or one no longer live) is its workspace.
  if (
    onPhone === null &&
    apps.state === "ready" &&
    app === undefined &&
    workspace !== undefined
  ) {
    return (
      <WorkspaceScreen
        place={{ name: "workspace", workspace: { kind: "app", id: place.id } }}
      />
    );
  }

  const name = app?.name ?? entry?.name ?? workspace?.name ?? "";
  // The same mark as the app's line in the sidebar.
  const icon = workspace?.icon.kind === "app" ? workspace.icon : null;
  const mark = (size: "sm" | "md" | "lg") => (
    <Mark
      kind="app"
      name={icon?.letter || name}
      tone={(icon?.tone ?? 0) as MarkTone}
      size={size}
    />
  );
  const computerName = computer?.name ?? "";
  const waiting =
    workspace?.groups
      .flatMap((group) => group.rows)
      .reduce((sum, row) => sum + row.waiting, 0) ?? 0;

  return (
    <Screen
      tone="floor"
      top={
        <TopBar
          {...nav.menuButton}
          lead={mark("sm")}
          title={name}
          under={
            entry !== undefined && installed
              ? underOf(entry, computer?.status === "connected", now)
              : undefined
          }
          right={
            app === undefined ? undefined : (
              <IconButton
                icon={Ellipsis}
                label={t("conversation.label.more-actions")}
                onPress={() => setMenu(true)}
              />
            )
          }
        />
      }
    >
      <Body
        state={onPhone?.state ?? screen.state}
        installed={installed}
        app={name}
        computer={computerName}
        mark={mark("lg")}
        onRetry={
          (onPhone?.state ?? screen.state).kind === "offline"
            ? redial
            : (onPhone ?? screen).retry
        }
      />
      {onPhone === null && screen.update !== null && screen.state.kind === "running" && (
        <Updated key={screen.update} app={place.id} />
      )}
      {app !== undefined && (
        <AppMenu
          open={menu}
          onClose={() => setMenu(false)}
          app={app}
          screen={place.screen ?? app.screens[0].screen}
          mark={mark("md")}
          computer={computerName}
          waiting={waiting}
        />
      )}
    </Screen>
  );
}

/**
 * Where an app on this phone runs and how far it is synced. A sync app is "not synced since" when its last sync failed,
 * or when it has changes the computer does not have while the computer is away.
 */
function underOf(entry: LocalApp, online: boolean, now: number): string | undefined {
  if (entry.kind === "standalone") return t("mobile.local.under.standalone");
  if (entry.state === "syncing" || entry.state === "installing") {
    return t("mobile.local.under.syncing");
  }
  if (entry.last_synced_at === null) return undefined;
  const at = new Date(entry.last_synced_at);
  const fresh = now - at.getTime() < 60_000;
  const time = formatRelativeTime(at, new Date(now));
  if (entry.state === "failed" || (!online && entry.pending > 0)) {
    return fresh
      ? t("mobile.local.under.not-synced-now")
      : t("mobile.local.under.not-synced", { time });
  }
  return fresh ? t("mobile.local.under.synced-now") : t("mobile.local.under.synced", { time });
}

/** The time now, again every half minute while `ticking`. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), UNDER_TICK_MS);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

function Body({
  state,
  installed,
  app,
  computer,
  mark,
  onRetry,
}: {
  state: AppScreenState | LocalScreenState;
  /** The app is on this phone (it runs from it): installing then means moving it to a new release. */
  installed: boolean;
  app: string;
  computer: string;
  mark: ReactNode;
  onRetry: () => void;
}) {
  const theme = useTheme();
  switch (state.kind) {
    case "loading":
      return <View style={{ flex: 1 }} />;
    case "installing":
      return (
        <Away
          mark={mark}
          title={t(installed ? "mobile.local.updating.title" : "mobile.local.installing.title", { app })}
          body={t("mobile.local.installing.body")}
        />
      );
    case "running":
      // Nothing may cover the guest: the sandbox hands a touch on a covered guest to the host.
      return (
        <View style={{ flex: 1 }}>
          <GuestScreen
            key={state.key}
            view={state.view}
            screenFile={state.file}
            place={{ place: "phone", params: {}, workspace: null }}
            scheme={theme.scheme}
            locale={LOPHN_LOCALE}
            call={state.call}
            subscribe={state.subscribe}
            onState={state.onState}
            {...("local" in state
              ? {
                  backendFile: state.backendFile,
                  local: state.local,
                  appDb: state.appDb,
                  onLocalChange: state.onLocalChange,
                }
              : {})}
          />
        </View>
      );
    case "offline":
      return (
        <Away
          mark={mark}
          title={t("mobile.apps.offline.title", { app, computer })}
          body={t("mobile.apps.offline.body", { app })}
          onRetry={onRetry}
        />
      );
    case "stopped":
      return (
        <Away
          mark={mark}
          title={t("mobile.apps.stopped.title", { app, computer })}
          body={t("mobile.apps.stopped.body")}
          onRetry={onRetry}
        />
      );
    case "refused":
      return state.reason === "phone_too_old" ? (
        <Away
          mark={mark}
          title={t("mobile.apps.phone-too-old.title")}
          body={t("mobile.apps.phone-too-old.body")}
        />
      ) : (
        <Away
          mark={mark}
          title={t("mobile.apps.screen-too-old.title")}
          body={t("mobile.apps.screen-too-old.body")}
        />
      );
    case "failed":
      // The first install did not go through; under the sentence, what went wrong as the phone's host has it.
      if ("failure" in state && state.failure !== undefined) {
        return (
          <Away
            mark={mark}
            title={t("mobile.local.install-failed.title", { app })}
            body={t("mobile.local.install-failed.body")}
            detail={state.failure}
            onRetry={onRetry}
          />
        );
      }
      return (
        <Away
          mark={mark}
          title={t("mobile.apps.failed.title")}
          body={t("mobile.apps.failed.body")}
          onRetry={onRetry}
        />
      );
  }
}

/** Why the app's screen is not there (NeedsComputer and the other states drawn like it). */
function Away({
  mark,
  title,
  body,
  detail,
  onRetry,
}: {
  mark: ReactNode;
  title: string;
  body: string;
  /** A quieter line under the body: the error as it came. */
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 28,
      }}
    >
      <View style={{ opacity: 0.45 }}>{mark}</View>
      <Text variant="h1" weight="semibold" align="center" style={{ marginTop: 20 }}>
        {title}
      </Text>
      <Text variant="body" tone="secondary" align="center" style={{ marginTop: 10 }}>
        {body}
      </Text>
      {detail !== undefined && (
        <Text variant="detail" tone="muted" align="center" style={{ marginTop: 8 }}>
          {detail}
        </Text>
      )}
      {onRetry !== undefined && (
        <View style={{ marginTop: 20 }}>
          <Button icon={RefreshCw} onPress={onRetry}>
            {t("common.button.retry")}
          </Button>
        </View>
      )}
    </View>
  );
}

/**
 * "Updated to Release N" for a while after a new release replaced the screen. It sits under the guest, not over it:
 * the guest would lose the touches under anything drawn on top of it.
 */
function Updated({ app }: { app: string }) {
  const insets = useSafeAreaInsets();
  const release = useAppRelease(app);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShown(false), UPDATE_SHOWN_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!shown || release.loaded.state !== "ready" || release.loaded.value === null) {
    return null;
  }
  return (
    <View style={{ height: insets.bottom + 72 }}>
      <Toast lead={<Dot tone="good" />}>
        <Rich
          id="mobile.apps.updated"
          name="release"
          value={t("shell.label.app-release", { number: release.loaded.value.number })}
          variant="detail"
        />
      </Toast>
    </View>
  );
}
