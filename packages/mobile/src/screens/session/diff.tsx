// A file change's diff, opened from its edit card. Like the desktop card it is built from the edit's own input (the text
// replaced and its replacement, or the whole new file), so line numbers count from the start of the change.
import { t } from "@lophn/i18n";
import { DiffLine, Screen, Text, TopBar } from "@lophn/ui-native";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import type { ThreadEntry } from "../../../../shell/renderer/conversation/agent-tab-source.ts";
import { flatEntries } from "../../../../shell/renderer/conversation/agent-view-model.ts";
import { editDiffOf } from "../../../../shell/renderer/conversation/activity/edit-diff.ts";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import { useConversation } from "../../data/mod.ts";

export function DiffScreen({ place }: { place: PlaceOf<"diff"> }) {
  const nav = useNav();
  const { source, thread } = useConversation(place.session);
  const found = flatEntries(thread?.entries ?? []).find(
    (entry): entry is Extract<ThreadEntry, { kind: "edit" }> => entry.kind === "edit" && entry.id === place.entry,
  );
  const edit = found?.edit ?? null;
  const [lines, setLines] = useState<ReturnType<typeof editDiffOf>>(null);
  const [missing, setMissing] = useState(false);
  const call = edit?.id ?? null;
  useEffect(() => {
    if (call === null) return;
    let live = true;
    void source.toolCallBody(call, "input").then((read) => {
      if (!live) return;
      const diff = read.ok ? editDiffOf(read.value.value) : null;
      if (diff === null) setMissing(true);
      else setLines(diff);
    });
    return () => {
      live = false;
    };
  }, [source, call]);

  const path = edit?.path ?? "";
  const cut = path.lastIndexOf("/");
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
        {missing && (
          <Text variant="small" tone="muted" style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            {t("conversation.notice.edit-diff-missing")}
          </Text>
        )}
        {(lines ?? []).map((line, at) => (
          <DiffLine
            key={at}
            no={String(line.newNumber ?? line.oldNumber)}
            text={line.text}
            kind={line.kind === "add" ? "add" : line.kind === "delete" ? "del" : undefined}
          />
        ))}
      </ScrollView>
    </Screen>
  );
}
