// The computer on screen not answering, said the same way on every screen: Home's banner (who is away, what it means
// here, Try again), what is shown dimmed to the kit's dim, and every action locked until it is back.
import { t } from "@lophn/i18n";
import { Banner, Button } from "@lophn/ui-native";
import { RefreshCw, WifiOff } from "lucide-react-native";
import { View } from "react-native";
import { type ComputerItem, useComputers, useCurrentComputer } from "../data/mod.ts";

/** How far what was last read fades while the computer is away; the kit's Row `dim` uses the same. */
export const DIM = 0.45;

/** The computer on screen does not answer: what shows was last read, and nothing can be sent. */
export function useLocked(): boolean {
  const computer = useCurrentComputer();
  return computer !== null && computer.status !== "connected";
}

/** Who must update to reach the computer, as a sentence. The pairing screen says it too. */
export function updateText(
  update: NonNullable<ComputerItem["update"]>,
  name: string,
): string {
  return t(
    update === "client"
      ? "machine-update.viewer.phone-client"
      : "machine-update.viewer.phone-host",
    { name },
  );
}

/** What a message box says instead of its placeholder while the computer is away (it is locked then); null when online. */
export function useUnreachable(): string | null {
  const computer = useCurrentComputer();
  if (computer === null || computer.status === "connected") return null;
  return unreachableOf(computer);
}

/** Who cannot be reached, or who must update to reach it, as a sentence. */
export function unreachableOf(computer: ComputerItem): string {
  return computer.update === null
    ? t("mobile.start.heading.unreachable", { name: computer.name })
    : updateText(computer.update, computer.name);
}

/**
 * At the top of a screen while the computer is away; nothing otherwise. `note` says what it means on this screen
 * (Home: sessions are paused; Inbox: answers wait).
 */
export function OfflineBanner({ note }: { note: string }) {
  const computer = useCurrentComputer();
  const { disputed, retry } = useComputers();
  if (computer === null || computer.status === "connected") return null;
  const { status, name, update } = computer;
  const isDisputed = disputed.has(computer.key);
  return (
    <View style={{ paddingBottom: 8 }}>
      <Banner
        icon={WifiOff}
        title={
          isDisputed
            ? t("settings.label.remote-disputed")
            : status === "revoked"
              ? t("mobile.computer.status.revoked")
              : update !== null
                ? updateText(update, name)
                : t(
                  status === "connecting"
                    ? "mobile.offline.title-connecting"
                    : "mobile.offline.title",
                  { name },
                )
        }
        action={
          status === "offline" || status === "update" ? (
            <Button size="sm" icon={RefreshCw} onPress={retry}>
              {t("common.button.retry")}
            </Button>
          ) : undefined
        }
      >
        {isDisputed
          ? t("mobile.computer.note.disputed")
          : status === "revoked"
            ? undefined
            : status === "connecting"
              ? t("mobile.offline.note-connecting")
              : note}
      </Banner>
    </View>
  );
}
