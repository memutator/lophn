// A file change's diff, opened from its edit card. Built from the edit's input or unified-diff output via `loadEditDiff`.
import { t } from "@lophn/i18n";
import { DiffLine, Screen, Text, TopBar } from "@lophn/ui-native";
import { useEffect, useMemo, useState } from "react";
import { ScrollView } from "react-native";
import type { ThreadEntry, ThreadView } from "../../../../shell/renderer/conversation/agent-tab-source.ts";
import { flatEntries } from "../../../../shell/renderer/conversation/agent-view-model.ts";
import { type EditDiffLine, loadEditDiff } from "../../../../shell/renderer/conversation/activity/edit-diff.ts";
import { createLayoutCache, layoutOf } from "../../../../shell/renderer/conversation/thread-layout.ts";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import { useConversation } from "../../data/mod.ts";

function findEdit(
  thread: ThreadView | null,
  entryId: string,
): Extract<ThreadEntry, { kind: "edit" }>["edit"] | null {
  if (thread === null) return null;
  const direct = flatEntries(thread.entries).find(
    (entry): entry is Extract<ThreadEntry, { kind: "edit" }> =>
      entry.kind === "edit" && entry.id === entryId,
  );
  if (direct !== undefined) return direct.edit;
  for (const child of Object.values(thread.children)) {
    const nested = flatEntries(layoutOf(child, createLayoutCache()).entries).find(
      (entry): entry is Extract<ThreadEntry, { kind: "edit" }> =>
        entry.kind === "edit" && entry.id === entryId,
    );
    if (nested !== undefined) return nested.edit;
  }
  return null;
}

export function DiffScreen({ place }: { place: PlaceOf<"diff"> }) {
  const nav = useNav();
  const { source, thread } = useConversation(place.session);
  const edit = useMemo(() => findEdit(thread, place.entry), [thread, place.entry]);
  const [lines, setLines] = useState<readonly EditDiffLine[] | null>(null);
  const [missing, setMissing] = useState(false);
  const call = edit?.id ?? null;
  useEffect(() => {
    if (call === null) return;
    let live = true;
    setMissing(false);
    setLines(null);
    loadEditDiff(source.toolCallBody, call).then(
      (diff) => {
        if (!live) return;
        if (diff === null) setMissing(true);
        else setLines(diff);
      },
      () => {
        if (live) setMissing(true);
      },
    );
    return () => {
      live = false;
    };
  }, [source, call]);

  const path = edit?.path ?? "";
  const cut = path.lastIndexOf("/");
  const unavailable = missing || (thread !== null && edit === null);
  return (
    <Screen
      top={
        <TopBar
          left="back"
          onLeft={nav.back}
          title={cut === -1 ? path : path.slice(cut + 1)}
          under={
            edit === null
              ? undefined
              : t("mobile.session.label.diff-under", {
                  folder: cut === -1 ? "." : path.slice(0, cut),
                  added: edit.added,
                  removed: edit.removed,
                })
          }
        />
      }
    >
      <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 24 }}>
        {unavailable && (
          <Text variant="small" tone="muted" style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            {t("conversation.notice.edit-diff-missing")}
          </Text>
        )}
        {(lines ?? []).map((line, at) => (
          <DiffLine
            key={at}
            no={String(line.newNumber ?? line.oldNumber ?? "")}
            text={line.text}
            kind={line.kind === "add" ? "add" : line.kind === "delete" ? "del" : undefined}
          />
        ))}
      </ScrollView>
    </Screen>
  );
}
