import { t } from "@lophn/i18n";
import { ArrowDown } from "lucide-react-native";
import {
  type ReactElement,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";
import { FlatList, Pressable, View } from "react-native";
import { Icon } from "../primitives/icon.tsx";
import { useTheme } from "../theme.tsx";

export interface MessageListProps<T> {
  /** Oldest first. */
  items: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactElement | null;
  /** Drawn after the newest item: the Working line. */
  tail?: ReactNode;
}

// Far enough from the newest item that the person is reading history, not following along.
const AWAY = 240;
// Space between a bubble, a turn and the working line.
const GAP = 18;

// The list is inverted: the newest item is the first row, so it stays in place while text streams in,
// the keyboard opens, or older items load above. A short thread sits at the bottom, by the composer.
export function MessageList<T>({
  items,
  keyOf,
  renderItem,
  tail,
}: MessageListProps<T>) {
  const theme = useTheme();
  const list = useRef<FlatList<T>>(null);
  const [away, setAway] = useState(false);
  const newestFirst = useMemo(() => [...items].reverse(), [items]);
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={list}
        inverted
        data={newestFirst}
        keyExtractor={keyOf}
        renderItem={({ item, index }) => (
          <View
            style={{ paddingTop: index === newestFirst.length - 1 ? 0 : GAP }}
          >
            {renderItem(item)}
          </View>
        )}
        ListHeaderComponent={
          tail === undefined ? undefined : (
            <View style={{ paddingTop: GAP }}>{tail}</View>
          )
        }
        // Inverted: the top padding here is the space above the composer.
        contentContainerStyle={{
          paddingTop: 10,
          paddingBottom: 8,
          paddingHorizontal: 16,
        }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={64}
        onScroll={(event) => setAway(event.nativeEvent.contentOffset.y > AWAY)}
      />
      {away && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("conversation.button.jump-latest")}
          onPress={() =>
            list.current?.scrollToOffset({ offset: 0, animated: true })
          }
          style={{
            position: "absolute",
            bottom: 12,
            alignSelf: "center",
            width: 40,
            height: 40,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: theme.color.border.base,
            backgroundColor: theme.color.surface.base,
            boxShadow: theme.shadow.popover,
          }}
        >
          <Icon icon={ArrowDown} size={20} />
        </Pressable>
      )}
    </View>
  );
}
