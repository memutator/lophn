// The message box at the bottom of Home: a message starts a new session in the chosen workspace (the Home of the computer
// on screen by default) and opens it. The workspaces are those of every reached computer the list shows; the box sends
// through the chosen one's computer (mount it inside that computer's `ComputerScope`). Offline it is locked and says who
// cannot be reached.
import { t } from "@lophn/i18n";
import { Chip, Composer, Icon, Mark, Row, Sheet } from "@lophn/ui-native";
import { Check, FolderOpen, Home } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import {
  ComputerScope,
  type ConversationTarget,
  useStartSession,
  type WorkspaceView,
} from "../../data/mod.ts";
import { WorkspaceMark } from "../../parts/mod.ts";

/** A workspace the box can start a session in, and its computer. */
export interface Choice {
  readonly computer: string;
  /** The computer's name, said while more than one computer shows; null otherwise. */
  readonly tag: string | null;
  readonly workspace: WorkspaceView;
}

export const choiceKey = (choice: Choice) =>
  `${choice.computer}:${choice.workspace.key}`;

function ChipLead({ workspace }: { workspace: WorkspaceView }) {
  switch (workspace.icon.kind) {
    case "home":
      return <Icon icon={Home} size={15} />;
    case "project":
      return <Icon icon={FolderOpen} size={15} />;
    case "app":
      return (
        <Mark
          kind="app"
          name={workspace.icon.letter}
          tone={workspace.icon.tone as 0}
        />
      );
  }
}

const nameOf = ({ workspace, tag }: Choice) =>
  workspace.name ??
  (tag === null
    ? t("left-sidebar.label.home")
    : t("mobile.computer.label.home-on", { computer: tag }));

export function HomeComposer({
  choices,
  picked,
  onPick,
  locked,
  unreachable,
  onStarted,
  onFailed,
}: {
  choices: readonly Choice[];
  /** The chosen workspace; the box sends through its computer's scope. */
  picked: Choice | undefined;
  onPick: (choice: Choice) => void;
  /** The computer cannot be reached: nothing can be sent. */
  locked: boolean;
  /** What the box says while locked. */
  unreachable: string;
  onStarted: (target: ConversationTarget) => void;
  /** The session did not start: the person is told, and the message stays in the box. */
  onFailed: (failed: boolean) => void;
}) {
  const start = useStartSession();
  const [draft, setDraft] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [sending, setSending] = useState(false);

  async function send() {
    if (picked === undefined) return;
    setSending(true);
    onFailed(false);
    const started = await start({
      workspace: picked.workspace.workspace,
      text: draft.trim(),
    });
    setSending(false);
    if (!started.ok) {
      onFailed(true);
      return;
    }
    setDraft("");
    onStarted(started.value);
  }

  return (
    <>
      <Composer
        value={draft}
        onChangeText={(text) => {
          setDraft(text);
          onFailed(false);
        }}
        onSend={send}
        placeholder={
          locked ? unreachable : t("mobile.home.placeholder.ask")
        }
        disabled={locked || sending}
        chips={
          locked || picked === undefined ? undefined : (
            <Chip
              lead={<ChipLead workspace={picked.workspace} />}
              onPress={() => setChoosing(true)}
            >
              {nameOf(picked)}
            </Chip>
          )
        }
      />
      <Sheet
        open={choosing}
        onClose={() => setChoosing(false)}
        title={t("left-sidebar.heading.workspaces")}
      >
        {choices.map((one) => (
          <Row
            key={choiceKey(one)}
            lead={
              <View style={{ width: 24, alignItems: "center" }}>
                <ComputerScope computer={one.computer}>
                  <WorkspaceMark icon={one.workspace.icon} name={nameOf(one)} />
                </ComputerScope>
              </View>
            }
            title={nameOf(one)}
            sub={one.workspace.name === null ? undefined : (one.tag ?? undefined)}
            strong
            end={
              picked !== undefined && choiceKey(one) === choiceKey(picked) ? (
                <Icon icon={Check} />
              ) : undefined
            }
            onPress={() => {
              onPick(one);
              setChoosing(false);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}
