// Annotating an app's phone screen: tap a spot over the live screen, write what should change, and send it to the app's
// agent via `annotations/send` (the same path as desktop annotation).
import { t } from "@lophn/i18n";
import { Button, Input, Text, useTheme } from "@lophn/ui-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface SpotMark {
  readonly x: number;
  readonly y: number;
  readonly xRatio: number;
}

export function AnnotateOverlay({
  busy,
  failed,
  onCancel,
  onSend,
}: {
  busy: boolean;
  failed: boolean;
  onCancel: () => void;
  onSend: (note: string, spot: SpotMark) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [spot, setSpot] = useState<SpotMark | null>(null);
  const [note, setNote] = useState("");
  const ready = !busy && note.trim() !== "";
  const chosen = spot ?? { x: size.width / 2, y: size.height / 3, xRatio: 0.5 };

  return (
    <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 10 }}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.12)" }}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (width > 0 && height > 0) setSize({ width, height });
        }}
        onPress={(event) => {
          const { locationX, locationY } = event.nativeEvent;
          setSpot({
            x: locationX,
            y: locationY,
            xRatio: size.width > 0 ? locationX / size.width : 0.5,
          });
        }}
      >
        {spot !== null && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: spot.x - 14,
              top: spot.y - 14,
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: theme.color.ink.background,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 2,
              borderColor: theme.color.surface.base,
            }}
          >
            <Text variant="caption" weight="semibold" style={{ color: theme.color.surface.base }}>
              1
            </Text>
          </View>
        )}
      </Pressable>
      <View
        style={{
          backgroundColor: theme.color.surface.base,
          borderTopWidth: 1,
          borderTopColor: theme.color.border.base,
          paddingTop: 12,
          paddingHorizontal: 16,
          paddingBottom: Math.max(insets.bottom, 12) + 8,
          gap: 10,
        }}
      >
        <Text variant="caption" tone={failed ? "critical" : "muted"}>
          {failed ? t("mobile.apps.annotate.failed") : t("mobile.apps.annotate.hint")}
        </Text>
        <Input
          value={note}
          onChangeText={setNote}
          placeholder={t("mobile.apps.annotate.placeholder")}
        />
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button disabled={busy} onPress={onCancel}>
            {t("common.button.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            onPress={() => onSend(note.trim(), chosen)}
          >
            {t("mobile.apps.annotate.send")}
          </Button>
        </View>
      </View>
    </View>
  );
}
