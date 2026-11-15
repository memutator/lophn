import { ArrowDown } from "lucide-react-native";
import {
  type ReactElement,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";
import { FlatList, View } from "react-native";
import { IconButton } from "../primitives/icon-button.tsx";
import { useTheme } from "../theme.tsx";

export interface MessageListProps<T> {
  /** Oldest first. */
  items: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactElement | null;
  /** Drawn after the newest item: text still streaming, the working row, a card waiting on the person. */
  tail?: ReactNode;
}

// Far enough from the newest item that the person is reading history, not following along.
const AWAY = 240;

// The list is inverted: the newest item is the first row, so it stays in place while text streams in, the keyboard opens, or older items load above.
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
        renderItem={({ item }) => (
          <View
            style={{
              paddingHorizontal: theme.space[6],
              paddingVertical: theme.space[3],
            }}
          >
            {renderItem(item)}
          </View>
        )}
        ListHeaderComponent={
          tail === undefined ? undefined : (
            <View
              style={{
                paddingHorizontal: theme.space[6],
                paddingVertical: theme.space[3],
                gap: theme.space[5],
              }}
            >
              {tail}
            </View>
          )
        }
        contentContainerStyle={{ paddingVertical: theme.space[4] }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={64}
        onScroll={(event) => setAway(event.nativeEvent.contentOffset.y > AWAY)}
      />
      {away && (
        <View
          style={{
            position: "absolute",
            bottom: theme.space[5],
            alignSelf: "center",
            borderRadius: theme.radius.full,
            borderWidth: 1,
            borderColor: theme.color.border.base,
            backgroundColor: theme.color.surface.base,
          }}
        >
          <IconButton
            icon={ArrowDown}
            label="Go to latest"
            onPress={() =>
              list.current?.scrollToOffset({ offset: 0, animated: true })
            }
          />
        </View>
      )}
    </View>
  );
}
