import type { LucideIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

export interface TabBarItem<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
  /** How many things wait behind this tab. Zero shows nothing. */
  badge?: number;
}

export interface TabBarProps<T extends string> {
  items: readonly TabBarItem<T>[];
  value: T;
  onChange: (value: T) => void;
}

// The app's top-level places, at the bottom edge where the thumb is. Two to five; a place inside a place is a Screen with a back arrow.
// Goes in a Screen's footer, which keeps it above the gesture bar.
export function TabBar<T extends string>({
  items,
  value,
  onChange,
}: TabBarProps<T>) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        borderTopWidth: 1,
        borderTopColor: theme.color.border.subtle,
      }}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={
              item.badge ? `${item.label}, ${item.badge} waiting` : item.label
            }
            onPress={() => onChange(item.value)}
            style={{
              flex: 1,
              height: 56,
              alignItems: "center",
              justifyContent: "center",
              gap: theme.space[1],
            }}
          >
            <View>
              <Icon icon={item.icon} tone={selected ? "primary" : "muted"} />
              {item.badge !== undefined && item.badge > 0 && (
                <View
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -10,
                    minWidth: 16,
                    height: 16,
                    paddingHorizontal: 4,
                    borderRadius: theme.radius.full,
                    backgroundColor: theme.color.status.warning.marker,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text variant="caption" weight="semibold">
                    {item.badge > 9 ? "9+" : String(item.badge)}
                  </Text>
                </View>
              )}
            </View>
            <Text
              variant="caption"
              weight={selected ? "semibold" : "regular"}
              tone={selected ? "primary" : "muted"}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
