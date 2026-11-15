// Agents and one agent (tools/wireframes/drafts/phone/more.tsx Agents, AgentDetail). The phone shows them and opens a new
// session with one; creating and editing stay on the computer.
import { formatRelativeTime, t } from "@lophn/i18n";
import {
  Button,
  Label,
  Row,
  Screen,
  Tag,
  Text,
  TopBar,
  Icon,
} from "@lophn/ui-native";
import { ChevronRight, MessageSquarePlus } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import { useCurrentComputer } from "../../data/mod.ts";
import {
  type AgentItem,
  type AgentSession,
  useAgents,
  useAgentSessions,
  useAgentTakes,
} from "../../data/ops.ts";
import { Face } from "../../parts/mod.ts";
import { FactRow, Foot, OfflineBanner, ReadFailed } from "../jobs/parts.tsx";

const DIM = 0.45;
const NEXT = <Icon icon={ChevronRight} size={16} />;

function scopeText(agent: AgentItem): string {
  switch (agent.scope.kind) {
    case "home":
      return t("agents.label.workspace-home");
    case "every":
      return t("mobile.ops.agent.scope-every");
    case "in":
      return agent.scope.name;
  }
}

function ListRow({
  agent,
  sessions,
  onPress,
}: {
  agent: AgentItem;
  sessions: readonly AgentSession[];
  onPress: () => void;
}) {
  return (
    <Row
      lead={<Face profile={agent.face} size={36} />}
      title={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            weight="medium"
            numberOfLines={1}
            style={{ lineHeight: 22, flexShrink: 1 }}
          >
            {agent.name}
          </Text>
          {agent.builtIn && <Tag>{t("agents.label.built-in")}</Tag>}
        </View>
      }
      sub={
        agent.coding
          ? t("mobile.ops.agent.sessions", {
              sessions: sessions.length,
              working: sessions.filter((one) => one.working).length,
            })
          : agent.model === null
            ? scopeText(agent)
            : t("mobile.ops.agent.line", {
                scope: scopeText(agent),
                model: agent.model,
              })
      }
      end={NEXT}
      onPress={onPress}
    />
  );
}

export function AgentsScreen(_: { place: PlaceOf<"agents"> }) {
  const nav = useNav();
  const { loaded, locked, reload } = useAgents();
  const sessions = useAgentSessions();
  const computer = useCurrentComputer();
  const items = loaded.state === "ready" ? loaded.value : [];
  const row = (agent: AgentItem) => (
    <ListRow
      key={agent.id}
      agent={agent}
      sessions={sessions.get(agent.id) ?? []}
      onPress={() => nav.open({ name: "agent", id: agent.id })}
    />
  );
  return (
    <Screen
      top={
        <TopBar {...nav.menuButton} title={t("left-sidebar.button.agents")} />
      }
      scroll
    >
      {locked && <OfflineBanner />}
      <View style={{ opacity: locked ? DIM : 1, marginTop: locked ? 12 : 0 }}>
        {loaded.state === "failed" && (
          <ReadFailed
            target={t("project-workspace.label.agents-target")}
            onRetry={reload}
          />
        )}
        {loaded.state === "ready" && (
          <>
            <Label>{t("left-sidebar.button.agents")}</Label>
            {items.filter((one) => !one.coding).map(row)}
            {items.some((one) => one.coding) && (
              <>
                <Label>
                  {t("mobile.ops.agents.coding", {
                    computer: computer?.name ?? "",
                  })}
                </Label>
                {items.filter((one) => one.coding).map(row)}
              </>
            )}
          </>
        )}
      </View>
    </Screen>
  );
}

export function AgentScreen({ place }: { place: PlaceOf<"agent"> }) {
  const nav = useNav();
  const { loaded, locked, reload } = useAgents();
  const agent =
    loaded.state === "ready"
      ? loaded.value.find((one) => one.id === place.id)
      : undefined;
  // A coding agent is the person's own product; what it takes in is not lophn's to say.
  const takes = useAgentTakes(agent?.coding ? undefined : agent);
  const recent = (useAgentSessions().get(place.id) ?? []).slice(0, 5);
  const now = new Date();
  const works: ReactNode =
    agent === undefined
      ? null
      : agent.scope.kind === "every"
        ? t("mobile.ops.agent.works-everywhere")
        : t("mobile.ops.agent.works-only-in", {
            name: scopeText(agent),
          });
  return (
    <Screen
      top={
        <TopBar
          left="back"
          onLeft={nav.back}
          title={t("left-sidebar.button.agents")}
        />
      }
      scroll
      footer={
        agent !== undefined && (
          <View
            style={{
              gap: 8,
              paddingTop: 12,
              paddingHorizontal: 20,
              paddingBottom: 10,
            }}
          >
            <Button
              variant="primary"
              size="lg"
              icon={MessageSquarePlus}
              disabled={locked}
              onPress={() =>
                nav.open({
                  name: "new-session",
                  agent: agent.id,
                  ...(agent.workspace === null
                    ? {}
                    : { workspace: agent.workspace }),
                })
              }
            >
              {t("conversation.button.session-new")}
            </Button>
            <Foot>{t("mobile.ops.agent.on-computer")}</Foot>
          </View>
        )
      }
    >
      {locked && <OfflineBanner />}
      <View style={{ opacity: locked ? DIM : 1, marginTop: locked ? 12 : 0 }}>
        {loaded.state === "failed" && (
          <ReadFailed
            target={t("project-workspace.label.agents-target")}
            onRetry={reload}
          />
        )}
        {agent !== undefined && (
          <>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 14,
                paddingTop: 6,
                paddingBottom: 12,
                paddingHorizontal: 20,
              }}
            >
              <Face profile={agent.face} size={64} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="heading" weight="semibold">
                  {agent.name}
                </Text>
                <Text variant="note" tone="muted">
                  {works}
                </Text>
              </View>
            </View>
            {agent.description !== null && (
              <Text
                variant="control"
                style={{ marginHorizontal: 20, marginBottom: 6 }}
              >
                {agent.description}
              </Text>
            )}
            {agent.model !== null && (
              <FactRow label={t("conversation.label.status-model")}>
                {agent.model}
              </FactRow>
            )}
            {agent.skills !== null && (
              <FactRow label={t("mobile.ops.agent.label-can-use")}>
                {t("mobile.ops.agent.skills", { count: agent.skills })}
              </FactRow>
            )}
            {takes !== null && (
              <FactRow label={t("agents.label.modality-input")}>
                {takes
                  .map((one) => t(`agents.label.modality-${one}` as const))
                  .join(", ")}
              </FactRow>
            )}
            <Label>{t("mobile.ops.agent.recent")}</Label>
            {recent.length === 0 && (
              <Text
                variant="note"
                tone="muted"
                style={{ marginHorizontal: 20 }}
              >
                {t("mobile.ops.agent.no-sessions")}
              </Text>
            )}
            {recent.map((one) => (
              <Row
                key={one.target.session}
                lead={<Face profile={agent.face} />}
                title={one.title ?? t("conversation.label.session-untitled")}
                sub={t("mobile.ops.agent.session-line", {
                  workspace:
                    one.workspaceName ?? t("agents.label.workspace-home"),
                  time: formatRelativeTime(new Date(one.at), now),
                })}
                onPress={() => nav.open({ name: "session", ...one.target })}
              />
            ))}
          </>
        )}
      </View>
    </Screen>
  );
}
