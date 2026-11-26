// handoff note route(`handoff/write`, `handoff/list`)를 memory로 낸다. 읽기는 같은 ledger를 읽는 main thread 연결로 한다.
// note file은 `computers` 폴더에 놓이고 folder wiring이 나른다(`folderCarry`, `folderReplica`). 명단은 remote wiring이 늦게
// 내므로 부를 때 읽는다.
import { join } from "node:path";
import type { z } from "zod";
import { err, ok } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  decodeRecord,
  encodeRecord,
} from "../../../../protocol/folder/records.ts";
import { DEFAULT_CALL_POLICY } from "../../../../protocol/lophn-agent/call-policy.ts";
import {
  handoffFileSchema,
  handoffList,
  type HandoffNote,
  handoffWrite,
} from "../../../../protocol/lophn-agent/handoff.ts";
import {
  COMPUTERS_DIR,
  NOTE_FILE_MAX_BYTES,
  noteFilePath,
} from "../../../../protocol/remote/carry.ts";
import { callPolicySetting } from "../../../config/setting-declarations.ts";
import { createFolderReader, createFolderWriter } from "../../../folder/fs.ts";
import {
  inboxAttachmentPath,
  safeAttachmentRelPath,
} from "../../../folder/transfers.ts";
import {
  createSessionDirectory,
  workspaceDepsOf,
} from "../../../lophn-agent/workspaces/mod.ts";
import { handoffListHandler } from "../../../projects/handoff/list.ts";
import { handoffWriteHandler } from "../../../projects/handoff/write.ts";
import { createGitReader } from "../../../projects/identity/mod.ts";
import {
  type LedgerConnection,
  openConnection,
} from "../../../storage/ledger/mod.ts";
import { routeKey } from "./app-principal.ts";
import { createProductRedactor, type WiringFactory } from "./context.ts";

// handoff note의 글은 agent 출력이라 다른 기계로 가기 전에 redaction을 거친다.
const SOURCE = { concern: "handoff", revision: "1", scope: "note" };

export const handoffWiring: WiringFactory = () => {
  let connection: LedgerConnection | undefined;
  // 틀린 file은 core가 뜬 동안 file마다 한 번만 적는다.
  const logged = new Set<string>();
  return {
    name: "handoff",
    build(ctx) {
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      connection = opened.value;
      const { sql } = opened.value;
      const root = join(ctx.root.path, COMPUTERS_DIR);
      const me = () => ctx.machine.id;
      const policy = () =>
        ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY;
      const git = createGitReader({ logger: ctx.telemetry.logger });
      const write = handoffWriteHandler({
        me,
        root,
        sql,
        session(id) {
          const workspaces = workspaceDepsOf(sql);
          const found = createSessionDirectory({
            ...workspaces,
            // 읽기만 한다. session을 열지 않는다.
            publish: () => {},
            sql: () => sql,
          }).find(id);
          if (found === null) return null;
          const { agent, workspace } = found.agent;
          return {
            workspace,
            agent,
            name: workspaces.names.describe(agent).name,
          };
        },
        policy,
        redact: (text) =>
          createProductRedactor(ctx.peek.knownSecrets)(
            SOURCE,
            "text/plain",
            text,
          ),
        head: (dir) => git.head(dir),
        clock: ctx.clock,
        random: ctx.random,
        written: () => ctx.peek.folderCarry?.kick(),
      });
      const list = handoffListHandler({
        me,
        root,
        sql,
        // 받는 자리(folder)가 없으면 믿을 file이 없다.
        holds: (machine, path) =>
          ctx.peek.folderReplica?.holds(machine, path) ??
          Promise.resolve(false),
        computerName: (machine) =>
          ctx.peek.machineLinks
            ?.computers()
            .find((each) => each.machine === machine && !each.self)?.name ??
          null,
        policy,
        clock: ctx.clock,
        logged,
        log: (message) =>
          ctx.telemetry.logger.warn({
            component: "handoff",
            event: "note_file_skipped",
            message,
          }),
      });
      const writeWithAttachments: typeof write = async (auth, body) => {
        const input = body as z.infer<typeof handoffWrite.input>;
        const attachments = input.attachments;
        if (attachments !== undefined && attachments.length > 0) {
          for (const att of attachments) {
            if (safeAttachmentRelPath(att) === null) {
              return err({
                code: "invalid_input",
                message: `invalid attachment path: ${att.rel_path ?? att.name}`,
              });
            }
          }
        }
        const done = await write(auth, body);
        if (!done.ok || attachments === undefined || attachments.length === 0) {
          return done;
        }
        const session = auth.conditions.session as Id<"ses"> | undefined;
        if (session === undefined) return done;
        const path = noteFilePath(me(), session);
        const read = await createFolderReader(root).read(
          path,
          NOTE_FILE_MAX_BYTES,
        );
        const decoded = read.ok
          ? decodeRecord(handoffFileSchema, read.value, NOTE_FILE_MAX_BYTES)
          : null;
        if (!decoded?.ok) return done;
        const sanitized = attachments.map((att) => ({
          ...att,
          rel_path: safeAttachmentRelPath(att) ?? att.name,
        }));
        const bytes = encodeRecord(handoffFileSchema, {
          ...decoded.value,
          attachments: sanitized,
        });
        if (bytes.byteLength > NOTE_FILE_MAX_BYTES) {
          return err({
            code: "invalid_input",
            message: "the handoff note with attachments is too large to carry",
          });
        }
        const saved = await createFolderWriter({
          root,
          machine: me(),
          random: ctx.random,
        }).writeFile(path, bytes);
        if (!saved.ok) return saved;
        ctx.peek.folderCarry?.kick();
        return done;
      };
      const listWithAttachments: typeof list = async (auth, body) => {
        const done = await list(auth, body);
        if (!done.ok) return done;
        const { notes } = done.value as { notes: HandoffNote[] };
        const reader = createFolderReader(root);
        const enriched = await Promise.all(
          notes.map(async (note) => {
            const path = noteFilePath(
              note.machine as Id<"mch">,
              note.session as Id<"ses">,
            );
            const held =
              (await ctx.peek.folderReplica?.holds(
                note.machine as Id<"mch">,
                path,
              )) ?? false;
            if (!held) return note;
            const read = await reader.read(path, NOTE_FILE_MAX_BYTES);
            const decoded = read.ok
              ? decodeRecord(handoffFileSchema, read.value, NOTE_FILE_MAX_BYTES)
              : null;
            if (
              !decoded?.ok ||
              decoded.value.attachments === undefined ||
              decoded.value.attachments.length === 0
            ) {
              return note;
            }
            const safeAttachments = decoded.value.attachments.flatMap((att) => {
              const rel = safeAttachmentRelPath(att);
              const inboxPath = inboxAttachmentPath(ctx.root.path, att);
              return rel === null || inboxPath === null
                ? []
                : [{ ...att, rel_path: rel }];
            });
            return safeAttachments.length > 0
              ? { ...note, attachments: safeAttachments }
              : note;
          }),
        );
        return ok({ notes: enriched });
      };
      return ok({
        memory: [
          [routeKey(handoffWrite), writeWithAttachments],
          [routeKey(handoffList), listWithAttachments],
        ],
      });
    },
    closeWork() {
      connection?.close();
      connection = undefined;
    },
  };
};
