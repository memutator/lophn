// Pieces the project and app workspace screens share: a sentence's relative time, a retry line, and the box at the bottom that opens
// a new session in the workspace.
import { formatRelativeTime, t } from "@lophn/i18n";
import { Button, Chip, Composer, Text } from "@lophn/ui-native";
import { useState } from "react";
import { View } from "react-native";
import { LOPHN_AGENT_NAME } from "../../../../protocol/lophn-agent/agent-values.ts";
import { useNav } from "../../app/nav.ts";
import { useStartSession, type Workspace } from "../../data/mod.ts";
import { Face, LOPHN, useUnreachable } from "../../parts/mod.ts";

/** How long ago inside a sentence (Went live 2 days ago); lists and meta lines use the short `ago`. */
export const when = (at: string | number): string =>
  formatRelativeTime(new Date(at), new Date());

/** What a list says when its read failed, with a way to read again. */
export function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={{ alignItems: "flex-start", gap: 10, padding: 20 }}>
      <Text tone="muted">{t("mobile.places.failed")}</Text>
      <Button size="sm" onPress={onRetry}>
        {t("common.button.retry")}
      </Button>
    </View>
  );
}


/**
 * The message box at the bottom of a workspace screen: sending opens a new session in the workspace with its lophn and
 * goes to it. The agent chip leads to the new-session screen, where another agent can be picked; what was typed goes along.
 */
export function AskBar({
  workspace,
  placeholder,
  wrap = (text) => text,
}: {
  workspace: Workspace;
  placeholder: string;
  /** What is sent for the text typed (the file reader names its file). */
  wrap?: (text: string) => string;
}) {
  const nav = useNav();
  const start = useStartSession();
  const unreachable = useUnreachable();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const send = async () => {
    if (sending) return;
    setSending(true);
    setFailed(false);
    const started = await start({ workspace, text: wrap(text.trim()) });
    setSending(false);
    if (!started.ok) {
      setFailed(true);
      return;
    }
    setText("");
    nav.open({ name: "session", ...started.value });
  };
  return (
    <View>
      {failed && (
        <Text
          variant="small"
          tone="critical"
          style={{ paddingHorizontal: 20, paddingTop: 6 }}
        >
          {t("conversation.error.action-failed")}
        </Text>
      )}
      <Composer
        value={text}
        onChangeText={setText}
        onSend={() => void send()}
        placeholder={unreachable ?? placeholder}
        disabled={sending || unreachable !== null}
        chips={
          unreachable !== null ? undefined : (
            <Chip
              lead={<Face profile={LOPHN} size={18} />}
              onPress={() =>
                nav.open({
                  name: "new-session",
                  workspace,
                  ...(text.trim() === "" ? {} : { text: wrap(text.trim()) }),
                })
              }
            >
              {LOPHN_AGENT_NAME}
            </Chip>
          )
        }
      />
    </View>
  );
}
