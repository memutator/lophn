// The sheets a conversation opens: what the agent did (with each step's input and output read when opened), its
// reasoning, adding to the message, the model and effort, the session menu and what hangs off it.
import { t } from "@lophn/i18n";
import {
  Button,
  Divider,
  Icon,
  Input,
  Label,
  Markdown,
  Menu,
  Pre,
  Row,
  SegmentedControl,
  Sheet,
  Switch,
  Text,
} from "@lophn/ui-native";
import {
  Archive,
  ArrowUp,
  AtSign,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Gauge,
  Pencil,
  Search,
  ShieldCheck,
  SquareSlash,
  Trash2,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import type { AcpCommand, AcpSessionMeta } from "../../../../protocol/acp/mod.ts";
import type { ToolCallView } from "../../../../shell/renderer/conversation/activity/model.ts";
import type {
  AgentTabSource,
  PermissionsView,
  QueuedView,
  SourceResult,
  ToolCallBodyView,
} from "../../../../shell/renderer/conversation/agent-tab-source.ts";
import type { ModelPickerProps } from "../../../../shell/renderer/conversation/model-picker/types.ts";
import {
  compactTokens,
  contextPercent,
} from "../../../../shell/renderer/conversation/status-view/status-summary.ts";
import { vendorOf } from "../../../../shell/renderer/parts/vendor-icon/vendors.ts";
import { Face, type Profile, VendorIcon } from "../../parts/mod.ts";
import { useProjectFiles } from "./data.ts";
import { elapsedText, toolIcon } from "./parts.tsx";

const pad = { paddingHorizontal: 20 } as const;

// ---- what the agent did

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// The desktop tool line's input and output text (activity/tool-line.tsx, a DOM file): a command as typed and its
// stdout and stderr, anything else as JSON.
function inputText(call: ToolCallView, body: ToolCallBodyView): string {
  if (body.truncated || typeof body.value === "string") return String(body.value);
  const command = call.tool === "shell.run" ? recordOf(body.value)?.["command"] : undefined;
  return typeof command === "string" ? command : (JSON.stringify(body.value, null, 2) ?? "");
}

function outputText(call: ToolCallView, body: ToolCallBodyView): string {
  if (body.truncated || typeof body.value === "string") return String(body.value);
  if (call.tool === "shell.run") {
    const content = recordOf(recordOf(body.value)?.["content"]);
    if (content !== null) {
      return [content["stdout"], content["stderr"]]
        .filter((text): text is string => typeof text === "string" && text !== "")
        .join("\n");
    }
  }
  const content = recordOf(body.value)?.["content"] ?? body.value;
  return typeof content === "string" ? content : (JSON.stringify(content, null, 2) ?? "");
}

type Read = SourceResult<ToolCallBodyView>;

/** One step. Opening it reads its input and output once; an output already known (a harness shell run) is shown as is. */
function Step({
  call,
  output,
  initiallyOpen,
  readBody,
}: {
  call: ToolCallView;
  output: string | null;
  initiallyOpen: boolean;
  readBody: AgentTabSource["toolCallBody"];
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [body, setBody] = useState<{ input: Read; output: Read } | null>(null);
  useEffect(() => {
    if (!open || body !== null) return;
    let live = true;
    void Promise.all([readBody(call.id, "input"), readBody(call.id, "output")]).then(([input, out]) => {
      if (live) setBody({ input, output: out });
    });
    return () => {
      live = false;
    };
  }, [open, body, call.id, readBody]);
  const time = elapsedText(call.state === "running", call.startedAt, call.durationMs);
  const shownOutput =
    output ?? (body?.output.ok === true ? outputText(call, body.output.value) : null);
  const failed = [body?.input, body?.output].some((read) => read !== undefined && !read.ok && read.code !== "not_found");
  return (
    <>
      <Row
        lead={<Icon icon={toolIcon(call)} />}
        title={call.title}
        end={time === "" ? undefined : time}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <View style={{ ...pad, paddingTop: 4, paddingBottom: 10, gap: 8 }}>
          {body?.input.ok === true && call.tool !== "shell.run" && (
            <View style={{ gap: 4 }}>
              <Text variant="caption" tone="muted">
                {t("conversation.label.tool-input")}
              </Text>
              <Pre wrap>{inputText(call, body.input.value)}</Pre>
            </View>
          )}
          {shownOutput !== null && shownOutput !== "" && (
            <View style={{ gap: 4 }}>
              {call.tool !== "shell.run" && (
                <Text variant="caption" tone="muted">
                  {t("conversation.label.tool-output")}
                </Text>
              )}
              <Pre wrap>{call.tool === "shell.run" && body?.input.ok === true ? `> ${inputText(call, body.input.value)}\n${shownOutput}` : shownOutput}</Pre>
            </View>
          )}
          {(body?.input.ok === true && body.input.value.truncated) || (body?.output.ok === true && body.output.value.truncated) ? (
            <Text variant="caption" tone="muted">
              {t("conversation.note.tool-body-truncated")}
            </Text>
          ) : null}
          {failed && (
            <Text variant="caption" tone="critical">
              {t("conversation.error.tool-body-failed")}
            </Text>
          )}
        </View>
      )}
    </>
  );
}

export function StepsSheet({
  agent,
  calls,
  output,
  readBody,
  onClose,
}: {
  agent: string;
  calls: readonly ToolCallView[] | null;
  output: string | null;
  readBody: AgentTabSource["toolCallBody"];
  onClose: () => void;
}) {
  return (
    <Sheet open={calls !== null} onClose={onClose} title={t("mobile.session.title.steps", { agent })}>
      {(calls ?? []).map((call) => (
        <Step
          key={call.id}
          call={call}
          output={output}
          // A single command opens with its output, as the wireframe shows it.
          initiallyOpen={calls!.length === 1}
          readBody={readBody}
        />
      ))}
    </Sheet>
  );
}

export function ThoughtSheet({ text, onClose }: { text: string | null; onClose: () => void }) {
  return (
    <Sheet open={text !== null} onClose={onClose} title={t("conversation.label.thought")}>
      <View style={{ ...pad, paddingBottom: 8 }}>
        <Markdown variant="chat" source={text ?? ""} />
      </View>
    </Sheet>
  );
}

// ---- adding to the message

export function AttachSheet({
  open,
  onClose,
  agent,
  workspace,
  onFile,
  onCommands,
}: {
  open: boolean;
  onClose: () => void;
  agent: string;
  /** The project to point at a file of; null when the workspace has no files to browse (Home, an app). */
  workspace: { name: string } | null;
  onFile: (() => void) | null;
  onCommands: (() => void) | null;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={t("mobile.session.title.attach")}>
      {workspace !== null && onFile !== null && (
        <Row
          lead={<Icon icon={AtSign} />}
          title={t("mobile.session.label.workspace-file", { workspace: workspace.name })}
          sub={t("mobile.session.label.workspace-file-sub", { agent })}
          onPress={onFile}
        />
      )}
      {onCommands !== null && (
        <Row
          lead={<Icon icon={SquareSlash} />}
          title={t("mobile.session.label.commands")}
          sub={t("mobile.session.label.commands-sub")}
          onPress={onCommands}
        />
      )}
    </Sheet>
  );
}

/** A project's folders and files; picking a file gives its path relative to the project folder. */
export function FilesSheet({
  project,
  name,
  open,
  onClose,
  onPick,
}: {
  project: string;
  name: string;
  open: boolean;
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const [path, setPath] = useState("");
  const entries = useProjectFiles(project, path);
  const up = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return (
    <Sheet open={open} onClose={onClose} title={path === "" ? name : path}>
      {path !== "" && (
        <Row lead={<Icon icon={FolderOpen} />} title=".." onPress={() => setPath(up)} />
      )}
      {entries.map((entry) => {
        const full = path === "" ? entry.name : `${path}/${entry.name}`;
        return (
          <Row
            key={entry.name}
            lead={<Icon icon={entry.kind === "folder" ? FolderOpen : FileText} />}
            title={entry.name}
            end={entry.kind === "folder" ? <Icon icon={ChevronRight} size={16} /> : undefined}
            onPress={() => (entry.kind === "folder" ? setPath(full) : onPick(full))}
          />
        );
      })}
    </Sheet>
  );
}

export function CommandsSheet({
  commands,
  open,
  onClose,
  onPick,
}: {
  commands: readonly AcpCommand[];
  open: boolean;
  onClose: () => void;
  onPick: (command: AcpCommand) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={t("conversation.label.slash-menu")}>
      {commands.map((command) => (
        <Row
          key={command.name}
          lead={<Icon icon={SquareSlash} />}
          title={`/${command.name}`}
          sub={command.description}
          onPress={() => onPick(command)}
        />
      ))}
    </Sheet>
  );
}

// ---- model

/**
 * The desktop picker's values (use-model-picker.ts) as a sheet: models grouped by provider, the current one checked, and
 * the current model's axes (effort first) under them. Adding and removing models is done on the computer.
 */
export function ModelSheet({
  picker,
  open,
  onClose,
}: {
  picker: ModelPickerProps;
  open: boolean;
  onClose: () => void;
}) {
  const current = picker.current;
  const [shown, setShown] = useState<string | null>(current.provider);
  // The current model's provider opens unfolded each time the sheet does.
  useEffect(() => {
    if (open) setShown(current.provider);
  }, [open, current.provider]);
  const searching = picker.query.trim() !== "";
  return (
    <Sheet open={open} onClose={onClose} title={t("conversation.label.status-model")}>
      <View style={{ ...pad, paddingBottom: 6 }}>
        <Input
          soft
          compact
          icon={Search}
          value={picker.query}
          onChangeText={picker.onQueryChange}
          placeholder={t("conversation.label.search-models")}
        />
      </View>
      {picker.layout.providers.length === 0 && (
        <Text variant="small" tone="muted" style={{ ...pad, paddingVertical: 12 }}>
          {t("conversation.notice.no-models")}
        </Text>
      )}
      {picker.layout.providers.map((group) => {
        const vendor = vendorOf(group.label);
        const unfolded = searching || shown === group.provider;
        return (
          <View key={group.provider}>
            <Row
              lead={
                <View style={{ width: 24, alignItems: "center" }}>
                  {vendor !== undefined && <VendorIcon vendor={vendor} size={20} />}
                </View>
              }
              title={group.label}
              strong
              end={<Icon icon={unfolded ? ChevronDown : ChevronRight} size={16} />}
              onPress={() => setShown(unfolded ? null : group.provider)}
            />
            {unfolded &&
              group.models.map((model) => (
                <Row
                  key={model.modelName}
                  lead={<View style={{ width: 24 }} />}
                  title={model.label ?? model.modelName}
                  end={
                    model.modelName === current.modelName && group.provider === current.provider ? (
                      <Icon icon={Check} />
                    ) : undefined
                  }
                  onPress={() => picker.onPick(model)}
                />
              ))}
          </View>
        );
      })}
      {picker.axes.length > 0 && <Divider spacing={12} />}
      {picker.axes.map((axis) =>
        axis.kind === "switch" ? (
          <Row
            key={axis.id}
            title={axis.label}
            end={
              <Switch
                label={axis.label}
                on={picker.optionValues[axis.id] === axis.values[1]?.value}
                onChange={(on) => picker.onOptionChange(axis.id, axis.values[on ? 1 : 0]!.value)}
              />
            }
          />
        ) : (
          <View key={axis.id} style={{ ...pad, gap: 8, paddingBottom: 8 }}>
            <Text variant="small" weight="medium" tone="muted">
              {axis.label}
            </Text>
            <SegmentedControl
              items={axis.values.map((value) => value.label)}
              on={axis.values.findIndex((value) => value.value === picker.optionValues[axis.id])}
              onChange={(at) => picker.onOptionChange(axis.id, axis.values[at]!.value)}
            />
          </View>
        ),
      )}
    </Sheet>
  );
}

// ---- the session menu

export function SessionMenu({
  open,
  onClose,
  profile,
  title,
  where,
  mode,
  context,
  canRename,
  onRename,
  onPermissions,
  onContext,
  onArchive,
}: {
  open: boolean;
  onClose: () => void;
  profile: Profile;
  title: string;
  where: string;
  /** The current permission mode's name, when the source has modes. */
  mode: string | null;
  /** "8% of 1.05M", when the source says how full the context window is. */
  context: string | null;
  canRename: boolean;
  onRename: () => void;
  onPermissions: () => void;
  onContext: () => void;
  onArchive: (() => void) | null;
}) {
  return (
    <Menu
      open={open}
      onClose={onClose}
      lead={<Face profile={profile} size={34} />}
      title={title}
      sub={where}
      items={[
        ...(canRename ? [{ label: t("conversation.button.rename"), icon: Pencil, onSelect: onRename }] : []),
        {
          label: t("mobile.session.button.permissions"),
          icon: ShieldCheck,
          ...(mode === null ? {} : { end: mode }),
          onSelect: onPermissions,
        },
        ...(context === null
          ? []
          : [{ label: t("mobile.session.button.context"), icon: Gauge, end: context, onSelect: onContext }]),
        ...(onArchive === null
          ? []
          : [{ label: t("conversation.button.archive"), icon: Archive, apart: true, onSelect: onArchive }]),
      ]}
    />
  );
}

/** "8% of 1.05M", or null when the source does not say. */
export function contextLine(meta: AcpSessionMeta | null): string | null {
  const context = meta?.usage?.context ?? null;
  if (context === null) return null;
  return t("conversation.label.status-footer-context", {
    percent: contextPercent(context),
    limit: compactTokens(context.limit),
  });
}

export function RenameSheet({
  open,
  title,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSave: (title: string) => void;
}) {
  const [value, setValue] = useState(title);
  useEffect(() => {
    if (open) setValue(title);
  }, [open, title]);
  const save = () => {
    if (value.trim() !== "") onSave(value.trim());
  };
  return (
    <Sheet open={open} onClose={onClose} title={t("conversation.label.rename-session", { title })}>
      <View style={{ ...pad, gap: 12, paddingBottom: 8 }}>
        <Input value={value} onChangeText={setValue} autoFocus onSubmit={save} />
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Button variant="primary" disabled={value.trim() === ""} onPress={save}>
            {t("conversation.button.save")}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

/** Read only: the permission mode and the apps the agent may use. Changing them is done on the computer. */
export function PermissionsSheet({
  open,
  agent,
  mode,
  view,
  onClose,
}: {
  open: boolean;
  agent: string;
  mode: string | null;
  view: PermissionsView | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={t("conversation.label.permissions-of", { agent })}>
      {mode !== null && <Row lead={<Icon icon={ShieldCheck} />} title={t("conversation.label.permission-mode")} end={mode} />}
      <Label>{t("conversation.label.permissions-may", { agent })}</Label>
      {view !== null && view.apps.length === 0 && (
        <Text variant="small" tone="muted" style={pad}>
          {t("conversation.notice.permissions-no-apps")}
        </Text>
      )}
      {(view?.apps ?? []).map((app) => (
        <Row
          key={app.name}
          title={app.name}
          sub={
            app.removed.length === 0
              ? t("conversation.label.permissions-all-tools")
              : t("conversation.label.permissions-except", { tools: app.removed.join(", ") })
          }
          wrap
        />
      ))}
      <Text variant="caption" tone="muted" style={{ ...pad, paddingTop: 12 }}>
        {t("conversation.notice.permissions-mcp")}
      </Text>
    </Sheet>
  );
}

export function ContextSheet({
  open,
  meta,
  onClose,
}: {
  open: boolean;
  meta: AcpSessionMeta | null;
  onClose: () => void;
}) {
  const context = meta?.usage?.context ?? null;
  return (
    <Sheet open={open} onClose={onClose} title={t("conversation.label.status-context")}>
      {context !== null && (
        <>
          <Text style={{ ...pad, paddingBottom: 8 }}>
            {t("conversation.label.status-context-value", {
              used: context.tokens,
              limit: context.limit,
              percent: contextPercent(context),
            })}
          </Text>
          {context.parts.map((part) => (
            <Row key={part.label} title={part.label} end={compactTokens(part.tokens)} />
          ))}
        </>
      )}
    </Sheet>
  );
}

/** A message waiting for the next turn: send it into the running turn now, or take it out. */
export function QueuedMenu({
  queued,
  onClose,
  onSendNow,
  onRemove,
}: {
  queued: QueuedView | null;
  onClose: () => void;
  onSendNow: ((queued: QueuedView) => void) | null;
  onRemove: (queued: QueuedView) => void;
}) {
  return (
    <Menu
      open={queued !== null}
      onClose={onClose}
      title={queued?.summary}
      items={[
        ...(onSendNow === null
          ? []
          : [{ label: t("conversation.button.send-now"), icon: ArrowUp, onSelect: () => queued && onSendNow(queued) }]),
        { label: t("conversation.button.queued-remove"), icon: Trash2, danger: true, onSelect: () => queued && onRemove(queued) },
      ]}
    />
  );
}
