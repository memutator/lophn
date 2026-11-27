// `lophn send <path...> --on <computer>`, `lophn send list|status|clear`: 로컬 file·폴더를 내 다른 컴퓨터로 보내고 상태를 확인·정리한다.
// 대상 컴퓨터가 꺼져 있으면 Hub 컴퓨터가 맡아 두었다가 켜지면 inbox로 배달한다(자동 실행·압축 해제 안 함).
import { resolve } from "node:path";
import { z } from "zod";
import { ok, type Result } from "../../base/mod.ts";
import {
  TRANSFER_MAX_FILES,
  TRANSFER_NOTE_MAX_CHARS,
  type TransferDeliveryState,
  type TransferFileEntry,
  type TransferRecord,
  transfersClear,
  transfersList,
  transfersSend,
  transfersStatus,
} from "../../protocol/folder/transfers.ts";
import type { TransferAttachment } from "../../protocol/lophn-agent/calls.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { type CommandContext, defineCommand } from "./types.ts";

// lophn tool로 부르면 그 session의 읽기 범위 검사를 거치고, binary·agent shell은 cwd 기준으로 푼다.
export async function resolveTransferPaths(
  paths: readonly string[],
  ctx: CommandContext,
): Promise<Result<string[]>> {
  const resolved: string[] = [];
  for (const path of paths) {
    if (ctx.resolveRead !== undefined) {
      const allowed = await ctx.resolveRead(path);
      if (!allowed.ok) return allowed;
      resolved.push(allowed.value);
    } else {
      resolved.push(ctx.cwd === undefined ? path : resolve(ctx.cwd, path));
    }
  }
  return ok(resolved);
}

// `--attach` 공용 helper: 대상 컴퓨터로 `transfers/send`를 먼저 올려 `TransferAttachment[]`를 만든다.
export async function uploadAttachments(
  to: string,
  paths: readonly string[],
  ctx: CommandContext,
  note?: string,
): Promise<Result<TransferAttachment[]>> {
  const resolved = await resolveTransferPaths(paths, ctx);
  if (!resolved.ok) return resolved;
  const sent = await ctx.core.read(transfersSend, {
    to,
    paths: resolved.value,
    ...(note === undefined ? {} : { note }),
  });
  if (!sent.ok) return sent;
  return ok(
    sent.value.files.map((file) => ({
      transfer: sent.value.transfer,
      name: file.name,
      size: file.size,
      sha256: file.sha256,
      rel_path: file.rel_path,
    })),
  );
}

function formatState(
  state: TransferDeliveryState,
  heldBy?: readonly string[],
): string {
  // 보낼 때 대상이 꺼져 있고 Hub가 켜져 있었다는 뜻이다. Hub가 file을 받았다는 확인이 아니다.
  if (state === "held_at_hub") {
    return heldBy !== undefined && heldBy.length > 0
      ? `held_at_hub (target offline; Hub ${heldBy.join(", ")} picks it up)`
      : "held_at_hub (target offline; a Hub picks it up)";
  }
  return state;
}

function formatFiles(files: readonly TransferFileEntry[]): string[] {
  return files.map(
    (file) =>
      `  ${file.rel_path} (${file.size} bytes)${file.executable_stripped ? " [exec stripped]" : ""}`,
  );
}

function formatRecord(record: TransferRecord): string {
  const lines = [
    `transfer: ${record.id}`,
    `direction: ${record.direction}`,
    `from: ${record.from_name} (${record.from_machine})`,
    `to: ${record.to_name} (${record.to_machine})`,
    `state: ${formatState(record.state, record.held_by)}`,
    `expires: ${record.expires_at}`,
  ];
  if (record.inbox_dir !== null) lines.push(`inbox: ${record.inbox_dir}`);
  if (record.note !== null) lines.push(`note: ${record.note}`);
  lines.push(`files (${record.files.length}):`, ...formatFiles(record.files));
  return lines.join("\n");
}

const send = defineCommand({
  name: "send",
  summary: "Send local files or folders to another computer",
  description:
    "Send local files or folders to another computer of the person (`--on <computer>`, name or id from `lophn machine computers`). " +
    "Files arrive in that computer's inbox and are never auto-extracted or executed. " +
    "If the target computer is offline while a Hub computer is online, the state is `held_at_hub`: the Hub picks the files up and delivers them when the target comes online (transfers expire after 7 days). " +
    "`held_at_hub` does not confirm the Hub already has the files; on the target computer, `lophn send status <trf_...>` says how many files have arrived. " +
    "Relative paths resolve from the current workspace folder (or current directory in a terminal). " +
    "Use `lophn send list`, `lophn send status <trf_...>`, and `lophn send clear <trf_...>` to inspect or clean up transfers.",
  input: z.strictObject({
    paths: z.array(z.string().min(1)).min(1).max(TRANSFER_MAX_FILES),
    on: z.string().min(1).max(128),
    note: z.string().max(TRANSFER_NOTE_MAX_CHARS).optional(),
    allow_outside_workspace: z.boolean().optional(),
  }),
  positional: ["paths"],
  effect: "write",
  routes: [transfersSend],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const resolved = await resolveTransferPaths(input.paths, ctx);
    if (!resolved.ok) return resolved;
    const sent = await ctx.core.read(transfersSend, {
      to: input.on,
      paths: resolved.value,
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.allow_outside_workspace === undefined
        ? {}
        : { allow_outside_workspace: input.allow_outside_workspace }),
    });
    if (!sent.ok) return sent;
    const { transfer, to_machine, to_name, state, held_by, files, expires_at } =
      sent.value;
    const stateText = formatState(state, held_by);
    const lines = [
      `transfer: ${transfer}`,
      `to: ${to_name} (${to_machine})`,
      `state: ${stateText}`,
      `expires: ${expires_at}`,
      `files (${files.length}):`,
      ...formatFiles(files),
    ];
    return ok({
      summary: `transfer ${transfer} to ${to_name} (${files.length} ${files.length === 1 ? "file" : "files"}, ${stateText}, expires ${expires_at})`,
      content: sent.value,
      text: lines.join("\n"),
    });
  },
});

const list = defineCommand({
  name: "send.list",
  summary: "List outgoing and incoming file transfers",
  description:
    "List file transfers sent from or received on this computer (`--direction incoming|outgoing|all`, `--limit <n>`).",
  input: transfersList.input,
  effect: "read",
  routes: [transfersList],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const listed = await ctx.core.read(transfersList, input);
    if (!listed.ok) return listed;
    const { transfers } = listed.value;
    const text =
      transfers.length === 0
        ? "no transfers"
        : transfers
            .map((t) => {
              const peer =
                t.direction === "outgoing"
                  ? `-> ${t.to_name}`
                  : `<- ${t.from_name}`;
              const inbox = t.inbox_dir === null ? "" : ` inbox=${t.inbox_dir}`;
              return `${t.id} ${t.direction} ${peer} ${formatState(t.state, t.held_by)} (${t.files.length} ${t.files.length === 1 ? "file" : "files"}, expires ${t.expires_at})${inbox}`;
            })
            .join("\n");
    return ok({
      summary: `${transfers.length} ${transfers.length === 1 ? "transfer" : "transfers"}`,
      content: { transfers },
      arrayKeys: ["transfers"],
      text,
    });
  },
});

const status = defineCommand({
  name: "send.status",
  summary: "Read the status and files of a transfer",
  description:
    "Read delivery state (`delivered`, `held_at_hub`, `queued`, `expired`, `failed`), expiry time, inbox path, and files for a `trf_...` transfer.",
  input: transfersStatus.input,
  positional: ["transfer"],
  effect: "read",
  routes: [transfersStatus],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const read = await ctx.core.read(transfersStatus, input);
    if (!read.ok) return read;
    const t = read.value.transfer;
    const stateText = formatState(t.state, t.held_by);
    return ok({
      summary: `transfer ${t.id}: ${stateText} (${t.files.length} ${t.files.length === 1 ? "file" : "files"}, expires ${t.expires_at})`,
      content: { transfer: t },
      text: formatRecord(t),
    });
  },
});

const clear = defineCommand({
  name: "send.clear",
  summary: "Clear a transfer record (and optionally its inbox files)",
  description:
    "Remove a `trf_...` transfer from this computer's transfer list. Add `--delete-inbox-files` to also remove received files from the inbox directory.",
  input: transfersClear.input,
  positional: ["transfer"],
  effect: "write",
  routes: [transfersClear],
  workspaces: [],
  run: async (input, ctx) => {
    const done = await ctx.core.read(transfersClear, input);
    if (!done.ok) return done;
    return ok({
      summary: done.value.cleared
        ? `cleared transfer ${input.transfer}`
        : `transfer ${input.transfer} was not cleared`,
      content: done.value,
    });
  },
});

export const SEND_COMMANDS = [send, list, status, clear];
