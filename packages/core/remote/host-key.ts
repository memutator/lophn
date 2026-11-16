// core의 remote key 쌍. `<data root>/remote/host-key.json`(0600)에 한 번 만들고 그 뒤로 읽기만 한다.
// key가 바뀌면 pairing한 폰은 모두 다시 pairing해야 하므로, 못 읽는 file을 새 key로 덮지 않는다.
// file에는 key를 만든 기계의 id(`machine`)를 같이 적는다. 지금 id와 다르면 다른 기계에서 복사된 key다(wiring/remote.ts가 본다).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { RandomSource } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import { machineIdSchema } from "../../protocol/machine/mod.ts";
import {
  generateKeyPair,
  type KeyPair,
  remoteKeyBytes,
  remoteKeyText,
} from "../../protocol/remote/mod.ts";

const FILE = "host-key.json";

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (thrown) {
    if ((thrown as NodeJS.ErrnoException).code !== "ENOENT") throw thrown;
    return undefined;
  }
}

export async function loadHostKey(
  dir: string,
  random: RandomSource,
  machine: Id<"mch">,
): Promise<KeyPair> {
  const path = `${dir}/${FILE}`;
  const text = await readText(path);
  if (text !== undefined) {
    const secret = remoteKeyBytes(
      String((JSON.parse(text) as { secret_key?: unknown }).secret_key),
    );
    if (!secret) throw new Error("remote host key file is not readable");
    return generateKeyPair({ fill: (out) => out.set(secret) });
  }
  const pair = generateKeyPair(random);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // 두 core가 같이 만들면 먼저 쓴 쪽이 이긴다(wx). 진 쪽은 그 file을 다시 읽는다.
  try {
    await writeFile(
      path,
      `${JSON.stringify({
        public_key: remoteKeyText(pair.publicKey),
        secret_key: remoteKeyText(pair.secretKey),
        machine,
      })}\n`,
      { mode: 0o600, flag: "wx" },
    );
  } catch (thrown) {
    if ((thrown as NodeJS.ErrnoException).code === "EEXIST") {
      return loadHostKey(dir, random, machine);
    }
    throw thrown;
  }
  return pair;
}

// key file에 적힌 만든 기계의 id. file이 없으면 "missing", JSON이 아니거나 id가 없으면 "unreadable"이다.
export async function readHostKeyMachine(
  dir: string,
): Promise<"missing" | Id<"mch"> | "unreadable"> {
  let text: string | undefined;
  try {
    text = await readText(`${dir}/${FILE}`);
  } catch {
    return "unreadable";
  }
  if (text === undefined) return "missing";
  try {
    const parsed = machineIdSchema.safeParse(
      (JSON.parse(text) as { machine?: unknown } | null)?.machine,
    );
    return parsed.success ? (parsed.data as Id<"mch">) : "unreadable";
  } catch {
    return "unreadable";
  }
}

// 이 판 전에 만든 key(machine 칸이 없다)에 지금 기계의 id를 찍는다. key 값은 그대로라 이미 pairing한 폰이 그대로 붙는다.
// file이 없거나 이미 찍혔거나 못 읽으면 하지 않는다(못 읽는 file은 덮지 않는다). temp에 쓰고 rename해 다시 돌아도 같다.
export async function stampHostKeyMachine(
  dir: string,
  machine: Id<"mch">,
): Promise<void> {
  const path = `${dir}/${FILE}`;
  const text = await readText(path);
  if (text === undefined) return;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return;
  }
  if (typeof value !== "object" || value === null || "machine" in value) {
    return;
  }
  await writeFile(`${path}.tmp`, `${JSON.stringify({ ...value, machine })}\n`, {
    mode: 0o600,
  });
  await rename(`${path}.tmp`, path);
}
