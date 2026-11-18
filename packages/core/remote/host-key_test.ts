import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { seededRandom } from "../../base/mod.ts";
import { generateKeyPair, remoteKeyText } from "../../protocol/remote/mod.ts";
import {
  addSigningKey,
  loadRemoteKeys,
  readHostKeyMachine,
  remoteKeysState,
  stampHostKeyMachine,
} from "./host-key.ts";

const here = `mch_0${"1".repeat(25)}` as const;

// 사람의 data root에서 이 step들이 돈다. key 값이 바뀌거나 서명 key 없이 host key만 남으면(기동이 둘 다 지운다) 이미 pairing한
// 폰이 모두 다시 들어와야 한다.
test("data step은 machine이 없는 key에 지금 id를 찍고 짝 서명 key를 더하며 host key 값은 바꾸지 않고, 다시 돌아도 같고, 못 읽는 file은 덮지 않는다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-host-key-"));
  const pair = generateKeyPair(seededRandom(3));
  const old = {
    public_key: remoteKeyText(pair.publicKey),
    secret_key: remoteKeyText(pair.secretKey),
  };
  const path = join(dir, "host-key.json");
  writeFileSync(path, `${JSON.stringify(old)}\n`, { mode: 0o600 });
  assert.equal(await readHostKeyMachine(dir), "unreadable");

  await stampHostKeyMachine(dir, here);
  await stampHostKeyMachine(dir, `mch_0${"2".repeat(25)}`);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
    ...old,
    machine: here,
  });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(await readHostKeyMachine(dir), here);
  assert.equal(await remoteKeysState(dir, here), "drop");
  await addSigningKey(dir, seededRandom(4));
  const signing = readFileSync(join(dir, "signing-key.json"), "utf8");
  await addSigningKey(dir, seededRandom(5));
  assert.equal(readFileSync(join(dir, "signing-key.json"), "utf8"), signing);
  assert.equal(statSync(join(dir, "signing-key.json")).mode & 0o777, 0o600);
  assert.equal(await remoteKeysState(dir, here), "ok");
  const loaded = await loadRemoteKeys(dir, seededRandom(9), here);
  assert.deepEqual(loaded.host.publicKey, pair.publicKey);
  assert.equal(
    remoteKeyText(loaded.signing.publicKey),
    JSON.parse(signing).public_key,
  );

  writeFileSync(path, "{broken");
  await stampHostKeyMachine(dir, here);
  assert.equal(readFileSync(path, "utf8"), "{broken");
  assert.equal(await readHostKeyMachine(dir), "unreadable");

  // 새로 만드는 key 둘에는 만든 기계의 id가 찍힌다.
  const fresh = mkdtempSync(join(tmpdir(), "lophn-host-key-"));
  await stampHostKeyMachine(fresh, here);
  await addSigningKey(fresh, seededRandom(4));
  assert.equal(await remoteKeysState(fresh, here), "none");
  await loadRemoteKeys(fresh, seededRandom(9), here);
  assert.equal(await remoteKeysState(fresh, here), "ok");
  assert.equal(await remoteKeysState(fresh, `mch_0${"2".repeat(25)}`), "drop");
});
