import type { LucideIcon } from "lucide-react-native";
import { View } from "react-native";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

export type MarkTone = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | "plain";

const MARK = {
  sm: { side: 24, radius: 7, text: 12, icon: 14 },
  md: { side: 32, radius: 9, text: 14, icon: 14 },
  lg: { side: 56, radius: 16, text: 22, icon: 24 },
} as const;

export interface MarkProps {
  /** project: a rounded square. app: a circle. */
  kind: "project" | "app";
  /** Its first letter is drawn when there is no icon. */
  name: string;
  /** A chart series color. plain: a dashed outline (New app). */
  tone?: MarkTone;
  size?: "sm" | "md" | "lg";
  icon?: LucideIcon;
}

// A project's or an app's colored mark.
export function Mark({ kind, name, tone = 0, size = "sm", icon }: MarkProps) {
  const theme = useTheme();
  const box = MARK[size];
  const plain = tone === "plain";
  const color = plain ? theme.color.text.secondary : "#ffffff";
  return (
    <View
      style={{
        width: box.side,
        height: box.side,
        borderRadius: kind === "app" ? 999 : box.radius,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: plain ? "transparent" : theme.color.chart[tone],
        borderWidth: plain ? 1 : 0,
        borderStyle: "dashed",
        borderColor: theme.color.border.strong,
      }}
    >
      {icon === undefined ? (
        <Text
          weight="semibold"
          style={{ fontSize: box.text, lineHeight: box.text * 1.2, color }}
        >
          {name.slice(0, 1)}
        </Text>
      ) : (
        <Icon icon={icon} size={box.icon} color={color} />
      )}
    </View>
  );
}

export interface PreProps {
  children: string;
  /** Wraps long lines instead of cutting them with an ellipsis (command output). */
  wrap?: boolean;
  /** Only as wide as the text. */
  fit?: boolean;
}

// A command, a path or a short output in a mono box.
export function Pre({ children, wrap, fit }: PreProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        alignSelf: fit ? "flex-start" : "stretch",
        paddingVertical: 7,
        paddingHorizontal: 10,
        borderWidth: 1,
        borderColor: theme.color.border.subtle,
        borderRadius: 8,
        backgroundColor: theme.color.surface.base,
      }}
    >
      <Text
        mono
        numberOfLines={wrap ? undefined : 1}
        style={{ fontSize: 13, lineHeight: 20 }}
      >
        {children}
      </Text>
    </View>
  );
}

export interface StatProps {
  label: string;
  value: string;
  /** A quieter word after the number (USD). */
  unit?: string;
}

// A label over a large number.
export function Stat({ label, value, unit }: StatProps) {
  return (
    <View>
      <Text variant="small" tone="secondary">
        {label}
      </Text>
      {/* The wireframe's smaller unit sits on the number's baseline and makes its line 6 taller. */}
      <Text
        variant="stat"
        weight="semibold"
        style={unit !== undefined ? { paddingBottom: 6 } : undefined}
      >
        {value}
        {unit !== undefined && (
          <Text
            variant="detail"
            tone="secondary"
            style={{ letterSpacing: 0 }}
          >{` ${unit}`}</Text>
        )}
      </Text>
    </View>
  );
}
