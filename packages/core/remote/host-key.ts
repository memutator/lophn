// core의 remote key 둘: host key(Noise static key, `<data root>/remote/host-key.json`)와 명단에 서명하는 서명 key
// (Ed25519, `signing-key.json`). 둘 다 0600이고 한 번 만든 뒤로 읽기만 한다. host key가 바뀌면 그 key를 저장한 폰은 다시
// 들어와야 하고, 서명 key만 바뀌면 다른 컴퓨터가 이 컴퓨터를 `signing_key` 충돌로 뺀다. 그래서 둘은 같이 만들고 같이 지운다.
// file에는 key를 만든 기계의 id(`machine`)를 같이 적는다. 지금 id와 다르면 다른 기계에서 복사된 key다(wiring/remote.ts가 본다).
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { RandomSource } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import { machineIdSchema } from "../../protocol/machine/mod.ts";
import {
  generateKeyPair,
  generateSigningKey,
  type KeyPair,
  remoteKeyBytes,
  remoteKeyText,
} from "../../protocol/remote/mod.ts";

const HOST_FILE = "host-key.json";
const SIGNING_FILE = "signing-key.json";

export type RemoteKeys = { host: KeyPair; signing: KeyPair };

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (thrown) {
    if ((thrown as NodeJS.ErrnoException).code !== "ENOENT") throw thrown;
    return undefined;
  }
}

async function loadOne(
  dir: string,
  file: string,
  random: RandomSource,
  machine: Id<"mch">,
  generate: (random: RandomSource) => KeyPair,
): Promise<KeyPair> {
  const path = `${dir}/${file}`;
  const text = await readText(path);
  if (text !== undefined) {
    const secret = remoteKeyBytes(
      String((JSON.parse(text) as { secret_key?: unknown }).secret_key),
    );
    if (!secret) throw new Error(`remote key file ${file} is not readable`);
    return generate({ fill: (out) => out.set(secret) });
  }
  const pair = generate(random);
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
      return loadOne(dir, file, random, machine, generate);
    }
    throw thrown;
  }
  return pair;
}

// 없으면 만든다. 하나만 있는 data root는 기동이 먼저 판정해 둘 다 지웠다(remoteKeysState).
export async function loadRemoteKeys(
  dir: string,
  random: RandomSource,
  machine: Id<"mch">,
): Promise<RemoteKeys> {
  return {
    host: await loadOne(dir, HOST_FILE, random, machine, generateKeyPair),
    signing: await loadOne(
      dir,
      SIGNING_FILE,
      random,
      machine,
      generateSigningKey,
    ),
  };
}

// key file에 적힌 만든 기계의 id. file이 없으면 "missing", JSON이 아니거나 id가 없으면 "unreadable"이다.
async function readKeyMachine(
  path: string,
): Promise<"missing" | Id<"mch"> | "unreadable"> {
  let text: string | undefined;
  try {
    text = await readText(path);
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

export function readHostKeyMachine(dir: string) {
  return readKeyMachine(`${dir}/${HOST_FILE}`);
}

// 기동이 보는 key 상태. none: 둘 다 없다(remote를 켤 때 만든다). ok: 둘 다 이 기계의 것. drop: 다른 기계의 key(복사된 data
// root)이거나 하나만 읽힌다. 명단을 버리고 둘 다 지운다. unreadable: 하나도 읽히지 않는다. 덮지 않고 remote를 켜지 못한다.
export async function remoteKeysState(
  dir: string,
  machine: Id<"mch">,
): Promise<"none" | "ok" | "drop" | "unreadable"> {
  const stamps = [
    await readKeyMachine(`${dir}/${HOST_FILE}`),
    await readKeyMachine(`${dir}/${SIGNING_FILE}`),
  ];
  const readable = stamps.filter(
    (stamp) => stamp !== "missing" && stamp !== "unreadable",
  );
  if (stamps.every((stamp) => stamp === "missing")) return "none";
  if (readable.length === 0) return "unreadable";
  if (readable.length === 1) return "drop";
  return readable.every((stamp) => stamp === machine) ? "ok" : "drop";
}

export async function removeRemoteKeys(dir: string): Promise<void> {
  await rm(`${dir}/${HOST_FILE}`, { force: true });
  await rm(`${dir}/${SIGNING_FILE}`, { force: true });
}

// 이 판 전에 만든 key(machine 칸이 없다)에 지금 기계의 id를 찍는다. key 값은 그대로라 이미 pairing한 폰이 그대로 붙는다.
// file이 없거나 이미 찍혔거나 못 읽으면 하지 않는다(못 읽는 file은 덮지 않는다). temp에 쓰고 rename해 다시 돌아도 같다.
export async function stampHostKeyMachine(
  dir: string,
  machine: Id<"mch">,
): Promise<void> {
  const path = `${dir}/${HOST_FILE}`;
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

// 명단 전에 만든 host key에 짝 서명 key를 더한다. host key가 찍은 기계 id를 그대로 적어 복사된 data root면 둘이 같이 지워진다.
// host key가 없거나 못 읽거나 서명 key가 이미 있으면 하지 않는다. 기동은 host key만 있으면 둘 다 지우므로(폰이 다시 들어와야
// 한다) 이 step이 옮긴 폰을 지킨다.
export async function addSigningKey(
  dir: string,
  random: RandomSource,
): Promise<void> {
  const machine = await readKeyMachine(`${dir}/${HOST_FILE}`);
  if (machine === "missing" || machine === "unreadable") return;
  if ((await readKeyMachine(`${dir}/${SIGNING_FILE}`)) !== "missing") return;
  await loadOne(dir, SIGNING_FILE, random, machine, generateSigningKey);
}
