// 다른 기계가 `computers` 폴더 길로 보낸 mail을 이 기계의 mail 입구에 넘기고, 그 기계가 받았다고 알린 이 기계의 mail을 받은 것으로
// 적는다. 읽는 곳은 `computers` 폴더뿐이고(사람의 폴더나 이름 붙인 폴더는 읽지 않는다), 그 안에서도 받는 자리가 지금 명단의 key로
// 검증한 manifest가 그 크기·sha256으로 싣는 file만 읽는다. 다른 기계의 글이라 크기를 먼저 보고 mail schema로 읽고, 틀린 file은
// log 한 줄(본문은 적지 않는다)로 넘긴다. 이 기계 자신의 하위 폴더는 mail의 출처가 아니다.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { type Mail, mailSchema } from "../../../protocol/lophn-agent/mail.ts";
import {
  MAIL_ACKS_MAX_BYTES,
  MAIL_FILE_MAX_BYTES,
  mailAcksPath,
  mailAcksSchema,
  mailDir,
  mailFileId,
  mailFilePath,
} from "../../../protocol/remote/carry.ts";
import { decodeRecord } from "../../../protocol/folder/records.ts";
import { createFolderReader } from "../fs.ts";

export type MailCarryIn = {
  me: Id<"mch">;
  /** `computers` 폴더 경로. */
  root: string;
  /**
   * 받는 자리가 그 기계의 manifest를 지금 명단의 그 컴퓨터 key로 검증해 들고 있고, 그 manifest가 싣는 크기·sha256 그대로 path를
   * 들고 있다(`replica.holds`). 명단에 없거나 key가 바뀐 컴퓨터의 file, 목록 밖에 놓인 file은 false다.
   */
  holds(machine: Id<"mch">, path: string): Promise<boolean>;
  log(message: string): void;
};

const decoder = new TextDecoder("utf-8", { fatal: true });

// mail 하나는 format 칸이 없는 JSON 한 줄이다(`encodeRecord(mailSchema, mail)`).
function parseMail(bytes: Uint8Array): Mail | null {
  try {
    const parsed = mailSchema.safeParse(JSON.parse(decoder.decode(bytes)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// mail을 실을 수 있는 다른 기계의 하위 폴더. 믿을지는 file마다 `holds`가 정한다.
async function origins(deps: MailCarryIn): Promise<Id<"mch">[]> {
  const machines = await createFolderReader(deps.root).listMachines();
  if (!machines.ok) return [];
  return machines.value.filter((machine) => machine !== deps.me);
}

/** 다른 기계마다 그 기계가 이 기계에 쓴 믿는 mail file의 mail(seq 순). */
export async function arrivedMail(
  deps: MailCarryIn,
): Promise<Map<Id<"mch">, Mail[]>> {
  const reader = createFolderReader(deps.root);
  const out = new Map<Id<"mch">, Mail[]>();
  for (const origin of await origins(deps)) {
    let names: string[];
    try {
      names = await readdir(join(deps.root, ...mailDir(origin).split("/")));
    } catch {
      continue;
    }
    const mails: Mail[] = [];
    for (const name of names.sort()) {
      const id = mailFileId(name);
      if (id === null) continue;
      const path = mailFilePath(origin, id);
      if (!(await deps.holds(origin, path))) continue;
      const read = await reader.read(path, MAIL_FILE_MAX_BYTES);
      const mail = read.ok ? parseMail(read.value) : null;
      if (mail === null) {
        deps.log(`${path} is not a mail file`);
        continue;
      }
      // 다른 컴퓨터로 가는 mail도 같은 폴더에 있다.
      if (mail.to_machine !== deps.me) continue;
      // 그 폴더의 기계가 쓴 것만.
      if (mail.from.machine !== origin) {
        deps.log(`${path} is not a mail of that computer`);
        continue;
      }
      mails.push(mail);
    }
    mails.sort((a, b) => a.seq - b.seq);
    if (mails.length > 0) out.set(origin, mails);
  }
  return out;
}

/**
 * 폴더 길로 온 mail 가운데 아직 보지 않은 것을 기계마다 seq 순으로 입구에 넘긴다. 입구가 오류를 내면 그 기계의 나머지는 다음
 * 번에 다시 본다(순서를 지킨다). 넘겨 적용된 수.
 */
export async function applyArrivedMail(
  deps: MailCarryIn & {
    seen(origin: Id<"mch">, id: Id<"mal">): boolean;
    apply(input: {
      mail: Mail;
      origin: Id<"mch">;
      via: "folder";
    }): Promise<Result<unknown>>;
  },
): Promise<number> {
  let applied = 0;
  for (const [origin, mails] of await arrivedMail(deps)) {
    for (const mail of mails) {
      if (deps.seen(origin, mail.id as Id<"mal">)) continue;
      const done = await deps.apply({ mail, origin, via: "folder" });
      if (!done.ok) {
        deps.log(`mail ${mail.id} from ${origin}: ${done.error.code}`);
        break;
      }
      applied += 1;
    }
  }
  return applied;
}

/** 폴더 길로 받아 이 기계가 본 mail의 id(이 기계의 `acks.json`에 적는다). */
export async function seenArrivedMail(
  deps: MailCarryIn & { seen(origin: Id<"mch">, id: Id<"mal">): boolean },
): Promise<Id<"mal">[]> {
  const out: Id<"mal">[] = [];
  for (const [origin, mails] of await arrivedMail(deps)) {
    for (const mail of mails) {
      const id = mail.id as Id<"mal">;
      if (deps.seen(origin, id)) out.push(id);
    }
  }
  return out;
}

/**
 * 다른 기계가 받았다고 알린(`acks.json`) 이 기계의 mail을 받은 것으로 적는다. 그 기계로 가는 이 기계 outbox의 줄만 본다.
 * 적은 수.
 */
export async function readMailAcks(
  deps: MailCarryIn & {
    /** 그 기계로 가는 이 기계 outbox의 mail. */
    pending(peer: Id<"mch">): readonly Mail[];
    acked(id: Id<"mal">): Promise<Result<unknown>>;
  },
): Promise<number> {
  const reader = createFolderReader(deps.root);
  let acked = 0;
  for (const peer of await origins(deps)) {
    const path = mailAcksPath(peer);
    if (!(await deps.holds(peer, path))) continue;
    const read = await reader.read(path, MAIL_ACKS_MAX_BYTES);
    const file = read.ok
      ? decodeRecord(mailAcksSchema, read.value, MAIL_ACKS_MAX_BYTES)
      : null;
    if (!file?.ok) {
      deps.log(`${path} is not a mail ack file`);
      continue;
    }
    const ids = new Set<string>(file.value.mails);
    for (const mail of deps.pending(peer)) {
      if (!ids.has(mail.id)) continue;
      const done = await deps.acked(mail.id as Id<"mal">);
      if (!done.ok) {
        deps.log(`mail ${mail.id} ack not recorded: ${done.error.code}`);
        return acked;
      }
      acked += 1;
    }
  }
  return acked;
}
