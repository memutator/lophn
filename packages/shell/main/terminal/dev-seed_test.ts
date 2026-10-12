// shell/terminal#R1: 개발 시드 폴더는 LOPHN_DEV_SEED와 시드 프로젝트일 때만 쓴다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEV_SEED_PROJECT, devSeedFolders } from "./dev-seed.ts";

test("shell/terminal#R1: 시드 폴더는 개발 시드의 시드 프로젝트에만 등록 폴더가 된다", () => {
  const env = {
    LOPHN_DEV_SEED: "1",
    LOPHN_DEV_SEED_FOLDERS: JSON.stringify(["/work/a", "/work/b"]),
  };
  assert.deepEqual(devSeedFolders(env, DEV_SEED_PROJECT), [
    { folder_ref: `${DEV_SEED_PROJECT}_0`, path: "/work/a" },
    { folder_ref: `${DEV_SEED_PROJECT}_1`, path: "/work/b" },
  ]);
  assert.equal(devSeedFolders(env, "prj_01k6other0000000000000000"), null);
  assert.equal(
    devSeedFolders(
      { LOPHN_DEV_SEED_FOLDERS: env.LOPHN_DEV_SEED_FOLDERS },
      DEV_SEED_PROJECT,
    ),
    null,
  );
  assert.deepEqual(
    devSeedFolders(
      { LOPHN_DEV_SEED: "1", LOPHN_DEV_SEED_FOLDERS: "{" },
      DEV_SEED_PROJECT,
    ),
    [],
  );
});
