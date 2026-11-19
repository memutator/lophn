// Adding pictures to a message: the rows of the "Add to the message" sheet (Photos, Camera) and the
// small line above the composer with what was chosen. Only pictures the core takes can be sent (data/attach.ts).
import { t } from "@lophn/i18n";
import { Icon, Row, Text, Thumb, useTheme } from "@lophn/ui-native";
import * as ImagePicker from "expo-image-picker";
import { Camera, Image as ImageIcon, X } from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import type { ContentBlock } from "../../../../protocol/lophn-agent/content-block.ts";
import {
  ATTACH_MAX_MB,
  type AgentTabSource,
  type Attached,
  type Candidate,
  readCandidates,
  type Refusal,
  uploadAttached,
  withAttached,
} from "../../data/mod.ts";

// Photos and camera shots are re-encoded as JPEG; a modern phone's original often passes the upload limit.
const QUALITY = 0.8;

// ---- pickers

function candidatesOf(result: ImagePicker.ImagePickerResult): Candidate[] {
  if (result.canceled) return [];
  return result.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.fileName ?? asset.uri.slice(asset.uri.lastIndexOf("/") + 1),
    size: asset.fileSize,
    mimeType: asset.mimeType,
  }));
}

// The system photo picker (Android 13 and up) hands over only the photos chosen, so it needs no permission.
const pickPhotos = async () =>
  candidatesOf(
    await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: QUALITY,
    }),
  );

const takePhoto = async () => candidatesOf(await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: QUALITY }));

// ---- the sheet's rows

export function AttachPicks({
  open,
  locked,
  computer,
  onClose,
  onPicked,
}: {
  open: boolean;
  /** The computer is offline: nothing can be uploaded now. */
  locked: boolean;
  computer: string;
  onClose: () => void;
  onPicked: (picked: Candidate[]) => void;
}) {
  const [cameraOff, setCameraOff] = useState(false);
  useEffect(() => {
    if (!open) return;
    void ImagePicker.getCameraPermissionsAsync()
      .then((permission) => setCameraOff(!permission.granted && !permission.canAskAgain))
      .catch(() => {});
  }, [open]);

  // The picker is another screen over the app: the sheet goes first, the choice is handed over when it comes back.
  const choose = (pick: () => Promise<Candidate[]>) => {
    onClose();
    void pick().then((picked) => {
      if (picked.length > 0) onPicked(picked);
    });
  };

  const camera = async () => {
    if (cameraOff) {
      void Linking.openSettings();
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setCameraOff(true);
      return;
    }
    choose(takePhoto);
  };

  const offline = locked ? t("mobile.session.label.attach-offline", { computer }) : undefined;
  return (
    <>
      <Row
        lead={<Icon icon={ImageIcon} />}
        title={t("mobile.session.label.attach-photos")}
        {...(offline === undefined ? {} : { sub: offline })}
        dim={locked}
        wrap
        {...(locked ? {} : { onPress: () => choose(pickPhotos) })}
      />
      <Row
        lead={<Icon icon={Camera} />}
        title={t("mobile.session.label.attach-camera")}
        {...(offline === undefined ? (cameraOff ? { sub: t("mobile.session.label.attach-camera-off") } : {}) : { sub: offline })}
        dim={locked}
        wrap
        {...(locked ? {} : { onPress: () => void camera() })}
      />
    </>
  );
}

// ---- what was chosen

function noteOf(refusal: Refusal): string {
  switch (refusal.why) {
    case "big":
      return t("mobile.session.notice.attach-big", { name: refusal.name, limit: ATTACH_MAX_MB });
    case "kind":
      return t("mobile.session.notice.attach-kind", { name: refusal.name });
    case "unreadable":
      return t("mobile.session.notice.attach-unreadable", { name: refusal.name });
  }
}

export interface Attachments {
  readonly items: readonly Attached[];
  /** Why something was not added, or why the last send did not go. Each line is shown until the next change. */
  readonly notes: readonly string[];
  readonly uploading: boolean;
  add(picked: Candidate[]): Promise<void>;
  remove(item: Attached): void;
  /** Puts back what a message that was not taken carried. */
  restore(items: readonly Attached[]): void;
  clear(): void;
  /** Uploads what is chosen. Null when one failed (the list stays so the person can send again). */
  upload(source: AgentTabSource): Promise<ContentBlock[] | null>;
}

export interface PersistedAttachments {
  readonly items: readonly Attached[];
  update(fn: (current: readonly Attached[]) => readonly Attached[]): void;
}

export function useAttachments(persisted?: PersistedAttachments): Attachments {
  const [local, setLocal] = useState<readonly Attached[]>([]);
  const [notes, setNotes] = useState<readonly string[]>([]);
  const [uploading, setUploading] = useState(false);
  const items = persisted ? persisted.items : local;
  const update = persisted?.update;
  const setItems = useCallback(
    (fn: (current: readonly Attached[]) => readonly Attached[]) => {
      if (update !== undefined) update(fn);
      else setLocal(fn);
    },
    [update],
  );
  return {
    items,
    notes,
    uploading,
    add: useCallback(
      async (picked) => {
        const { added, refused } = await readCandidates(picked);
        setItems((current) => withAttached(current, added));
        setNotes(refused.map(noteOf));
      },
      [setItems],
    ),
    remove: useCallback(
      (item) => {
        setItems((current) => current.filter((one) => one !== item));
        setNotes([]);
      },
      [setItems],
    ),
    restore: useCallback(
      (back) => setItems((current) => withAttached(back, current)),
      [setItems],
    ),
    clear: useCallback(() => {
      setItems(() => []);
      setNotes([]);
    }, [setItems]),
    upload: useCallback(
      async (source) => {
        setNotes([]);
        setUploading(true);
        const uploaded = await uploadAttached(source, items);
        setUploading(false);
        if (uploaded.ok) return uploaded.value;
        setNotes([t("conversation.error.attach-failed")]);
        return null;
      },
      [items],
    ),
  };
}

/** The line above the composer's text: a small picture for each one chosen, each with a way to take it out. */
export function attachedAbove(attachments: Attachments): ReactNode {
  const { items, notes, uploading, remove } = attachments;
  if (items.length === 0 && notes.length === 0) return undefined;
  return (
    <>
      {items.map((item) => (
        <View key={item.uri} style={{ opacity: uploading ? 0.5 : 1 }}>
          <Thumb source={{ uri: item.uri }} />
          {!uploading && <RemoveMark name={item.name} onPress={() => remove(item)} />}
        </View>
      ))}
      {uploading && (
        <Text variant="caption" tone="muted" style={{ width: "100%" }}>
          {t("mobile.session.label.attach-uploading")}
        </Text>
      )}
      {notes.map((note) => (
        <Text key={note} variant="caption" tone="critical" style={{ width: "100%" }}>
          {note}
        </Text>
      ))}
    </>
  );
}

function RemoveMark({ name, onPress }: { name: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("conversation.button.remove-attachment", { name })}
      onPress={onPress}
      hitSlop={8}
      style={{
        position: "absolute",
        top: 4,
        right: 4,
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.color.ink.background,
      }}
    >
      <Icon icon={X} size={12} strokeWidth={2} color={theme.color.ink.text} />
    </Pressable>
  );
}
