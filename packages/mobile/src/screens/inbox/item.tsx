import { t } from "@lophn/i18n";
import { Text } from "@lophn/ui-native";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import type { AgentId } from "../../data/mod.ts";
import { Character, LOPHN } from "../../parts/mod.ts";
import { isLophn } from "./waiting.ts";

const OTHER_AGENT = {
  kind: "character",
  shape: "arch",
  color: "sage",
} as const;

/** Whoever asks: lophn, or any other agent (the card model does not read agent definitions either). */
export function Asker({ agent }: { agent: AgentId | null }) {
  return (
    <Character
      profile={agent === null || isLophn(agent) ? LOPHN : OTHER_AGENT}
      size={24}
    />
  );
}

/** One thing waiting: who asks, what, from where, and the answer buttons under it. */
export function Item({
  face,
  title,
  onTitle,
  age,
  text,
  meta,
  error,
  children,
}: {
  face: ReactNode;
  title: string;
  /** Pressing the title goes where the thing came from. */
  onTitle?: () => void;
  age: string;
  text?: string;
  meta?: string;
  /** Why the answer did not go through, in the item's place. */
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 10,
        paddingTop: 12,
        paddingBottom: 14,
        paddingHorizontal: 20,
      }}
    >
      <View style={{ paddingTop: 1 }}>{face}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <Text
            weight="semibold"
            onPress={onTitle}
            style={{ lineHeight: 22, flexShrink: 1 }}
          >
            {title}
          </Text>
          <Text variant="note" tone="muted" style={{ marginTop: 2 }}>
            {age}
          </Text>
        </View>
        {text !== undefined && text !== "" && (
          <Text
            variant="control"
            tone="secondary"
            style={{ marginTop: 2, lineHeight: 21 }}
          >
            {text}
          </Text>
        )}
        {meta !== undefined && meta !== "" && (
          <Text variant="note" tone="muted" style={{ marginTop: 2 }}>
            {meta}
          </Text>
        )}
        {children}
        {error != null && (
          <Text variant="note" tone="critical" style={{ marginTop: 8 }}>
            {error}
          </Text>
        )}
      </View>
    </View>
  );
}

/** Buttons at the right end, the main one last. */
export function Buttons({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "flex-end",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 10,
      }}
    >
      {children}
    </View>
  );
}

type Done =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string };

function reasonOf(code: string): string {
  switch (code) {
    case "conflict":
    case "not_found":
      return t("mobile.inbox.error.changed");
    case "unavailable":
      return t("mobile.inbox.error.unreachable");
    default:
      return t("waiting.notice.decide-failed");
  }
}

/** Sends one answer at a time. The item leaves the list by itself once the computer says it is answered. */
export function useAnswering() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    busy,
    error,
    async send(answer: () => Promise<Done>): Promise<boolean> {
      setBusy(true);
      setError(null);
      const done = await answer().catch(
        () => ({ ok: false, code: "unavailable" }) as const,
      );
      setBusy(false);
      if (!done.ok) setError(reasonOf(done.code));
      return done.ok;
    },
  };
}
