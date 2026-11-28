// Inbox, History: what apps and lophn recorded for the person (the desktop's History), found by text and by who wrote it.
import { t } from "@lophn/i18n";
import {
  Button,
  FilterChips,
  Icon,
  Input,
  Label,
  Row,
  Text,
} from "@lophn/ui-native";
import {
  Bell,
  Search,
  Check,
  ChevronRight,
  type LucideIcon,
  TriangleAlert,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useNav } from "../../app/nav.ts";
import {
  type HistoryFilter,
  NO_FILTER,
  type Notice,
  useInbox,
  useInboxHistory,
  useStartSession,
} from "../../data/mod.ts";
import { ago } from "../../parts/mod.ts";
import { KIND_LABEL } from "./waiting.ts";

const SOURCES = ["all", "app", "program"] as const;

const KIND_ICON: Partial<Record<Notice["kind"], LucideIcon>> = {
  release_activated: Check,
  release_failed: TriangleAlert,
  release_rolled_back: TriangleAlert,
  app_unavailable: TriangleAlert,
  session_stopped_by_app: TriangleAlert,
};

function dayOf(iso: string, now: Date): "today" | "yesterday" | "earlier" {
  const day = new Date(iso);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (day >= start) return "today";
  const before = new Date(start);
  before.setDate(before.getDate() - 1);
  return day >= before ? "yesterday" : "earlier";
}

const DAY_LABEL = {
  today: "common.label.range-today",
  yesterday: "mobile.inbox.group.yesterday",
  earlier: "conversation.label.group-earlier",
} as const;

export function History({ locked }: { locked: boolean }) {
  const nav = useNav();
  const inbox = useInbox();
  const startSession = useStartSession();
  const [typed, setTyped] = useState("");
  const [source, setSource] = useState(0);
  const [filter, setFilter] = useState<HistoryFilter>(NO_FILTER);
  const [failed, setFailed] = useState(false);
  // Read once typing pauses, not on every letter.
  useEffect(() => {
    const timer = setTimeout(
      () => setFilter({ ...NO_FILTER, type: SOURCES[source], query: typed }),
      250,
    );
    return () => clearTimeout(timer);
  }, [typed, source]);
  const { state, loadMore, reload } = useInboxHistory(filter);
  const rows = state.status === "ready" ? state.rows : [];
  const now = new Date();

  async function press(row: Notice) {
    if (row.read_at === null) void inbox.markRead([row.id]);
    if (row.app !== null) {
      nav.open({ name: "workspace", workspace: { kind: "app", id: row.app } });
    }
  }

  // The notice's button starts a conversation with lophn at Home, as the desktop's does. A reveal_received_files notice has no button: its path is a folder on the computer.
  async function ask(row: Notice) {
    if (row.action?.kind !== "open_home_skill") return;
    setFailed(false);
    const text = `/${row.action.skill} ${row.action.args}`.trim();
    const started = await startSession({ workspace: null, text });
    if (!started.ok) return setFailed(true);
    if (row.read_at === null) void inbox.markRead([row.id]);
    nav.open({ name: "session", ...started.value });
  }

  return (
    <View>
      <View
        style={{
          gap: 10,
          paddingTop: 12,
          paddingHorizontal: 20,
          paddingBottom: 4,
        }}
      >
        <Input
          soft
          compact
          icon={Search}
          value={typed}
          onChangeText={setTyped}
          placeholder={t("common.label.search")}
        />
        <FilterChips
          items={[
            t("mobile.inbox.filter.all"),
            t("waiting.label.type-app"),
            t("waiting.label.type-program"),
          ]}
          on={source}
          onChange={setSource}
        />
      </View>
      {failed && (
        <Text
          variant="note"
          tone="critical"
          style={{ marginHorizontal: 20, marginTop: 8 }}
        >
          {t("waiting.notice.action-failed")}
        </Text>
      )}
      {state.status === "loading" && (
        <Text tone="muted" style={{ margin: 20 }}>
          {t("waiting.notice.history-loading")}
        </Text>
      )}
      {state.status === "failed" && (
        <View style={{ margin: 20, alignItems: "flex-start", gap: 10 }}>
          <Text tone="muted">{t("mobile.inbox.history.failed")}</Text>
          <Button size="sm" onPress={reload}>
            {t("common.button.retry")}
          </Button>
        </View>
      )}
      {state.status === "ready" && rows.length === 0 && (
        <Text tone="muted" style={{ margin: 20 }}>
          {t(
            filter.query.trim() !== "" || filter.type !== "all"
              ? "waiting.notice.history-empty-filtered"
              : "waiting.notice.history-empty",
          )}
        </Text>
      )}
      {rows.map((row, at) => {
        const day = dayOf(row.created_at, now);
        const unread = row.read_at === null;
        const Glyph = KIND_ICON[row.kind] ?? Bell;
        return (
          <View key={row.id}>
            {(at === 0 || dayOf(rows[at - 1].created_at, now) !== day) && (
              <Label>{t(DAY_LABEL[day])}</Label>
            )}
            <Row
              lead={
                <Icon
                  icon={Glyph}
                  tone={
                    row.kind === "release_activated"
                      ? "good"
                      : Glyph === TriangleAlert
                        ? "warning"
                        : "muted"
                  }
                />
              }
              strong={unread}
              title={row.title}
              sub={
                row.body !== ""
                  ? row.body
                  : [
                      row.app_name,
                      row.kind === "app" ? null : t(KIND_LABEL[row.kind]),
                    ]
                      .filter((part) => part !== null)
                      .join(" · ")
              }
              end={
                <Text variant="small">
                  {ago(row.created_at, now.getTime())}
                </Text>
              }
              onPress={() => press(row)}
            />
            {row.action?.kind === "open_home_skill" && (
              <View
                style={{
                  alignItems: "flex-start",
                  paddingLeft: 56,
                  paddingBottom: 10,
                }}
              >
                <Button
                  size="sm"
                  trailingIcon={ChevronRight}
                  disabled={locked}
                  onPress={() => ask(row)}
                >
                  {t("waiting.button.ask-lophn")}
                </Button>
              </View>
            )}
          </View>
        );
      })}
      {state.status === "ready" && state.hasMore && (
        <View style={{ alignItems: "center", padding: 16 }}>
          <Button size="sm" onPress={loadMore}>
            {t("waiting.button.history-more")}
          </Button>
        </View>
      )}
    </View>
  );
}
