// A new session (tools/wireframes/drafts/phone/session.tsx Fresh, Agents): pick where and who, then the first message
// opens the session and goes to its conversation, as the desktop's first message does. Only agents that can work in the
// chosen workspace are offered. In a project the computer's coding agents are offered too; picking one opens it on the
// computer (no first message here: it is sent in the conversation) and goes to its chat.
import { t } from "@lophn/i18n";
import {
  Chip,
  Composer,
  Icon,
  Label,
  Pill,
  Row,
  Screen,
  Sheet,
  Text,
  TopBar,
} from "@lophn/ui-native";
import { StackActions, useNavigation } from "@react-navigation/native";
import { Check } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import type { AcpSessionMeta } from "../../../../protocol/acp/mod.ts";
import { textBlocks } from "../../../../protocol/lophn-agent/content-block.ts";
import { type AgentId, lophnIdOf, type Workspace } from "../../../../protocol/lophn-agent/workspaces.ts";
import { useModelPicker } from "../../../../shell/renderer/conversation/use-model-picker.ts";
import { newId } from "../../../../shell/renderer/prefixed-id.ts";
import { type PlaceOf, paramsOf, useNav } from "../../app/nav.ts";
import { type AgentChoice, useAgentChoices, useConversation, useWorkspaces, type WorkspaceView } from "../../data/mod.ts";
import { Face, LOPHN, useUnreachable, WorkspaceMark } from "../../parts/mod.ts";
import { CodingAgentGroup } from "../coding/index.tsx";
import { ModelSheet } from "./sheets.tsx";

const sameWorkspace = (a: Workspace | null, b: Workspace | null) =>
  a === null ? b === null : b !== null && a.kind === b.kind && a.id === b.id;

function nameOf(workspace: WorkspaceView): string {
  return workspace.name ?? t("left-sidebar.label.home");
}

/** The session meta a new session would get: models, the default model, commands. */
function useDraftMeta(source: ReturnType<typeof useConversation>["source"]): AcpSessionMeta | null {
  const [meta, setMeta] = useState<AcpSessionMeta | null>(null);
  useEffect(() => {
    setMeta(null);
    let live = true;
    void source.draft?.().then((read) => {
      if (live && read.ok) setMeta(read.value);
    });
    return () => {
      live = false;
    };
  }, [source]);
  return meta;
}

export function NewSessionScreen({ place }: { place: PlaceOf<"new-session"> }) {
  const nav = useNav();
  const navigation = useNavigation();
  const workspaces = useWorkspaces();
  const unreachable = useUnreachable();
  const [workspace, setWorkspace] = useState<Workspace | null>(place.workspace ?? null);
  const [agent, setAgent] = useState<AgentId>(place.agent ?? lophnIdOf(place.workspace ?? null));
  const [sheet, setSheet] = useState<"workspace" | "agent" | "model" | null>(null);
  const [draft, setDraft] = useState(place.text ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<{ model: string; options: Record<string, string> } | null>(null);

  // The id the session will get when the first message opens it. Until then the conversation hook reads nothing for it;
  // only its source (the agent's draft meta and face) is used.
  const [session] = useState(() => newId("ses"));
  const target = useMemo(() => ({ session, agent, workspace }), [session, agent, workspace]);
  const { source, agent: face } = useConversation(target);
  const choices = useAgentChoices(workspace);
  const drafted = useDraftMeta(source);
  // The model picked here is saved when the session opens (the desktop's pending model).
  const meta: AcpSessionMeta | null =
    drafted === null || pending === null
      ? drafted
      : {
          ...drafted,
          model: {
            model: pending.model,
            label: drafted.models.flatMap((group) => group.models).find((one) => one.id === pending.model)?.label ?? pending.model,
            options: pending.options,
            layer: "session",
          },
        };
  const picker = useModelPicker({
    meta,
    effort: meta?.capabilities.effort ?? true,
    session: null,
    onChoose: async (model, options) => {
      setPending({ model, options });
      return true;
    },
    onProblem: () => {},
    canUseRole: false,
    onUseRole: async () => false,
  }).props;

  const shown = workspaces.find((one) => sameWorkspace(one.workspace, workspace));
  const workspaceName = shown === undefined ? t("left-sidebar.label.home") : nameOf(shown);
  const who: AgentChoice | null =
    choices.find((one) => one.agent === agent) ??
    (face === null || face === undefined ? null : { agent, name: face.name, profile: face.profile, scoped: false });
  // The workspace's own lophn is always there, even before the list is read.
  const listed: readonly AgentChoice[] =
    who !== null && !choices.some((one) => one.agent === who.agent) ? [who, ...choices] : choices;

  const start = async () => {
    const text = draft.trim();
    if (text === "" || busy) return;
    setBusy(true);
    setFailed(false);
    const opened = await source.openSession({ id: session });
    if (opened.ok && pending !== null) {
      // Not saved: the session keeps the agent's default model, as on the desktop.
      await source.act(session, { type: "set_model", session, key: newId("model"), ...pending });
    }
    const message = newId("msg");
    const sent = opened.ok
      ? await source.send({
          session,
          id: message,
          key: `session-messages-send-${message}`,
          content: textBlocks(text),
          delivery: "next_turn",
        })
      : opened;
    setBusy(false);
    if (!sent.ok) {
      setFailed(true);
      return;
    }
    navigation.dispatch(
      StackActions.replace("session", paramsOf({ name: "session", session, agent, workspace })),
    );
  };

  return (
    <Screen
      top={<TopBar {...nav.menuButton} title={t("left-sidebar.label.new-session")} />}
      footer={
        <>
          {failed && (
            <Text variant="note" tone="critical" style={{ marginHorizontal: 24, marginBottom: 4 }}>
              {t("conversation.error.open-failed")}
            </Text>
          )}
          <Composer
            value={draft}
            onChangeText={setDraft}
            onSend={() => void start()}
            placeholder={unreachable ?? t("mobile.session.placeholder.new")}
            disabled={busy || unreachable !== null}
            chips={
              unreachable !== null || meta === null || !meta.capabilities.model ? undefined : (
                <Chip onPress={() => setSheet("model")}>{picker.currentLabel}</Chip>
              )
            }
          />
        </>
      }
    >
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}>
        <Face profile={who?.profile ?? LOPHN} size={60} />
        <Text variant="h1" weight="semibold" align="center" style={{ marginTop: 14 }}>
          {t("mobile.session.title.new", { agent: who?.name ?? "lophn" })}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 16 }}>
          <Pill
            tall
            lead={shown === undefined ? undefined : <WorkspaceMark icon={shown.icon} name={workspaceName} />}
            onPress={() => setSheet("workspace")}
          >
            {workspaceName}
          </Pill>
          <Pill
            tall
            lead={who === null ? undefined : <Face profile={who.profile} size={18} />}
            onPress={() => setSheet("agent")}
          >
            {who?.name ?? ""}
          </Pill>
        </View>
      </View>

      <Sheet open={sheet === "workspace"} onClose={() => setSheet(null)} title={t("left-sidebar.heading.workspaces")}>
        {workspaces.map((one) => (
          <Row
            key={one.key}
            lead={<WorkspaceMark icon={one.icon} name={nameOf(one)} />}
            title={nameOf(one)}
            end={sameWorkspace(one.workspace, workspace) ? <Icon icon={Check} /> : undefined}
            onPress={() => {
              setWorkspace(one.workspace);
              setAgent(lophnIdOf(one.workspace));
              setPending(null);
              setSheet(null);
            }}
          />
        ))}
      </Sheet>
      <Sheet open={sheet === "agent"} onClose={() => setSheet(null)} title={t("mobile.session.title.agents")}>
        <Label>{t("left-sidebar.button.agents")}</Label>
        {listed.map((one) => (
          <Row
            key={one.agent}
            lead={<Face profile={one.profile} size={30} />}
            title={one.name}
            strong
            sub={
              one.agent === lophnIdOf(workspace)
                ? t("mobile.session.label.agent-lophn")
                : one.scoped
                  ? t("mobile.session.label.agent-only-in", { workspace: workspaceName })
                  : t("mobile.session.label.agent-everywhere")
            }
            end={one.agent === agent ? <Icon icon={Check} /> : undefined}
            onPress={() => {
              setAgent(one.agent);
              setPending(null);
              setSheet(null);
            }}
          />
        ))}
        {workspace?.kind === "project" && <CodingAgentGroup project={workspace.id} />}
      </Sheet>
      <ModelSheet picker={picker} open={sheet === "model"} onClose={() => setSheet(null)} />
    </Screen>
  );
}
