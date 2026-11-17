import { t } from "@lophn/i18n";
import { Check as CheckIcon, type LucideIcon } from "lucide-react-native";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Row } from "../layout/list.tsx";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { Ink, useTheme } from "../theme.tsx";

export interface SheetProps {
  open: boolean;
  /** The scrim, the back button and dragging the sheet down all ask to close. */
  onClose: () => void;
  title?: string;
  /** A face or a mark before the title; with it the head is larger and `sub` sits under the title. */
  lead?: ReactNode;
  sub?: string;
  /** At the end of the title line: a small button. */
  end?: ReactNode;
  children: ReactNode;
}

// On a wide screen the sheet keeps a phone's width and rises in the middle instead of spanning the screen.
const SHEET_WIDTH = 560;

// Past this drag distance or speed, letting go closes the sheet.
const CLOSE_DISTANCE = 120;
const CLOSE_SPEED = 0.8;

// The phone's popover, menu and dialog: it rises from the bottom edge where the thumb is, and above the keyboard.
export function Sheet({
  open,
  onClose,
  title,
  lead,
  sub,
  end,
  children,
}: SheetProps) {
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

  const translateY = Animated.add(
    shown.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }),
    drag,
  );
  const layer = useContext(Layer);
  const id = useId();
  const inScreen = inAppScreen();
  const content = mounted ? (
    <>
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
      <KeyboardAvoidingView
        behavior="padding"
        pointerEvents="box-none"
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
        <Animated.View
          style={{
            width: "100%",
            maxWidth: SHEET_WIDTH,
            alignSelf: "center",
            // Inside an app screen the sheet stops below the top of the screen, not of the phone.
            maxHeight: inScreen ? "92%" : height * 0.92,
            backgroundColor: theme.color.surface.base,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            boxShadow: theme.shadow.sheet,
            paddingBottom: Math.max(insets.bottom, 26),
            transform: [{ translateY }],
          }}
        >
          <View {...pan.panHandlers}>
            <View
              style={{
                alignSelf: "center",
                width: 36,
                height: 4,
                marginTop: 8,
                marginBottom: 2,
                borderRadius: 999,
                backgroundColor: theme.color.border.strong,
              }}
            />
            {lead !== undefined ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingTop: 10,
                  paddingBottom: 12,
                  paddingHorizontal: 20,
                }}
              >
                {lead}
                <View style={{ flex: 1, minWidth: 0 }}>
                  {title !== undefined && (
                    <Text variant="heading" weight="semibold" numberOfLines={1}>
                      {title}
                    </Text>
                  )}
                  {sub !== undefined && (
                    <Text variant="note" tone="muted" numberOfLines={1}>
                      {sub}
                    </Text>
                  )}
                </View>
                {end}
              </View>
            ) : (
              title !== undefined && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    paddingTop: 10,
                    paddingBottom: 8,
                    paddingHorizontal: 20,
                  }}
                >
                  <Text variant="heading" weight="semibold" numberOfLines={1}>
                    {title}
                  </Text>
                  {end}
                </View>
              )
            )}
          </View>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </>
  ) : null;
  useLayoutEffect(() => layer?.(id, content));
  useEffect(() => (layer ? () => layer(id, null) : undefined), [layer, id]);

  if (content === null || layer !== null) return null;
  if (inScreen)
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {content}
      </View>
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
      {content}
    </Modal>
  );
}

// An app's screen runs where lophn set the global `lophnApp` (the phone's guest runtime, the desktop preview); lophn's
// own phone screens have none. A Modal there would be a window over the whole lophn app, where an app could pass for
// lophn's own screens and where the phone tab cannot read it, so an app's sheet draws inside the screen instead.
function inAppScreen(): boolean {
  return (globalThis as { lophnApp?: unknown }).lophnApp !== undefined;
}

type Place = (id: string, content: ReactNode) => void;
const Layer = createContext<Place | null>(null);

// Covers a Screen of an app so its sheets draw over the whole screen wherever in the screen they are opened.
// Outside an app it adds nothing: lophn's own sheets are Modals.
export function SheetLayer({ children }: { children: ReactNode }) {
  const [sheets, setSheets] = useState<ReadonlyMap<string, ReactNode>>(
    new Map(),
  );
  const place = useMemo<Place>(
    () => (id, content) =>
      setSheets((current) => {
        if ((current.get(id) ?? null) === content) return current;
        // A sheet keeps its place while it is open; one that opens again comes last, on top.
        const next = new Map(current);
        if (content === null) next.delete(id);
        else next.set(id, content);
        return next;
      }),
    [],
  );
  if (!inAppScreen()) return children;
  return (
    <Layer.Provider value={place}>
      <View style={{ flex: 1 }}>
        {children}
        {[...sheets].map(([id, content]) => (
          <View
            key={id}
            style={StyleSheet.absoluteFill}
            pointerEvents="box-none"
          >
            {content}
          </View>
        ))}
      </View>
    </Layer.Provider>
  );
}

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  /** A quieter line under the label. */
  sub?: string;
  /** The current value at the end ("Ask when needed"). */
  end?: string;
  /** A destructive choice (delete, disconnect). */
  danger?: boolean;
  /** Marks the current choice in a pick-one menu. */
  selected?: boolean;
  /** Starts a group: a hairline above it. */
  apart?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  lead?: ReactNode;
  sub?: string;
  items: readonly MenuItem[];
}

// A list of actions in a sheet. Choosing one closes it.
export function Menu({ open, onClose, title, lead, sub, items }: MenuProps) {
  const theme = useTheme();
  return (
    <Sheet open={open} onClose={onClose} title={title} lead={lead} sub={sub}>
      {items.map((item) => (
        <View key={item.label}>
          {item.apart && (
            <View
              style={{
                height: 1,
                marginVertical: 6,
                marginHorizontal: 20,
                backgroundColor: theme.color.border.subtle,
              }}
            />
          )}
          <Ink
            color={
              item.danger
                ? theme.color.status.critical.text
                : theme.color.text.primary
            }
          >
            <Row
              lead={item.icon && <Icon icon={item.icon} />}
              title={item.label}
              sub={item.sub}
              end={item.end ?? (item.selected ? <SelectedMark /> : undefined)}
              onPress={() => {
                onClose();
                item.onSelect();
              }}
            />
          </Ink>
        </View>
      ))}
    </Sheet>
  );
}

function SelectedMark() {
  const theme = useTheme();
  return <Icon icon={CheckIcon} color={theme.color.text.primary} />;
}
