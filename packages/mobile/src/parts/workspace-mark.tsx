import { Icon, Mark, type MarkTone } from "@lophn/ui-native";
import * as Lucide from "lucide-react-native";
import { FolderOpen, Home, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Image, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { lucideComponentOf } from "../../../shell/renderer/parts/icon-upload/lucide-key.ts";
import { type SavedIcon, useSavedIcon, type WorkspaceIcon } from "../data/mod.ts";

// The kit Mark's sides and corners, so a picture sits where the mark would.
const SIDE = { sm: 24, lg: 56 } as const;
const PROJECT_RADIUS = { sm: 7, lg: 16 } as const;

/**
 * A workspace's mark: the Home icon, then the icon the phone keeps for a project or an app (an image, or an app's lucide
 * icon on its tone), else a project's folder or an app's colored letter. `lg` is the Home screen's app tile.
 */
export function WorkspaceMark({
  icon,
  name,
  size = "sm",
}: {
  icon: WorkspaceIcon;
  name: string;
  size?: "sm" | "lg";
}) {
  const kept = useSavedIcon(
    icon.kind === "home" ? "app" : icon.kind,
    icon.kind === "home" ? null : icon.id,
  );
  switch (icon.kind) {
    case "home":
      return <Icon icon={Home} size={19} />;
    case "project":
      return (
        <Picture icon={kept} size={size} radius={PROJECT_RADIUS[size]}>
          <Icon icon={FolderOpen} size={19} />
        </Picture>
      );
    case "app": {
      const glyph = kept !== null && "lucide" in kept ? lucideOf(kept.lucide) : undefined;
      return (
        <Picture icon={kept} size={size} radius={999}>
          <Mark
            kind="app"
            name={icon.letter || name}
            tone={icon.tone as MarkTone}
            size={size}
            icon={glyph}
          />
        </Picture>
      );
    }
  }
}

const lucideOf = (name: string): LucideIcon | undefined =>
  lucideComponentOf(Lucide as unknown as Record<string, unknown>, name) as LucideIcon | undefined;

/** The kept image in the mark's place; anything else (none, a lucide name) draws `children`. */
function Picture({
  icon,
  size,
  radius,
  children,
}: {
  icon: SavedIcon;
  size: "sm" | "lg";
  radius: number;
  children: ReactNode;
}) {
  if (icon === null || !("content_type" in icon)) return children;
  const side = SIDE[size];
  if (icon.content_type === "image/svg+xml") {
    let xml: string | null = null;
    try {
      xml = atob(icon.data);
    } catch {
      return children;
    }
    return (
      <View style={{ width: side, height: side, borderRadius: radius, overflow: "hidden" }}>
        <SvgXml xml={xml} width={side} height={side} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: `data:${icon.content_type};base64,${icon.data}` }}
      style={{ width: side, height: side, borderRadius: radius }}
    />
  );
}
