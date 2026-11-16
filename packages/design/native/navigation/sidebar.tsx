import { t } from "@lophn/i18n";
import { ChevronsUpDown, type LucideIcon } from "lucide-react-native";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Dot, type DotTone } from "../feedback/status.tsx";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { Ink, useTheme } from "../theme.tsx";

export interface DrawerProps {
  open: boolean;
  /** The scrim, the back button and dragging the panel left all ask to close. */
  onClose: () => void;
  /** The sidebar: SidebarHead, ComputerPicker, rows, SidebarFoot. */
  children: ReactNode;
}

const WIDTH = 326;

// The sidebar on a phone: a panel that slides in from the left edge over a scrim.
export function Drawer({ open, onClose, children }: DrawerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const width = Math.min(WIDTH, screen - 48);
  const [mounted, setMounted] = useState(open);
  const shown = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      setMounted(true);
      drag.setValue(0);
      Animated.timing(shown, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(shown, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [open, shown, drag]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_event, gesture) =>
          drag.setValue(Math.min(0, gesture.dx)),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx < -width / 3 || gesture.vx < -0.8) onClose();
          else
            Animated.spring(drag, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 0,
            }).start();
        },
      }),
    [drag, onClose, width],
  );

  if (!mounted) return null;
  const translateX = Animated.add(
    shown.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }),
    drag,
  );
  return (
    <Modal
      transparent
      visible
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: theme.color.scrim, opacity: shown },
        ]}
      >
        <Pressable
          accessibilityLabel={t("common.button.close")}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
      </Animated.View>
      <Animated.View
        {...pan.panHandlers}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          backgroundColor: theme.color.surface.shell,
          boxShadow: theme.shadow.drawer,
          transform: [{ translateX }],
        }}
      >
        {children}
      </Animated.View>
    </Modal>
  );
}

export interface SidebarHeadProps {
  /** The product's face. */
  lead: ReactNode;
  title: string;
  /** Icon buttons at the end (search). */
  right?: ReactNode;
}

export function SidebarHead({ lead, title, right }: SidebarHeadProps) {
  return (
    <View
      style={{
        height: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 18,
        paddingRight: 8,
      }}
    >
      {lead}
      <Text
        weight="semibold"
        style={{ flex: 1, fontSize: 18, lineHeight: 26, letterSpacing: -0.18 }}
      >
        {title}
      </Text>
      {right}
    </View>
  );
}

export interface ComputerPickerProps {
  icon: LucideIcon;
  name: string;
  /** Connected, Offline. */
  state: string;
  tone: DotTone;
  onPress?: () => void;
}

// The computer the whole sidebar belongs to. Pressing it opens the list of computers.
export function ComputerPicker({
  icon,
  name,
  state,
  tone,
  onPress,
}: ComputerPickerProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        height: 54,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginTop: 2,
        marginHorizontal: 12,
        marginBottom: 8,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: theme.color.border.base,
        borderRadius: 14,
        backgroundColor: pressed
          ? theme.color.surface.subtle
          : theme.color.surface.base,
      })}
    >
      <Icon icon={icon} size={20} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          variant="control"
          weight="medium"
          numberOfLines={1}
          style={{ lineHeight: 20 }}
        >
          {name}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Dot tone={tone} />
          <Text variant="caption" tone="muted">
            {state}
          </Text>
        </View>
      </View>
      <Icon icon={ChevronsUpDown} size={16} tone="muted" />
    </Pressable>
  );
}

function SideRow({
  on,
  strong,
  indent,
  onPress,
  children,
}: {
  on?: boolean;
  strong?: boolean;
  indent?: boolean;
  onPress?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 40,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginHorizontal: 8,
        paddingLeft: indent ? 26 : 10,
        paddingRight: 10,
        borderRadius: 10,
        backgroundColor:
          on || pressed ? theme.color.surface.muted : "transparent",
      })}
    >
      <Ink
        color={
          on || strong ? theme.color.text.primary : theme.color.text.secondary
        }
      >
        {children}
      </Ink>
    </Pressable>
  );
}

function SideText({
  strong,
  children,
}: {
  strong?: boolean;
  children: string;
}) {
  return (
    <Text
      variant="control"
      weight={strong ? "medium" : "regular"}
      numberOfLines={1}
      grow
    >
      {children}
    </Text>
  );
}

export interface NavRowProps {
  icon: LucideIcon;
  label: string;
  /** A badge at the end. */
  end?: ReactNode;
  on?: boolean;
  onPress?: () => void;
}

// A top-level place in the sidebar: Inbox, Jobs, Agents, Settings.
export function NavRow({ icon, label, end, on, onPress }: NavRowProps) {
  return (
    <SideRow on={on} onPress={onPress}>
      <Icon icon={icon} size={19} />
      <SideText>{label}</SideText>
      {end}
    </SideRow>
  );
}

export interface WorkspaceRowProps {
  /** An icon (Home, a folder) or an app's Mark. */
  lead: ReactNode;
  label: string;
  /** A small icon button at the end (+: a new session here). */
  end?: ReactNode;
  on?: boolean;
  onPress?: () => void;
}

// A workspace in the sidebar: Home, a project, an app. Its sessions follow it.
export function WorkspaceRow({
  lead,
  label,
  end,
  on,
  onPress,
}: WorkspaceRowProps) {
  return (
    <SideRow on={on} strong onPress={onPress}>
      {lead}
      <SideText strong>{label}</SideText>
      {end}
    </SideRow>
  );
}

export interface SessionRowProps {
  /** Who runs it, 20 wide: an agent's face, a coding agent's icon, a workflow icon. */
  face: ReactNode;
  title: string;
  /** A small mark after the title (a coding session that runs in a terminal). */
  mark?: ReactNode;
  /** warning: waits on the person. good: working. None: idle. */
  tone?: DotTone;
  on?: boolean;
  onPress?: () => void;
}

// A session under its workspace, with its state as a dot.
export function SessionRow({
  face,
  title,
  mark,
  tone,
  on,
  onPress,
}: SessionRowProps) {
  return (
    <SideRow on={on} indent onPress={onPress}>
      <View
        style={{
          width: 20,
          height: 20,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {face}
      </View>
      <SideText>{title}</SideText>
      {mark}
      <Dot tone={tone} />
    </SideRow>
  );
}

export interface SidebarLabelProps {
  children: string;
  /** A small icon button at the end (+). */
  end?: ReactNode;
}

// A group's name in the sidebar: Workspaces.
export function SidebarLabel({ children, end }: SidebarLabelProps) {
  return (
    <View
      style={{
        height: 32,
        marginTop: 6,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingLeft: 18,
        paddingRight: 10,
      }}
    >
      <Text variant="small" weight="medium" tone="muted">
        {children}
      </Text>
      {end}
    </View>
  );
}

export interface WorktreeLabelProps {
  children: string;
}

// A worktree's name over its sessions inside a project: Main, weekly-review.
export function WorktreeLabel({ children }: WorktreeLabelProps) {
  return (
    <Text
      variant="caption"
      tone="muted"
      numberOfLines={1}
      style={{ paddingTop: 6, paddingBottom: 2, paddingLeft: 34 }}
    >
      {children}
    </Text>
  );
}

export interface SidebarFootProps {
  children: ReactNode;
}

// The sidebar's bottom line under a hairline: Settings.
export function SidebarFoot({ children }: SidebarFootProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 57,
        justifyContent: "center",
        paddingHorizontal: 8,
        borderTopWidth: 1,
        borderTopColor: theme.color.border.subtle,
      }}
    >
      {children}
    </View>
  );
}

export interface SidebarListProps {
  children: ReactNode;
}

// The sidebar's scrolling middle: places, workspaces and sessions. It fades out at the bottom so the list reads as going on.
export function SidebarList({ children }: SidebarListProps) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {children}
      </ScrollView>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 36,
          backgroundImage: `linear-gradient(to bottom, transparent, ${theme.color.surface.shell})`,
        }}
      />
    </View>
  );
}
