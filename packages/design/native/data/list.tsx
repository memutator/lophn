import { ChevronRight } from "lucide-react-native";
import { Children, Fragment, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

export interface ListProps {
  /** Small quiet heading above the group. */
  title?: string;
  children: ReactNode;
}

// A group of rows on one rounded surface, with hairlines between them.
export function List({ title, children }: ListProps) {
  const theme = useTheme();
  const rows = Children.toArray(children);
  return (
    <View style={{ gap: theme.space[4] }}>
      {title !== undefined && (
        <View style={{ paddingHorizontal: theme.space[6] }}>
          <Text variant="caption" tone="muted" weight="medium">
            {title}
          </Text>
        </View>
      )}
      <View
        style={{
          backgroundColor: theme.color.surface.base,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border.subtle,
          overflow: "hidden",
        }}
      >
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index > 0 && (
              <View
                style={{
                  height: 1,
                  marginLeft: theme.space[6],
                  backgroundColor: theme.color.border.subtle,
                }}
              />
            )}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

export interface ListItemProps {
  title: string;
  /** Second line: what it is about, its last state. */
  meta?: string;
  /** Lines the meta may take before it is cut. */
  metaLines?: number;
  /** In front of the text: a status dot, an icon. */
  leading?: ReactNode;
  /** At the end: a time, a count, a switch. */
  trailing?: ReactNode;
  /** Shows the arrow that says the row opens something. */
  chevron?: boolean;
  /** With this the whole row is a button. */
  onPress?: () => void;
}

export function ListItem({
  title,
  meta,
  metaLines = 1,
  leading,
  trailing,
  chevron,
  onPress,
}: ListItemProps) {
  const theme = useTheme();
  const body = (
    <>
      {leading}
      <View style={{ flex: 1, minWidth: 0, gap: theme.space[1] }}>
        <Text weight="medium" numberOfLines={1}>
          {title}
        </Text>
        {meta !== undefined && (
          <Text variant="small" tone="muted" numberOfLines={metaLines}>
            {meta}
          </Text>
        )}
      </View>
      {trailing}
      {chevron && <Icon icon={ChevronRight} size="small" tone="muted" />}
    </>
  );
  const box = {
    minHeight: meta === undefined ? theme.row + theme.space[4] : 64,
    paddingHorizontal: theme.space[6],
    paddingVertical: theme.space[5],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space[5],
  } as const;
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        box,
        pressed && { backgroundColor: theme.color.surface.muted },
      ]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={box}>{body}</View>
  );
}
