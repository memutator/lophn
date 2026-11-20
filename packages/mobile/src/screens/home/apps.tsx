import { t } from "@lophn/i18n";
import { Icon, Text, useTheme } from "@lophn/ui-native";
import { Plus } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { ComputerScope, type WorkspaceView } from "../../data/mod.ts";
import { WorkspaceMark } from "../../parts/mod.ts";

/** An app of one computer on Home. */
export interface AppTile {
  readonly computer: string;
  readonly app: WorkspaceView;
  /** Opens its running preview, and says so under its name. */
  readonly preview: boolean;
  /** Runs on a computer that is away: dimmed, and it does not open. */
  readonly dim: boolean;
}

/**
 * The apps as marks in rows of five (tools/wireframes/drafts/phone/shell.tsx Apps), of every computer the list shows.
 * Offline, the ones that run on the computer dim and do not open; the ones that run on this phone stay as they are.
 */
export function Apps({
  apps,
  onOpen,
  onNewApp,
}: {
  apps: readonly AppTile[];
  onOpen: (tile: AppTile) => void;
  onNewApp?: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        paddingTop: 2,
        paddingHorizontal: 12,
      }}
    >
      {apps.map((tile) => {
        const { app, preview, dim } = tile;
        const name = app.name ?? "";
        const mode = t("common.label.app-mode-preview");
        return (
          <Pressable
            key={`${tile.computer}:${app.key}`}
            accessibilityRole="button"
            accessibilityLabel={preview ? t("mobile.drive.list.app", { name }) : name}
            disabled={dim}
            onPress={() => onOpen(tile)}
            style={{
              width: "20%",
              alignItems: "center",
              gap: 6,
              paddingVertical: 6,
              paddingHorizontal: 2,
              opacity: dim ? 0.4 : 1,
            }}
          >
            {/* The scope gives the mark its computer's kept icon. */}
            <ComputerScope computer={tile.computer}>
              <WorkspaceMark icon={app.icon} name={name} size="lg" />
            </ComputerScope>
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
      {onNewApp !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("home.button.new-app")}
          onPress={onNewApp}
          style={{
            width: "20%",
            alignItems: "center",
            gap: 6,
            paddingVertical: 6,
            paddingHorizontal: 2,
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              backgroundColor: theme.color.surface.subtle,
              borderWidth: 1,
              borderColor: theme.color.border.base,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon icon={Plus} size={20} tone="muted" />
          </View>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {t("home.button.new-app")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
