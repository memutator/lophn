import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { test } from "node:test";
import { idSchema } from "../../../packages/protocol/base/mod.ts";
import {
  loadMaterial,
  MATERIALS_ROOT,
  splitRef,
  verifyMaterial,
} from "./manifest.ts";

async function allRefs(): Promise<string[]> {
  const refs: string[] = [];
  for (const name of await readdir(MATERIALS_ROOT, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    for (const n of await readdir(`${MATERIALS_ROOT}/${name.name}`, {
      withFileTypes: true,
    })) {
      if (n.isDirectory()) refs.push(`${name.name}@${n.name}`);
    }
  }
  return refs.sort();
}

// 재료 file이 한 byte라도 바뀌거나 이어진 재료가 사라지면 모든 기준 run이 다른 world에서 돈 것이 된다.
test("committed 재료의 hash, 고정 id, needs가 맞는다", async () => {
  const refs = await allRefs();
  const known = new Set(refs);
  const needsOf = new Map<string, string[]>();
  for (const ref of refs) {
    const material = await loadMaterial(MATERIALS_ROOT, ref);
    assert.ok((await verifyMaterial(material)).ok, `${ref} hash differs`);
    for (const id of Object.values(material.manifest.ids)) {
      idSchema(id.split("_")[0] as "app").parse(id);
    }
    for (const need of material.manifest.needs) {
      splitRef(need);
      assert.ok(known.has(need), `${ref} points at missing ${need}`);
    }
    needsOf.set(ref, material.manifest.needs);
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (ref: string) => {
    if (done.has(ref)) return;
    assert.ok(!visiting.has(ref), `needs cycle at ${ref}`);
    visiting.add(ref);
    for (const need of needsOf.get(ref) ?? []) visit(need);
    visiting.delete(ref);
    done.add(ref);
  };
  refs.forEach(visit);
  assert.deepStrictEqual(done.size, refs.length);
});
