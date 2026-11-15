import { Text } from "@lophn/ui-native";
import { Pressable, View } from "react-native";
import type { WorkspaceView } from "../../data/mod.ts";
import { WorkspaceMark } from "../../parts/mod.ts";

/** The apps as marks in rows of five (tools/wireframes/drafts/phone/shell.tsx Apps). Offline they dim and do not open. */
export function Apps({
  apps,
  offline,
  onOpen,
}: {
  apps: readonly WorkspaceView[];
  offline?: boolean;
  onOpen: (app: WorkspaceView) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        paddingTop: 2,
        paddingHorizontal: 12,
      }}
    >
      {apps.map((app) => {
        const name = app.name ?? "";
        return (
          <Pressable
            key={app.key}
            accessibilityRole="button"
            accessibilityLabel={name}
            disabled={offline}
            onPress={() => onOpen(app)}
            style={{
              width: "20%",
              alignItems: "center",
              gap: 6,
              paddingVertical: 6,
              paddingHorizontal: 2,
              opacity: offline ? 0.4 : 1,
            }}
          >
            <WorkspaceMark icon={app.icon} name={name} size="lg" />
            <Text variant="caption" numberOfLines={1}>
              {name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

