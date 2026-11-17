// Small pieces the conversation screens share: a tool's icon and the quiet one-line row the thread uses for what the
// wireframe has no own shape for (subagents, calls, decisions, notices). Time text is the desktop's (activity/elapsed.ts).
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
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { ToolCallView } from "../../../../shell/renderer/conversation/activity/model.ts";

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
