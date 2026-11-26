// The sheets a conversation opens: what the agent did (with each step's input and output read when opened), its
// reasoning, a subagent's conversation, adding to the message, the commands, the model and effort, the session menu and
// what hangs off it, and the reason for a Deny (which the Inbox and Home use too).
import { t } from "@lophn/i18n";
import {
  Button,
  Card,
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
  StatusMark,
  Switch,
  Tag,
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
  GitBranch,
  Pencil,
  Search,
  ShieldCheck,
  SquareSlash,
  Trash2,
  Undo2,
  X,
} from "lucide-react-native";
import { useContext, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { type AcpChildState, type AcpSessionMeta, EMPTY_ACP_CHILD_STATE } from "../../../../protocol/acp/mod.ts";
import { PERMISSION_MODES, type PermissionMode } from "../../../../protocol/lophn-agent/turn-values.ts";
import { elapsedText } from "../../../../shell/renderer/conversation/activity/elapsed.ts";
import type { ToolCallView } from "../../../../shell/renderer/conversation/activity/model.ts";
import { inputText, outputText } from "../../../../shell/renderer/conversation/activity/tool-body-text.ts";
import type {
  AgentTabSource,
  PermissionsView,
  QueuedView,
  RewindChoice,
  RewindPreviewView,
  SourceResult,
  ThreadSubagent,
  ToolCallBodyView,
} from "../../../../shell/renderer/conversation/agent-tab-source.ts";
import type { ModelPickerProps } from "../../../../shell/renderer/conversation/model-picker/types.ts";
import {
  compactTokens,
  contextPercent,
} from "../../../../shell/renderer/conversation/status-view/status-summary.ts";
import { createLayoutCache, layoutOf } from "../../../../shell/renderer/conversation/thread-layout.ts";
import { vendorOf } from "../../../../shell/renderer/parts/vendor-icon/vendors.ts";
import { type Candidate, type SessionPermissionsState, useProjectFiles } from "../../data/mod.ts";
import { ago, Face, type Look, VendorIcon } from "../../parts/mod.ts";
import { AttachPicks } from "./attach.tsx";
import { toolIcon } from "./parts.tsx";
import {
  canSelectMode,
  PERMISSION_MODE_DESCRIPTIONS,
  PERMISSION_MODE_LABELS,
  permissionDenialDisplay,
} from "./permissions-model.ts";
import { Row as ThreadRowView, rowsOf, ThreadContext } from "./thread.tsx";

const pad = { paddingHorizontal: 20 } as const;

// ---- what the agent did

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
  const time = elapsedText(call.state === "running", call.startedAt, call.durationMs, Date.now);
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
  pictures,
  computer,
  offline,
  onPicked,
  onFile,
  onCommands,
}: {
  open: boolean;
  onClose: () => void;
  agent: string;
  /** The project to point at a file of; null when the workspace has no files to browse (Home, an app). */
  workspace: { name: string } | null;
  /** The agent takes pictures in a message. */
  pictures: boolean;
  computer: string;
  /** The computer is offline: pictures cannot be uploaded now. */
  offline: boolean;
  onPicked: (picked: Candidate[]) => void;
  onFile: (() => void) | null;
  onCommands: (() => void) | null;
}) {
  const pointing = workspace !== null && onFile !== null;
  return (
    <Sheet open={open} onClose={onClose} title={t("mobile.session.title.attach")}>
      {pictures && (
        <>
          <AttachPicks open={open} locked={offline} computer={computer} onClose={onClose} onPicked={onPicked} />
          {(pointing || onCommands !== null) && <Divider spacing={6} />}
        </>
      )}
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
  const files = useProjectFiles(project, path).loaded;
  const entries = files.state === "ready" ? files.value : [];
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

type Listed = { readonly name: string; readonly description: string };

/** Commands as rows: `/name` and what it does. The + sheet's list and the list over the composer while `/` is typed. */
export function CommandRows<T extends Listed>({
  commands,
  onPick,
}: {
  commands: readonly T[];
  onPick: (command: T) => void;
}) {
  return commands.map((command) => (
    <Row
      key={command.name}
      lead={<Icon icon={SquareSlash} />}
      title={`/${command.name}`}
      sub={command.description}
      onPress={() => onPick(command)}
    />
  ));
}

export function CommandsSheet<T extends Listed>({
  commands,
  open,
  onClose,
  onPick,
}: {
  commands: readonly T[];
  open: boolean;
  onClose: () => void;
  onPick: (command: T) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={t("conversation.label.slash-menu")}>
      <CommandRows commands={commands} onPick={onPick} />
    </Sheet>
  );
}

/**
 * A subagent's conversation, read only, as the desktop opens it from the subagent line: the child's rows laid out the
 * same way from `thread.children`. Steering and stopping the child is done on the computer.
 */
export function ChildSheet({
  entry,
  state,
  onClose,
}: {
  entry: ThreadSubagent | null;
  state: AcpChildState | undefined;
  onClose: () => void;
}) {
  const actions = useContext(ThreadContext);
  const child = entry?.child ?? null;
  const cache = useMemo(() => createLayoutCache(), [child]);
  const view = entry === null ? null : layoutOf(state ?? EMPTY_ACP_CHILD_STATE, cache);
  const rows = view === null ? [] : rowsOf(view.entries, view.live);
  const value = useMemo(
    () => (actions === null ? null : { ...actions, readOnly: true, canRetry: false, canFork: false, canRewind: false }),
    [actions],
  );
  return (
    <Sheet
      open={entry !== null}
      onClose={onClose}
      title={entry === null ? undefined : t("mobile.session.label.subagent", { agent: entry.agent, description: entry.description })}
    >
      <ThreadContext value={value}>
        <View style={{ ...pad, gap: 18, paddingBottom: 12 }}>
          {rows.length === 0 && (
            <Text variant="small" tone="muted">
              {t("conversation.empty.no-messages")}
            </Text>
          )}
          {rows.map((row) => (
            <ThreadRowView key={row.id} row={row} />
          ))}
        </View>
      </ThreadContext>
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
  look,
  title,
  where,
  mode,
  context,
  canRename,
  onRename,
  onFork,
  onRewind,
  onPermissions,
  onContext,
  onArchive,
}: {
  open: boolean;
  onClose: () => void;
  look: Look;
  title: string;
  where: string;
  /** The current permission mode's name, when the source has modes. */
  mode: string | null;
  /** "8% of 1.05M", when the source says how full the context window is. */
  context: string | null;
  canRename: boolean;
  onRename: () => void;
  onFork: (() => void) | null;
  onRewind: (() => void) | null;
  /** null when the source cannot read them (a coding session of the computer's app). */
  onPermissions: (() => void) | null;
  onContext: () => void;
  onArchive: (() => void) | null;
}) {
  return (
    <Menu
      open={open}
      onClose={onClose}
      lead={<Face look={look} size={34} />}
      title={title}
      sub={where}
      items={[
        ...(canRename ? [{ label: t("conversation.button.rename"), icon: Pencil, onSelect: onRename }] : []),
        ...(onFork === null ? [] : [{ label: t("conversation.button.fork"), icon: GitBranch, onSelect: onFork }]),
        ...(onRewind === null ? [] : [{ label: t("conversation.button.rewind-go"), icon: Undo2, onSelect: onRewind }]),
        ...(onPermissions === null
          ? []
          : [
              {
                label: t("mobile.session.button.permissions"),
                icon: ShieldCheck,
                ...(mode === null ? {} : { end: mode }),
                onSelect: onPermissions,
              },
            ]),
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

/**
 * Deny with a reason, like the desktop card's reason row: the agent gets "the person rejected this tool call: <reason>".
 * The reason may stay empty. Every place that denies a request on the phone opens this sheet.
 */
export function DenySheet({
  open,
  agent,
  busy = false,
  onClose,
  onDeny,
}: {
  open: boolean;
  agent: string;
  busy?: boolean;
  onClose: () => void;
  onDeny: (reason: string | undefined) => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const deny = () => onDeny(reason.trim() === "" ? undefined : reason.trim());
  return (
    <Sheet open={open} onClose={onClose} title={t("conversation.label.approval-reason")}>
      <View style={{ ...pad, gap: 12, paddingBottom: 8 }}>
        <Input
          value={reason}
          onChangeText={setReason}
          placeholder={t("conversation.label.approval-reason-placeholder", { agent })}
          autoFocus
          onSubmit={deny}
        />
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Button icon={X} disabled={busy} onPress={deny}>
            {t("conversation.button.approval-deny")}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

/**
 * Session permissions overview: 4-stage mode selector, workspace + opened outside folders,
 * rules summary + active session grants (each revocable), assigned apps / MCP server trust / local tools,
 * and recent blocked calls.
 */
export function PermissionsSheet({
  open,
  agent,
  mode,
  currentMode,
  canChangeMode,
  onChangeMode,
  view,
  sessionPermissions,
  onClose,
}: {
  open: boolean;
  agent: string;
  mode: string | null;
  currentMode: PermissionMode | null;
  canChangeMode: boolean;
  onChangeMode?: (next: PermissionMode) => Promise<boolean>;
  view: PermissionsView | null;
  sessionPermissions: SessionPermissionsState;
  onClose: () => void;
}) {
  const [changingMode, setChangingMode] = useState<PermissionMode | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setChangingMode(null);
      setModeError(null);
    }
  }, [open]);

  const data = sessionPermissions.data;
  const activeMode = currentMode ?? data?.mode ?? null;

  const chooseMode = async (candidate: PermissionMode) => {
    if (
      !canChangeMode ||
      onChangeMode === undefined ||
      changingMode !== null ||
      !canSelectMode(activeMode, candidate)
    ) {
      return;
    }
    setChangingMode(candidate);
    setModeError(null);
    const ok = await onChangeMode(candidate);
    setChangingMode(null);
    if (!ok) setModeError("Couldn't change the permission mode. Try again.");
  };

  return (
    <Sheet open={open} onClose={onClose} title={t("conversation.label.permissions-of", { agent })}>
      {/* 1. 4-stage permission mode */}
      <Label>{t("conversation.label.permission-mode")}</Label>
      {activeMode !== null ? (
        <>
          {PERMISSION_MODES.map((stage) => {
            const isCurrent = stage === activeMode;
            const selectable =
              canChangeMode && onChangeMode !== undefined && canSelectMode(activeMode, stage);
            return (
              <Row
                key={stage}
                lead={<Icon icon={ShieldCheck} />}
                title={PERMISSION_MODE_LABELS[stage]}
                sub={PERMISSION_MODE_DESCRIPTIONS[stage]}
                wrap
                end={
                  isCurrent ? (
                    <Icon icon={Check} />
                  ) : changingMode === stage ? (
                    <Tag>Switching…</Tag>
                  ) : undefined
                }
                onPress={selectable && changingMode === null ? () => void chooseMode(stage) : undefined}
              />
            );
          })}
          {modeError !== null && (
            <Text variant="note" tone="critical" style={{ ...pad, paddingTop: 4 }}>
              {modeError}
            </Text>
          )}
        </>
      ) : (
        mode !== null && (
          <Row lead={<Icon icon={ShieldCheck} />} title={t("conversation.label.permission-mode")} end={mode} />
        )
      )}

      {/* 2. Workspace + opened outside folders */}
      {data !== null && (
        <>
          <Divider spacing={12} />
          <Label>Folders</Label>
          {data.workspace_folders.length === 0 && data.opened_folders.length === 0 ? (
            <Text variant="small" tone="muted" style={pad}>
              No workspace folders.
            </Text>
          ) : (
            <>
              {data.workspace_folders.map((folder) => (
                <Row key={`ws:${folder}`} lead={<Icon icon={FolderOpen} />} title={folder} wrap />
              ))}
              {data.opened_folders.map((folder) => (
                <Row
                  key={`open:${folder}`}
                  lead={<Icon icon={FolderOpen} />}
                  title={folder}
                  end={<Tag>This session</Tag>}
                  wrap
                />
              ))}
            </>
          )}

          {/* 3. Rules summary & active session grants */}
          <Divider spacing={12} />
          <Label>Rules & session grants</Label>
          <Text variant="caption" tone="muted" style={{ ...pad, paddingBottom: 6 }}>
            {`Floor: ${data.floor_count} · Global: ${data.global_rules.length} · Project: ${data.project_rules.length}`}
          </Text>
          {data.session_grants.length === 0 ? (
            <Text variant="small" tone="muted" style={pad}>
              No temporary grants in this session.
            </Text>
          ) : (
            data.session_grants.map((grant) => (
              <Row
                key={grant.id}
                title={grant.label}
                sub={`${grant.category} · ${grant.pattern}`}
                wrap
                end={
                  <Button
                    size="sm"
                    disabled={sessionPermissions.revoking === grant.id}
                    onPress={() => void sessionPermissions.revokeGrant(grant.id)}
                  >
                    Revoke
                  </Button>
                }
              />
            ))
          )}
          {sessionPermissions.revokeError !== null && (
            <Text variant="note" tone="critical" style={{ ...pad, paddingTop: 4 }}>
              {sessionPermissions.revokeError}
            </Text>
          )}
        </>
      )}

      {/* 4. Assigned apps, MCP trust, and local tools */}
      <Divider spacing={12} />
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

      {data !== null && data.mcp_servers.length > 0 && (
        <>
          <Label>MCP servers</Label>
          {data.mcp_servers.map((server) => (
            <Row
              key={server.name}
              title={server.name}
              end={
                <Tag>
                  {!server.enabled ? "Disabled" : server.trust === "trusted" ? "Trusted" : "Untrusted"}
                </Tag>
              }
            />
          ))}
        </>
      )}

      {data !== null && data.local_tools.length > 0 && (
        <>
          <Label>Local tools</Label>
          {data.local_tools.map((tool) => (
            <Row
              key={tool.path}
              title={tool.name}
              sub={tool.path}
              wrap
              end={<Tag>{tool.trusted ? "Trusted" : "Untrusted"}</Tag>}
            />
          ))}
        </>
      )}

      {data === null && sessionPermissions.status === "loading" && (
        <Text variant="caption" tone="muted" style={{ ...pad, paddingTop: 12 }}>
          Loading session permissions…
        </Text>
      )}
      {data === null && sessionPermissions.status === "failed" && (
        <Text variant="caption" tone="muted" style={{ ...pad, paddingTop: 12 }}>
          {t("conversation.notice.permissions-mcp")}
        </Text>
      )}

      {/* 5. Recent denials */}
      {data !== null && (
        <>
          <Divider spacing={12} />
          <Label>Recent blocked calls</Label>
          {data.recent_denials.length === 0 ? (
            <Text variant="small" tone="muted" style={{ ...pad, paddingBottom: 12 }}>
              No blocked calls in this session.
            </Text>
          ) : (
            <View style={{ ...pad, gap: 8, paddingBottom: 12 }}>
              {data.recent_denials.map((item) => {
                const info = permissionDenialDisplay(item.denial);
                return (
                  <Card key={item.id} tone="base" style={{ paddingVertical: 10, paddingHorizontal: 12, gap: 4 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <StatusMark tone="serious" label={info.badge} />
                      <Text variant="caption" tone="muted">
                        {ago(item.at)}
                      </Text>
                    </View>
                    <Text variant="caption" tone="muted" mono numberOfLines={1}>
                      {info.target}
                    </Text>
                    <Text variant="detail">{info.reason}</Text>
                    {info.rulePattern !== null && <Pre wrap>{info.rulePattern}</Pre>}
                    {info.recoveryHint !== null && (
                      <Text variant="note" tone="muted">
                        {info.recoveryHint}
                      </Text>
                    )}
                  </Card>
                );
              })}
            </View>
          )}
        </>
      )}
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

/** Rewinds a session to a chosen user message, optionally restoring files and app writes shown by rewindPreview. */
export function RewindSheet({
  open,
  source,
  session,
  message,
  excerpt,
  withFiles,
  onClose,
  onRewind,
}: {
  open: boolean;
  source: Pick<AgentTabSource, "rewindPreview">;
  session: string;
  message: string | null;
  excerpt: string;
  withFiles: boolean;
  onClose: () => void;
  onRewind: (choice: RewindChoice) => Promise<SourceResult<unknown>>;
}) {
  const [preview, setPreview] = useState<
    | { readonly state: "loading" }
    | { readonly state: "failed" }
    | { readonly state: "ready"; readonly value: RewindPreviewView }
  >(withFiles ? { state: "loading" } : { state: "ready", value: { files: [], apps: [] } });
  const [files, setFiles] = useState(true);
  const [showFiles, setShowFiles] = useState(false);
  const [apps, setApps] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || message === null) return;
    setFiles(true);
    setShowFiles(false);
    setApps([]);
    setBusy(false);
    setError(null);
    if (!withFiles) {
      setPreview({ state: "ready", value: { files: [], apps: [] } });
      return;
    }
    let active = true;
    setPreview({ state: "loading" });
    void source.rewindPreview(session, message).then((result) => {
      if (!active) return;
      setPreview(result.ok ? { state: "ready", value: result.value } : { state: "failed" });
    });
    return () => {
      active = false;
    };
  }, [open, source, session, message, withFiles]);

  const ready = preview.state === "ready" ? preview.value : null;
  const toggleApp = (app: string, on: boolean) =>
    setApps((current) => (on ? [...current, app] : current.filter((one) => one !== app)));

  const confirm = async () => {
    if (busy || ready === null) return;
    setBusy(true);
    setError(null);
    const result = await onRewind({ files: withFiles && files, apps });
    if (result.ok) {
      onClose();
      return;
    }
    setBusy(false);
    setError(t(result.code === "conflict" ? "conversation.rewind.running" : "conversation.rewind.start-failed"));
  };

  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} title={t("conversation.title.rewind")}>
      <View style={{ ...pad, gap: 12, paddingBottom: 14 }}>
        <View style={{ gap: 4 }}>
          <Text variant="caption" tone="muted">
            {t("conversation.label.rewind-quote")}
          </Text>
          <Text variant="detail" numberOfLines={3}>
            {excerpt}
          </Text>
        </View>
        {preview.state === "loading" && (
          <Text variant="small" tone="muted">
            {t("conversation.label.rewind-loading")}
          </Text>
        )}
        {preview.state === "failed" && (
          <Text variant="small" tone="critical">
            {t("conversation.rewind.start-failed")}
          </Text>
        )}
        {ready !== null && ready.files.length > 0 && (
          <View style={{ gap: 6 }}>
            <Row
              title={t("conversation.label.rewind-files", { count: ready.files.length })}
              end={<Switch label={t("conversation.label.rewind-files", { count: ready.files.length })} on={files} onChange={setFiles} />}
            />
            <Button size="sm" variant="ghost" onPress={() => setShowFiles((shown) => !shown)}>
              {t(showFiles ? "conversation.button.rewind-hide-files" : "conversation.button.rewind-show-files")}
            </Button>
            {showFiles && (
              <View style={{ gap: 4, paddingLeft: 12 }}>
                {ready.files.map((file) => (
                  <Text key={file.path} variant="caption" mono tone="muted" numberOfLines={1}>
                    {file.path}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}
        {ready !== null &&
          ready.apps.map((app) => (
            <Row
              key={app.app}
              title={t("conversation.label.rewind-app-also", { app: app.name })}
              sub={t("conversation.label.rewind-app-writes", { count: app.writes.length })}
              end={
                <Switch
                  label={t("conversation.label.rewind-app-also", { app: app.name })}
                  on={apps.includes(app.app)}
                  onChange={(on) => toggleApp(app.app, on)}
                />
              }
            />
          ))}
        {error !== null && (
          <Text variant="small" tone="critical">
            {error}
          </Text>
        )}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button disabled={busy} onPress={onClose}>
            {t("common.button.cancel")}
          </Button>
          <Button variant="danger" icon={Undo2} disabled={busy || ready === null} onPress={() => void confirm()}>
            {t("conversation.button.rewind-go")}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}
