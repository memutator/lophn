// `computers` 폴더의 자기 mail 폴더 `machines/<자기 id>/mail/`를 outbox와 받은 mail에 맞춘다. outbox의 mail은 하나에 file 하나이고
// 한 번 쓰면 다시 쓰지 않는다(id가 path다). 연결이 붙은 상대의 mail은 곧 link로 닿을 수 있어 `MAIL_FILE_AFTER_MS` 동안 outbox에 남은
// 것만 쓰고, 연결이 없는(오프라인) 상대의 mail은 기다리지 않고 바로 쓴다. outbox에 없는 file(받았다고 알려 왔거나 줄이 지워진 것)은
// 지운다. 폴더 길로 받은 mail의 id는 `acks.json` 하나에 적어 낸 기계가 자기 줄을 지우게 한다. manifest는 그 뒤 이 폴더를 읽어 `mail`
// 칸에 싣는다.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalize,
  ok,
  type RandomSource,
  type Result,
} from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { type Mail, mailSchema } from "../../../protocol/lophn-agent/mail.ts";
import {
  MAIL_ACKS_MAX,
  MAIL_ACKS_MAX_BYTES,
  MAIL_FILE_MAX_BYTES,
  mailAcksPath,
  mailAcksSchema,
  mailDir,
  mailFileId,
  mailFilePath,
} from "../../../protocol/remote/carry.ts";
import {
  decodeRecord,
  encodeRecord,
} from "../../../protocol/folder/records.ts";
import { createFolderReader, createFolderWriter } from "../fs.ts";

// outbox에 이만큼 남은 mail만 file로 쓴다.
export const MAIL_FILE_AFTER_MS = 60_000;

/** 지금 mail 폴더에 있는 mail file의 id. 폴더가 없으면 빈 목록. */
async function heldMailIds(root: string, me: Id<"mch">): Promise<string[]> {
  try {
    const names = await readdir(join(root, ...mailDir(me).split("/")));
    return names.flatMap((name) => mailFileId(name) ?? []);
  } catch {
    return [];
  }
}

export async function writeMailFiles(input: {
  me: Id<"mch">;
  /** `computers` 폴더 경로. */
  root: string;
  /** 이 기계 outbox의 mail 모두. */
  pending: readonly Mail[];
  /** 폴더 길로 받아 이 기계가 본 다른 기계의 mail id. */
  acks: readonly Id<"mal">[];
  /** 그 상대 기계와 지금 link가 붙어 있는가. 붙어 있으면 `MAIL_FILE_AFTER_MS` 동안 기다리고, 없으면 바로 file로 쓴다. */
  connected?(peer: Id<"mch">): boolean;
  nowMs: number;
  random: RandomSource;
  log(message: string): void;
}): Promise<Result<void>> {
  const { me, root } = input;
  const writer = createFolderWriter({
    root,
    machine: me,
    random: input.random,
  });
  const held = new Set(await heldMailIds(root, me));
  // 상대마다 seq 순으로 쓰다가 쓰지 못할 mail에서 멈춘다: 그 뒤 mail만 file로 가면 받는 쪽이 앞 mail 없이 돌린다.
  const stopped = new Set<string>();
  for (const mail of input.pending) {
    if (stopped.has(mail.to_machine) || held.has(mail.id)) continue;
    const peerOnline = input.connected?.(mail.to_machine as Id<"mch">) ?? false;
    if (
      peerOnline &&
      input.nowMs - Date.parse(mail.sent_at) < MAIL_FILE_AFTER_MS
    ) {
      stopped.add(mail.to_machine);
      continue;
    }
    // outbox를 읽을 때 schema를 지난 mail이다.
    const bytes = encodeRecord(mailSchema, mail);
    // 글이 escape로 불어난 mail은 그 상대의 뒤 mail과 함께 연결로만 간다.
    if (bytes.byteLength > MAIL_FILE_MAX_BYTES) {
      input.log(`mail ${mail.id} is over ${MAIL_FILE_MAX_BYTES} bytes`);
      stopped.add(mail.to_machine);
      continue;
    }
    const written = await writer.writeFile(
      mailFilePath(me, mail.id as Id<"mal">),
      bytes,
    );
    if (!written.ok) return written;
  }
  const pending = new Set(input.pending.map((mail) => mail.id));
  for (const id of held) {
    if (pending.has(id)) continue;
    const removed = await writer.remove(mailFilePath(me, id as Id<"mal">));
    if (!removed.ok) return removed;
  }

  const path = mailAcksPath(me);
  const acks = [...new Set(input.acks)].sort().slice(0, MAIL_ACKS_MAX);
  if (acks.length === 0) return await writer.remove(path);
  const before = await createFolderReader(root).read(path, MAIL_ACKS_MAX_BYTES);
  const parsed = before.ok
    ? decodeRecord(mailAcksSchema, before.value, MAIL_ACKS_MAX_BYTES)
    : null;
  if (parsed?.ok && canonicalize(parsed.value.mails) === canonicalize(acks)) {
    return ok(undefined);
  }
  return await writer.writeFile(
    path,
    encodeRecord(mailAcksSchema, { format: 1, machine: me, mails: acks }),
  );
}
