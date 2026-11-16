// "lophn is not running on <computer>" (tools/wireframes/drafts/phone/coding.tsx Sessions down) and the one button that
// starts it. Waking opens a window on the person's computer, so it is never called on its own; only this button does.
import { t } from "@lophn/i18n";
import { Button, Icon, Text, Working } from "@lophn/ui-native";
import { Monitor, Play } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useCodingActions } from "../../data/mod.ts";
import { useLocked } from "../../parts/mod.ts";

// How long to wait for the app to attach before saying it did not start.
const STARTING_MS = 30_000;

/**
 * The line and the button. The parent drops it when `useCodingSessions().shell` turns `attached`; `onWoken` tells it the
 * app was started from here (the list is empty then, so the parent says so).
 */
export function NotRunning({ computer, onWoken }: { computer: string; onWoken?: () => void }) {
  const actions = useCodingActions();
  const locked = useLocked();
  const [state, setState] = useState<"idle" | "starting" | "failed">("idle");

  useEffect(() => {
    if (state !== "starting") return;
    const timer = setTimeout(() => setState("failed"), STARTING_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const start = async () => {
    setState("starting");
    const woke = await actions.wake();
    if (woke.ok) onWoken?.();
    else setState("failed");
  };

  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <Icon icon={Monitor} size={22} tone="muted" />
        <View style={{ flex: 1 }}>
          <Text>{t("mobile.coding.notice.not-running", { computer })}</Text>
          <Text variant="note" tone="muted" style={{ marginTop: 2 }}>
            {t("mobile.coding.notice.not-running-sub")}
          </Text>
        </View>
      </View>
      {state === "failed" && (
        <Text variant="small" tone="critical" style={{ marginTop: 8 }}>
          {t("mobile.coding.error.wake-failed", { computer })}
        </Text>
      )}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 12 }}>
        {state === "starting" ? (
          <Working>{t("mobile.coding.notice.starting", { computer })}</Working>
        ) : (
          <Button size="sm" variant="primary" icon={Play} disabled={locked} onPress={() => void start()}>
            {t("mobile.coding.button.start")}
          </Button>
        )}
      </View>
    </View>
  );
}

/** The coding read did not go through: said in the group's place, with a way to read again. */
export function ReadFailed({ computer, onRetry }: { computer: string; onRetry: () => void }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
      <Text variant="small" tone="critical">
        {t("mobile.coding.error.read-failed", { computer })}
      </Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 12 }}>
        <Button size="sm" onPress={onRetry}>
          {t("common.button.retry")}
        </Button>
      </View>
    </View>
  );
}
