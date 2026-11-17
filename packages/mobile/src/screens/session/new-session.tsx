// A new session (tools/wireframes/drafts/phone/session.tsx Fresh, Agents): pick where and who, then the first message
// opens the session and goes to its conversation, as the desktop's first message does. Only agents that can work in the
// chosen workspace are offered. In a project the computer's coding agents are offered in the same sheet
// (tools/wireframes/drafts/phone/coding.tsx Pick, The first message): picking one opens nothing; the first message
// opens it in a new terminal tab on the computer, is sent to it, and goes to its chat.
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
  Working,
} from "@lophn/ui-native";
import { StackActions, useNavigation } from "@react-navigation/native";
import { Check, Monitor } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import type { AcpCommand, AcpSessionMeta } from "../../../../protocol/acp/mod.ts";
import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import type { GuiHarness } from "../../../../protocol/extensions/mod.ts";
import { textBlocks } from "../../../../protocol/lophn-agent/content-block.ts";
import { type AgentId, lophnIdOf, type Workspace } from "../../../../protocol/lophn-agent/workspaces.ts";
import { capabilitiesOf, slashEntriesOf } from "../../../../shell/renderer/conversation/agent-view-model.ts";
import { useModelPicker } from "../../../../shell/renderer/conversation/use-model-picker.ts";
import { newId } from "../../../../shell/renderer/prefixed-id.ts";
import { type PlaceOf, paramsOf, useNav } from "../../app/nav.ts";
import {
  type AgentChoice,
  useAgentChoices,
  useCodingActions,
  useConversation,
  useCurrentComputer,
  useWorkspaces,
  type WorkspaceView,
} from "../../data/mod.ts";
import { Face, LOPHN, useUnreachable, WorkspaceMark } from "../../parts/mod.ts";
import { CodingAgentGroup, harnessProfile, problemText } from "../coding/index.tsx";
import { attachedAbove, useAttachments } from "./attach.tsx";
import { AttachSheet, CommandsSheet, FilesSheet, ModelSheet } from "./sheets.tsx";

// Before the session exists only a command that is a plain slash command or opens the model sheet can be used here.
const BEFORE_SESSION: ReadonlySet<AcpCommand["opens"]> = new Set([null, "model", "effort"]);

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
  // A coding agent of the computer picked instead of a lophn agent.
  const [harness, setHarness] = useState<GuiHarness | null>(null);
  const [sheet, setSheet] = useState<"workspace" | "agent" | "model" | "attach" | "files" | "commands" | null>(null);
  const attachments = useAttachments();
  const computer = useCurrentComputer()?.name ?? "";
  const [draft, setDraft] = useState(place.text ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const coding = useCodingActions();
  // The coding session a first message opened when sending to it then failed: trying again sends into it rather than
  // opening a second terminal tab.
  const [codingOpened, setCodingOpened] = useState<{ project: string; harness: string; session: string } | null>(null);
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
  const lophn: AgentChoice | null =
    choices.find((one) => one.agent === agent) ??
    (face === null || face === undefined ? null : { agent, name: face.name, profile: face.profile, scoped: false });
  // The workspace's own lophn is always there, even before the list is read.
  const listed: readonly AgentChoice[] =
    lophn !== null && !choices.some((one) => one.agent === lophn.agent) ? [lophn, ...choices] : choices;
  const who =
    harness === null
      ? lophn
      : { name: HARNESS_ADAPTERS[harness].label, profile: harnessProfile(harness, HARNESS_ADAPTERS[harness].label) };

  const caps = capabilitiesOf(meta);
  // The agent's commands that make sense before a session exists (the desktop drops the ones that need a session).
  const usable = new Set(slashEntriesOf(meta?.commands ?? [], "", false).map((entry) => entry.name));
  const commands = (meta?.commands ?? []).filter((command) => usable.has(command.name) && BEFORE_SESSION.has(command.opens));
  const canCommand = caps.commands && commands.length > 0;
  const project = workspace?.kind === "project" ? workspace.id : null;

  // The coding agent's first message: open it on the computer (once), send the words, go to its chat. On a failure the
  // words stay in the composer.
  const startCoding = async (text: string): Promise<string | null> => {
    if (harness === null || project === null) return null;
    const label = HARNESS_ADAPTERS[harness].label;
    let opened = codingOpened?.project === project && codingOpened.harness === harness ? codingOpened.session : null;
    if (opened === null) {
      const open = await coding.open({ project, harness });
      if (!open.ok) return problemText(open.code, open.message, label, computer);
      opened = open.value.session;
      setCodingOpened({ project, harness, session: opened });
    }
    const message = newId("msg");
    const sent = await coding.send(opened, { id: message, key: `session-messages-send-${message}`, text });
    if (!sent.ok) return t("mobile.coding.error.send-failed", { harness: label, computer });
    navigation.dispatch(
      StackActions.replace("session", paramsOf({ name: "session", session: opened, coding: { harness, project, cwd: null } })),
    );
    return null;
  };

  const start = async () => {
    const text = draft.trim();
    const pictures = attachments.items;
    if ((text === "" && pictures.length === 0) || busy || attachments.uploading) return;
    if (harness !== null && project !== null) {
      // Words only: the phone attaches no pictures to a coding agent.
      if (text === "") return;
      setBusy(true);
      setProblem(null);
      const failed = await startCoding(text);
      setBusy(false);
      setProblem(failed);
      return;
    }
    setBusy(true);
    setProblem(null);
    // `/name argument` runs a command the agent lists, as in a conversation.
    const slash = /^\/(\S+)\s*([\s\S]*)$/.exec(text);
    const command =
      slash === null || pictures.length > 0 ? undefined : commands.find((one) => one.name === slash[1] && one.opens === null);
    // Pictures go up first; if one does not, nothing opens and the words and pictures stay as they are.
    const uploaded = pictures.length === 0 ? [] : await attachments.upload(source);
    if (uploaded === null) {
      setBusy(false);
      return;
    }
    const opened = await source.openSession({ id: session });
    if (opened.ok && pending !== null) {
      // Not saved: the session keeps the agent's default model, as on the desktop.
      await source.act(session, { type: "set_model", session, key: newId("model"), ...pending });
    }
    const message = newId("msg");
    const sent = !opened.ok
      ? opened
      : command !== undefined
        ? await source.act(session, {
            type: "run_command",
            session,
            key: newId("cmd"),
            name: command.name,
            argument: slash![2]!.trim(),
          })
        : await source.send({
            session,
            id: message,
            key: `session-messages-send-${message}`,
            content: [...(text === "" ? [] : textBlocks(text)), ...uploaded],
            delivery: "next_turn",
            seen: null,
          });
    setBusy(false);
    if (!sent.ok) {
      setProblem(t("conversation.error.open-failed"));
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
          {problem !== null && (
            <Text variant="note" tone="critical" style={{ marginHorizontal: 24, marginBottom: 4 }}>
              {problem}
            </Text>
          )}
          {harness !== null && (
            <View
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 20, paddingBottom: 2 }}
            >
              {busy ? (
                <Working>{t("mobile.coding.notice.opening", { computer })}</Working>
              ) : (
                <>
                  <Icon icon={Monitor} size={14} tone="muted" />
                  <Text variant="note" tone="muted">
                    {t("mobile.coding.notice.new-terminal")}
                  </Text>
                </>
              )}
            </View>
          )}
          <Composer
            value={draft}
            onChangeText={setDraft}
            onSend={() => void start()}
            placeholder={unreachable ?? t("mobile.session.placeholder.new")}
            above={attachedAbove(attachments)}
            canSend={attachments.items.length > 0}
            onAttach={harness === null && (caps.images || project !== null || canCommand) ? () => setSheet("attach") : undefined}
            disabled={busy || unreachable !== null || attachments.uploading}
            chips={
              harness !== null || unreachable !== null || meta === null || !meta.capabilities.model ? undefined : (
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
              setHarness(null);
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
            end={harness === null && one.agent === agent ? <Icon icon={Check} /> : undefined}
            onPress={() => {
              setAgent(one.agent);
              setHarness(null);
              setPending(null);
              setSheet(null);
            }}
          />
        ))}
        {project !== null && (
          <CodingAgentGroup
            project={project}
            picked={harness}
            onPick={(picked) => {
              setHarness(picked);
              setSheet(null);
            }}
          />
        )}
      </Sheet>
      <AttachSheet
        open={sheet === "attach"}
        onClose={() => setSheet(null)}
        agent={who?.name ?? ""}
        workspace={project === null ? null : { name: workspaceName }}
        pictures={caps.images}
        computer={computer}
        offline={unreachable !== null}
        onPicked={(picked) => void attachments.add(picked)}
        onFile={project === null ? null : () => setSheet("files")}
        onCommands={canCommand ? () => setSheet("commands") : null}
      />
      {project !== null && (
        <FilesSheet
          project={project}
          name={workspaceName}
          open={sheet === "files"}
          onClose={() => setSheet(null)}
          onPick={(path) => {
            setDraft((text) => (text === "" || text.endsWith(" ") ? `${text}${path} ` : `${text} ${path} `));
            setSheet(null);
          }}
        />
      )}
      <CommandsSheet
        commands={commands}
        open={sheet === "commands"}
        onClose={() => setSheet(null)}
        onPick={(command) => {
          if (command.opens === null) {
            setDraft(`/${command.name} `);
            setSheet(null);
          } else setSheet("model");
        }}
      />
      <ModelSheet picker={picker} open={sheet === "model"} onClose={() => setSheet(null)} />
    </Screen>
  );
}
