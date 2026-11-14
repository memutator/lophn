// core의 remote key 쌍. `<data root>/remote/host-key.json`(0600)에 한 번 만들고 그 뒤로 읽기만 한다.
// key가 바뀌면 pairing한 폰은 모두 다시 pairing해야 하므로, 못 읽는 file을 새 key로 덮지 않는다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { RandomSource } from "../../base/mod.ts";
import {
  generateKeyPair,
  type KeyPair,
  remoteKeyBytes,
  remoteKeyText,
} from "../../protocol/remote/mod.ts";

export async function loadHostKey(
  dir: string,
  random: RandomSource,
): Promise<KeyPair> {
  const path = `${dir}/host-key.json`;
  let text: string | undefined;
  try {
    text = await readFile(path, "utf8");
  } catch (thrown) {
    if ((thrown as NodeJS.ErrnoException).code !== "ENOENT") throw thrown;
  }
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
      })}\n`,
      { mode: 0o600, flag: "wx" },
    );
  } catch (thrown) {
    if ((thrown as NodeJS.ErrnoException).code === "EEXIST") {
      return loadHostKey(dir, random);
    }
    throw thrown;
  }
  return pair;
}
