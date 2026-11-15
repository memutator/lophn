// Nothing to show, said the same way on every screen: a list says it in one quiet line where its first row would be; a
// whole screen says it in the middle under lophn's face (wireframe 5 Nothing waiting).
import { Text } from "@lophn/ui-native";
import { View } from "react-native";
import { Character, LOPHN } from "./face.tsx";

export function EmptyNote({ children }: { children: string }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 14 }}>
      <Text variant="control" tone="muted">
        {children}
      </Text>
    </View>
  );
}

/** Fills the screen's body, so the screen must not scroll while it shows. */
export function EmptyScreen({
  title,
  children,
}: {
  title: string;
  children: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 28,
      }}
    >
      <View style={{ opacity: 0.9 }}>
        <Character profile={LOPHN} size={64} />
      </View>
      <Text
        variant="heading"
        weight="semibold"
        align="center"
        style={{ marginTop: 14 }}
      >
        {title}
      </Text>
      <Text
        variant="control"
        tone="secondary"
        align="center"
        style={{ marginTop: 10 }}
      >
        {children}
      </Text>
    </View>
  );
}
