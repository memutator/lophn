// 권한을 제한한 프로세스(제품 I/O worker와 같은 모양)에서 backup을 만든다. 시험이 띄운다.
import { backupStamp, createBackup } from "../mod.ts";

const root = Deno.args[0];
const version = Number(Deno.args[1]);
const stamp = backupStamp("2026-01-02T03:04:05.678Z");
if (!stamp.ok) Deno.exit(2);
const created = await createBackup(`${root}/lophn.db`, {
  root,
  schemaVersion: version,
  stamp: stamp.value,
  now: () => "2026-01-02T03:04:06.000Z",
});
console.log(JSON.stringify(created.ok ? { ok: true } : created.error));
Deno.exit(created.ok ? 0 : 1);
