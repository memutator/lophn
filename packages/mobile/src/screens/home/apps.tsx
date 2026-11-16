import { t } from "@lophn/i18n";
import { Text } from "@lophn/ui-native";
import { Pressable, View } from "react-native";
import type { WorkspaceView } from "../../data/mod.ts";
import { WorkspaceMark } from "../../parts/mod.ts";

/**
 * The apps as marks in rows of five (tools/wireframes/drafts/phone/shell.tsx Apps). Offline, the ones that run on the
 * computer (`away`) dim and do not open; the ones that run on this phone stay as they are. An app in `previews` opens its
 * running preview, and says so under its name.
 */
export function Apps({
  apps,
  away,
  previews,
  onOpen,
}: {
  apps: readonly WorkspaceView[];
  away?: (app: WorkspaceView) => boolean;
  previews?: ReadonlySet<string>;
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
        const dim = away?.(app) ?? false;
        const preview = previews?.has(app.key) === true;
        const mode = t("common.label.app-mode-preview");
        return (
          <Pressable
            key={app.key}
            accessibilityRole="button"
            accessibilityLabel={preview ? t("mobile.drive.list.app", { name }) : name}
            disabled={dim}
            onPress={() => onOpen(app)}
            style={{
              width: "20%",
              alignItems: "center",
              gap: 6,
              paddingVertical: 6,
              paddingHorizontal: 2,
              opacity: dim ? 0.4 : 1,
            }}
          >
            <WorkspaceMark icon={app.icon} name={name} size="lg" />
            <Text variant="caption" numberOfLines={1}>
              {name}
            </Text>
            {preview && (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {mode}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
