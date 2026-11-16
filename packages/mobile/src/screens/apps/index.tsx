// A user app's phone screen (tools/wireframes/drafts/phone/apps.tsx Orders, NeedsComputer and New version is live):
// lophn's line on top (sidebar, the app's mark and name, ⋯) and under it the app's own screen in its guest runtime, or
// why it cannot show: the computer is away, the app does not run, this phone and the screen do not fit, it failed.
import { LOPHN_LOCALE, t } from "@lophn/i18n";
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
import { type AppScreenState, useAppScreen } from "../../apps/use-app-screen.ts";
import {
  useAppRelease,
  useComputers,
  useCurrentComputer,
  usePhoneApps,
  useWorkspaces,
} from "../../data/mod.ts";
import { WorkspaceScreen } from "../workspace/index.tsx";
import { AppMenu } from "./menu.tsx";

// How long "Updated to Release N" stays.
const UPDATE_SHOWN_MS = 8_000;

export function AppScreen({ place }: { place: PlaceOf<"app"> }) {
  const nav = useNav();
  const computer = useCurrentComputer();
  const { retry: redial } = useComputers();
  const apps = usePhoneApps();
  const app = apps.apps.find((one) => one.app === place.id);
  const workspace = useWorkspaces().find((one) => one.key === place.id);
  const screen = useAppScreen({ computer, apps, app, screen: place.screen });
  const [menu, setMenu] = useState(false);

  // An app without a phone screen (or one no longer live) is its workspace.
  if (apps.state === "ready" && app === undefined && workspace !== undefined) {
    return (
      <WorkspaceScreen
        place={{ name: "workspace", workspace: { kind: "app", id: place.id } }}
      />
    );
  }

  const name = app?.name ?? workspace?.name ?? "";
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
        state={screen.state}
        app={name}
        computer={computerName}
        mark={mark("lg")}
        onRetry={screen.state.kind === "offline" ? redial : screen.retry}
      />
      {screen.update !== null && screen.state.kind === "running" && (
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

function Body({
  state,
  app,
  computer,
  mark,
  onRetry,
}: {
  state: AppScreenState;
  app: string;
  computer: string;
  mark: ReactNode;
  onRetry: () => void;
}) {
  const theme = useTheme();
  switch (state.kind) {
    case "loading":
      return <View style={{ flex: 1 }} />;
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
  onRetry,
}: {
  mark: ReactNode;
  title: string;
  body: string;
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
