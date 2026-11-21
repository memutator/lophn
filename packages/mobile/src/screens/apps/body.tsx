// What a user app's screen shows under lophn's top line, for the live app (index.tsx) and its preview (preview.tsx): the
// guest, or why it cannot show (NeedsComputer and the other states drawn like it).
import { LOPHN_LOCALE, t } from "@lophn/i18n";
import { Button, Text, useTheme } from "@lophn/ui-native";
import { RefreshCw } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { GuestScreen } from "../../apps/guest/mod.ts";
import type { InstallStep } from "../../apps/local/install.ts";
import type { LocalScreenState } from "../../apps/local/use-local-screen.ts";
import type { AppScreenState } from "../../apps/use-app-screen.ts";

const STEP = {
  files: "mobile.local.install-failed.step.files",
  snapshot: "mobile.local.install-failed.step.snapshot",
  data: "mobile.local.install-failed.step.data",
} as const satisfies Record<InstallStep, string>;

export function Body({
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
            phone={state.phone}
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
      // The first install did not go through; under the sentence, the step it stopped at and the code. What the
      // computer said is in the log only: it is the computer's own wording.
      if ("failure" in state && state.failure !== undefined) {
        const { step, code } = state.failure;
        return (
          <Away
            mark={mark}
            title={t("mobile.local.install-failed.title", { app })}
            body={t("mobile.local.install-failed.body")}
            detail={
              step === undefined
                ? code
                : t("mobile.local.install-failed.detail", { step: t(STEP[step]), code })
            }
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
export function Away({
  mark,
  title,
  body,
  detail,
  onRetry,
  action,
}: {
  mark: ReactNode;
  title: string;
  body: string;
  /** A quieter line under the body: the error as it came. */
  detail?: string;
  onRetry?: () => void;
  /** Another button in place of Try again. */
  action?: ReactNode;
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
      {action !== undefined && <View style={{ marginTop: 20 }}>{action}</View>}
    </View>
  );
}
