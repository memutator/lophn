// The message box at the bottom of Home: a message starts a new session in the chosen workspace (Home by default) and
// opens it. Offline it is locked and says who cannot be reached.
import { t } from "@lophn/i18n";
import { Chip, Composer, Icon, Mark, Row, Sheet } from "@lophn/ui-native";
import { Check, FolderOpen, Home } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import {
  type ConversationTarget,
  useStartSession,
  type WorkspaceView,
} from "../../data/mod.ts";
import { WorkspaceMark } from "../../parts/mod.ts";

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

const nameOf = (workspace: WorkspaceView) =>
  workspace.name ?? t("left-sidebar.label.home");

export function HomeComposer({
  workspaces,
  locked,
  unreachable,
  onStarted,
  onFailed,
}: {
  workspaces: readonly WorkspaceView[];
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
  const [picked, setPicked] = useState("home");
  const [choosing, setChoosing] = useState(false);
  const [sending, setSending] = useState(false);
  const workspace =
    workspaces.find((one) => one.key === picked) ?? workspaces[0];

  async function send() {
    if (workspace === undefined) return;
    setSending(true);
    onFailed(false);
    const started = await start({
      workspace: workspace.workspace,
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
          locked || workspace === undefined ? undefined : (
            <Chip
              lead={<ChipLead workspace={workspace} />}
              onPress={() => setChoosing(true)}
            >
              {nameOf(workspace)}
            </Chip>
          )
        }
      />
      <Sheet
        open={choosing}
        onClose={() => setChoosing(false)}
        title={t("left-sidebar.heading.workspaces")}
      >
        {workspaces.map((one) => (
          <Row
            key={one.key}
            lead={
              <View style={{ width: 24, alignItems: "center" }}>
                <WorkspaceMark icon={one.icon} name={nameOf(one)} />
              </View>
            }
            title={nameOf(one)}
            strong
            end={one.key === workspace?.key ? <Icon icon={Check} /> : undefined}
            onPress={() => {
              setPicked(one.key);
              setChoosing(false);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}
