// `computers` 폴더의 자기 mail 폴더 `machines/<자기 id>/mail/`를 outbox와 받은 mail에 맞춘다. outbox의 mail은 하나에 file 하나이고
// 한 번 쓰면 다시 쓰지 않는다(id가 path다). outbox에 없는 file(받았다고 알려 왔거나 만료된 것)은 지운다. 폴더 길로 받은 mail의
// id는 `acks.json` 하나에 적어 낸 기계가 자기 줄을 지우게 한다. manifest는 그 뒤 이 폴더를 읽어 `mail` 칸에 싣는다.
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
  const wanted = new Set<string>();
  for (const mail of input.pending) {
    // outbox를 읽을 때 schema를 지난 mail이다.
    const bytes = encodeRecord(mailSchema, mail);
    // 글이 escape로 불어난 mail은 연결로만 간다.
    if (bytes.byteLength > MAIL_FILE_MAX_BYTES) {
      input.log(`mail ${mail.id} is over ${MAIL_FILE_MAX_BYTES} bytes`);
      continue;
    }
    wanted.add(mail.id);
    if (held.has(mail.id)) continue;
    const written = await writer.writeFile(
      mailFilePath(me, mail.id as Id<"mal">),
      bytes,
    );
    if (!written.ok) return written;
  }
  for (const id of held) {
    if (wanted.has(id)) continue;
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
