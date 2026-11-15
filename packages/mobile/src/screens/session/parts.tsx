// Small pieces the conversation screens share: time text, a ticking clock, and the quiet one-line row the thread uses for
// what the wireframe has no own shape for (subagents, calls, decisions, notices).
import { t } from "@lophn/i18n";
import { Icon, Ink, Text, useTheme } from "@lophn/ui-native";
import {
  ChevronRight,
  FileText,
  FolderOpen,
  Globe,
  type LucideIcon,
  Search,
  Terminal,
  Wrench,
} from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import type { ToolCallView } from "../../../../shell/renderer/conversation/activity/model.ts";

// The desktop's `duration` (activity/worked-for.tsx) lives in a DOM file the phone cannot load; same keys, same rule.
/** 18s, 1m 15s, 1h 5m. */
export function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return minutes === 0
      ? t("conversation.label.duration-hours", { hours })
      : t("conversation.label.duration-hours-minutes", { hours, minutes });
  }
  if (minutes === 0) return t("conversation.label.duration-seconds", { seconds });
  if (seconds === 0) return t("conversation.label.duration-minutes", { minutes });
  return t("conversation.label.duration-minutes-seconds", { minutes, seconds });
}

/** A running line's time from its start, a finished line's own duration; empty when unknown. */
export function elapsedText(
  running: boolean,
  startedAt: string | null,
  durationMs: number | null,
): string {
  if (running) {
    return startedAt === null
      ? ""
      : duration(Math.max(0, Date.now() - Date.parse(startedAt)));
  }
  return durationMs === null ? "" : duration(durationMs);
}

/** Draws again every second while `active`. */
export function useTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

const CATEGORY_ICON: Record<ToolCallView["category"], LucideIcon> = {
  read: FileText,
  list: FolderOpen,
  search: Search,
  command: Terminal,
  web: Globe,
  other: Wrench,
};

export function toolIcon(call: ToolCallView): LucideIcon {
  return CATEGORY_ICON[call.category];
}

/** A quiet line in a turn: an icon, the text, and a chevron when it opens something. */
export function Line({
  icon,
  children,
  under,
  end,
  onPress,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  /** A second quiet line under the text. */
  under?: string;
  end?: ReactNode;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress === undefined ? undefined : "button"}
      disabled={onPress === undefined}
      onPress={onPress}
    >
      <Ink color={theme.color.text.muted}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
          {icon !== undefined && (
            <View style={{ marginTop: 2 }}>
              <Icon icon={icon} size={15} />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            {typeof children === "string" ? (
              <Text variant="detail" tone="muted" numberOfLines={2}>
                {children}
              </Text>
            ) : (
              children
            )}
            {under !== undefined && under !== "" && (
              <Text variant="small" tone="muted" numberOfLines={3}>
                {under}
              </Text>
            )}
          </View>
          {end}
          {onPress !== undefined && (
            <View style={{ marginTop: 2 }}>
              <Icon icon={ChevronRight} size={15} />
            </View>
          )}
        </View>
      </Ink>
    </Pressable>
  );
}
