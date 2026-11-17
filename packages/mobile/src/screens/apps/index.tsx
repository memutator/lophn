// A user app's phone screen (tools/wireframes/drafts/phone/apps.tsx Orders, NeedsComputer and New version is live):
// lophn's line on top (sidebar, the app's mark and name, ⋯) and under it the app's own screen in its guest runtime, or
// why it cannot show: the computer is away, the app does not run, this phone and the screen do not fit, it failed.
// An app that runs on the phone opens from the phone's own copy (useLocalScreen), with or without its computer; the
// line under its name says so and when it last synced (apps.tsx Calendar), and its body says when it is being put on
// the phone or that could not be done. With `preview` the place is the preview running on the computer instead
// (preview.tsx); an app whose only phone screen is in its running preview is opened that way from its line in the app
// list.
import { formatRelativeTime, t } from "@lophn/i18n";
import {
  Dot,
  IconButton,
  Mark,
  type MarkTone,
  Screen,
  Toast,
  TopBar,
} from "@lophn/ui-native";
import { Ellipsis } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Rich } from "../../app/rich.tsx";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import { useLocalScreen } from "../../apps/local/use-local-screen.ts";
import { useAppScreen } from "../../apps/use-app-screen.ts";
import {
  installedOf,
  type LocalApp,
  useAppRelease,
  useComputers,
  useCurrentComputer,
  useLocalApps,
  previewOnly,
  usePhoneApps,
  useWorkspaces,
  withLocalApps,
} from "../../data/mod.ts";
import { WorkspaceScreen } from "../workspace/index.tsx";
import { Body } from "./body.tsx";
import { AppMenu } from "./menu.tsx";
import { PreviewScreen } from "./preview.tsx";

// How long "Updated to Release N" stays.
const UPDATE_SHOWN_MS = 8_000;
// How often "synced 3 minutes ago" is said again.
const UNDER_TICK_MS = 30_000;

export function AppScreen({ place }: { place: PlaceOf<"app"> }) {
  return place.preview ? <PreviewScreen place={place} /> : <LiveScreen place={place} />;
}

function LiveScreen({ place }: { place: PlaceOf<"app"> }) {
  const nav = useNav();
  const computer = useCurrentComputer();
  const { retry: redial } = useComputers();
  const apps = usePhoneApps();
  // An app with only a preview's phone screen has no live screen to show here.
  const app = apps.apps.find((one) => one.app === place.id && !previewOnly(one));
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
  const under =
    entry !== undefined && installed
      ? underOf(entry, computer?.status === "connected", now)
      : undefined;
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
          under={under}
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
          screen={place.screen ?? app.screens[0]!.screen}
          mark={mark("md")}
          sub={
            onPhone === null
              ? t("mobile.apps.menu.runs-on", { computer: computerName })
              : under
          }
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
