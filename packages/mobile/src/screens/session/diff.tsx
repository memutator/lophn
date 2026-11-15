// A file change's diff, opened from its edit card. Like the desktop card it is built from the edit's own input (the text
// replaced and its replacement, or the whole new file), so line numbers count from the start of the change.
import { t } from "@lophn/i18n";
import { DiffLine, Screen, Text, TopBar } from "@lophn/ui-native";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import type { ThreadEntry } from "../../../../shell/renderer/conversation/agent-tab-source.ts";
import { flatEntries } from "../../../../shell/renderer/conversation/agent-view-model.ts";
import { compareLines } from "../../../../shell/renderer/line-diff.ts";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import { useConversation } from "../../data/mod.ts";

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The desktop edit card's rule (activity/file-edit-card.tsx): file.edit gives old_string and new_string, file.write the
// whole content. A harness gives the input as JSON text.
function diffOf(raw: unknown): ReturnType<typeof compareLines> | null {
  const value = typeof raw === "string" ? parseJson(raw) : raw;
  if (value === null || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const after =
    typeof input["new_string"] === "string"
      ? input["new_string"]
      : typeof input["content"] === "string"
        ? input["content"]
        : null;
  if (after === null) return null;
  const before = typeof input["old_string"] === "string" ? input["old_string"] : "";
  return compareLines(before, after);
}

export function DiffScreen({ place }: { place: PlaceOf<"diff"> }) {
  const nav = useNav();
  const { source, thread } = useConversation(place.session);
  const found = flatEntries(thread?.entries ?? []).find(
    (entry): entry is Extract<ThreadEntry, { kind: "edit" }> => entry.kind === "edit" && entry.id === place.entry,
  );
  const edit = found?.edit ?? null;
  const [lines, setLines] = useState<ReturnType<typeof compareLines> | null>(null);
  const [missing, setMissing] = useState(false);
  const call = edit?.id ?? null;
  useEffect(() => {
    if (call === null) return;
    let live = true;
    void source.toolCallBody(call, "input").then((read) => {
      if (!live) return;
      const diff = read.ok ? diffOf(read.value.value) : null;
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
