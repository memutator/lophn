import { createContext, type ReactNode, useContext } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { Text } from "../primitives/text.tsx";
import { Ink, useTheme } from "../theme.tsx";

// How far a row sits from the edge of what holds it: the screen, or a card of rows.
const Inset = createContext({ x: 20, y: 6 });
export const RowInset = Inset.Provider;

export interface LabelProps {
  children: string;
  /** Quiet text or a link at the end: "Inbox · 3 ›", a + button. */
  end?: ReactNode;
}

// A section's name above its rows.
export function Label({ children, end }: LabelProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 20,
        paddingBottom: 8,
        paddingHorizontal: 20,
      }}
    >
      <Text variant="small" weight="medium" tone="muted">
        {children}
      </Text>
      {end !== undefined && (
        <Ink color={theme.color.text.secondary}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            {typeof end === "string" ? (
              <Text variant="small" weight="medium">
                {end}
              </Text>
            ) : (
              end
            )}
          </View>
        </Ink>
      )}
    </View>
  );
}

export interface RowProps {
  /** A face, a mark or an icon before the text. */
  lead?: ReactNode;
  title: ReactNode;
  /** The quieter second line. */
  sub?: ReactNode;
  /** Quiet text, a dot, a badge, a chevron or a small button at the end. */
  end?: ReactNode;
  /** A heavier title: a name the person picks from a list. */
  strong?: boolean;
  /** Something that cannot be used now (its computer is offline). */
  dim?: boolean;
  /** Lets the second line wrap. */
  wrap?: boolean;
  onPress?: () => void;
}

// One line of a list: a session, a computer, a setting, a menu choice.
export function Row({
  lead,
  title,
  sub,
  end,
  strong,
  dim,
  wrap,
  onPress,
}: RowProps) {
  const theme = useTheme();
  const inset = useContext(Inset);
  return (
    <Pressable
      disabled={onPress === undefined}
      onPress={onPress}
      accessibilityRole={onPress === undefined ? undefined : "button"}
      style={({ pressed }) => ({
        minHeight: 52 + 2 * inset.y,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: inset.x,
        paddingVertical: inset.y,
        opacity: dim ? 0.45 : 1,
        backgroundColor: pressed ? theme.color.surface.muted : "transparent",
      })}
    >
      {lead}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === "string" ? (
          <Text
            weight={strong ? "medium" : "regular"}
            numberOfLines={1}
            style={{ lineHeight: 22 }}
          >
            {title}
          </Text>
        ) : (
          title
        )}
        {sub !== undefined && (
          <Ink color={theme.color.text.muted}>
            {typeof sub === "string" ? (
              <Text variant="small" numberOfLines={wrap ? undefined : 1}>
                {sub}
              </Text>
            ) : (
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                {sub}
              </View>
            )}
          </Ink>
        )}
      </View>
      {end !== undefined && (
        <Ink color={theme.color.text.muted}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {typeof end === "string" ? <Text variant="small">{end}</Text> : end}
          </View>
        </Ink>
      )}
    </Pressable>
  );
}

export interface DividerProps {
  /** Space above and below. */
  spacing?: number;
  /** Distance from both edges; the rows' own inset when omitted. */
  inset?: number;
}

// A hairline between rows. It lines up with the rows' text edge.
export function Divider({ spacing = 0, inset: edge }: DividerProps) {
  const theme = useTheme();
  const inset = useContext(Inset);
  const style: ViewStyle = {
    height: 1,
    marginHorizontal: edge ?? inset.x,
    marginVertical: spacing,
    backgroundColor: theme.color.border.subtle,
  };
  return <View style={style} />;
}

export interface BandProps {
  children: string;
  count?: number;
}

// A full-width band that starts a kind of item in a long list (Inbox: Permission requests, Questions).
export function Band({ children, count }: BandProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 7,
        paddingHorizontal: 20,
        backgroundColor: theme.color.surface.subtle,
      }}
    >
      <Text variant="small" weight="medium" tone="secondary">
        {children}
      </Text>
      {count !== undefined && (
        <Text variant="small" weight="medium" tone="secondary">
          {String(count)}
        </Text>
      )}
    </View>
  );
}
