import type { LucideIcon } from "lucide-react-native";
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
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

export interface SheetProps {
  open: boolean;
  /** Backdrop press, back button and dragging the sheet down all ask to close. */
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

// Past this drag distance or speed, letting go closes the sheet.
const CLOSE_DISTANCE = 120;
const CLOSE_SPEED = 0.8;

// The phone's popover, menu and dialog: it rises from the bottom edge where the thumb is.
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // Stays mounted through the closing animation.
  const [mounted, setMounted] = useState(open);
  const shown = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      setMounted(true);
      drag.setValue(0);
      Animated.timing(shown, {
        toValue: 1,
        duration: theme.motion.long,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(shown, {
      toValue: 0,
      duration: theme.motion.medium,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [open, shown, drag, theme.motion]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) =>
          drag.setValue(Math.max(0, gesture.dy)),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > CLOSE_DISTANCE || gesture.vy > CLOSE_SPEED)
            onClose();
          else
            Animated.spring(drag, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 0,
            }).start();
        },
      }),
    [drag, onClose],
  );

  if (!mounted) return null;
  const translateY = Animated.add(
    shown.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }),
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
          { backgroundColor: theme.color.backdrop, opacity: shown },
        ]}
      >
        <Pressable
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
      </Animated.View>
      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: height * 0.9,
          backgroundColor: theme.color.surface.base,
          borderTopLeftRadius: theme.radius.xl,
          borderTopRightRadius: theme.radius.xl,
          paddingBottom: insets.bottom + theme.space[4],
          transform: [{ translateY }],
        }}
      >
        <View
          {...pan.panHandlers}
          style={{
            alignItems: "center",
            paddingTop: theme.space[4],
            paddingBottom: theme.space[5],
            gap: theme.space[5],
          }}
        >
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: theme.radius.full,
              backgroundColor: theme.color.border.strong,
            }}
          />
          {title !== undefined && (
            <Text variant="titleSmall" numberOfLines={1}>
              {title}
            </Text>
          )}
        </View>
        <ScrollView
          bounces={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: theme.space[6] }}
        >
          {children}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  /** A destructive choice (delete, disconnect). */
  danger?: boolean;
  /** Marks the current choice in a pick-one menu. */
  selected?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  items: readonly MenuItem[];
}

// A list of actions in a sheet. Choosing one closes it.
export function Menu({ open, onClose, title, items }: MenuProps) {
  const theme = useTheme();
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {items.map((item) => (
        <Pressable
          key={item.label}
          accessibilityRole="menuitem"
          accessibilityState={{ selected: item.selected }}
          onPress={() => {
            onClose();
            item.onSelect();
          }}
          style={({ pressed }) => ({
            minHeight: theme.control.md.height,
            flexDirection: "row",
            alignItems: "center",
            gap: theme.space[5],
            paddingHorizontal: theme.space[4],
            borderRadius: theme.radius.md,
            backgroundColor:
              pressed || item.selected
                ? theme.color.surface.muted
                : "transparent",
          })}
        >
          {item.icon && (
            <Icon
              icon={item.icon}
              tone={item.danger ? "danger" : "secondary"}
            />
          )}
          <Text tone={item.danger ? "danger" : "primary"} grow>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </Sheet>
  );
}
