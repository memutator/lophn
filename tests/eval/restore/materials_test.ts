import { assert, assertEquals } from "@std/assert";
import { idSchema } from "../../../packages/protocol/base/mod.ts";
import {
  loadMaterial,
  MATERIALS_ROOT,
  splitRef,
  verifyMaterial,
} from "./manifest.ts";

async function allRefs(): Promise<string[]> {
  const refs: string[] = [];
  for await (const name of Deno.readDir(MATERIALS_ROOT)) {
    if (!name.isDirectory) continue;
    for await (const n of Deno.readDir(`${MATERIALS_ROOT}/${name.name}`)) {
      if (n.isDirectory) refs.push(`${name.name}@${n.name}`);
    }
  }
  return refs.sort();
}

// 재료 file이 한 byte라도 바뀌거나 이어진 재료가 사라지면 모든 기준 run이 다른 world에서 돈 것이 된다.
Deno.test("committed 재료의 hash, 고정 id, needs·parent가 맞고 앱 source file이 .tmpl로 담겨 있다", async () => {
  const refs = await allRefs();
  const known = new Set(refs);
  const needsOf = new Map<string, string[]>();
  for (const ref of refs) {
    const material = await loadMaterial(MATERIALS_ROOT, ref);
    assert((await verifyMaterial(material)).ok, `${ref} hash differs`);
    for (const id of Object.values(material.manifest.ids)) {
      idSchema(id.split("_")[0] as "app").parse(id);
    }
    const linked = [
      ...material.manifest.needs,
      ...(material.manifest.parent === null ? [] : [material.manifest.parent]),
    ];
    for (const link of linked) {
      splitRef(link);
      assert(known.has(link), `${ref} points at missing ${link}`);
    }
    needsOf.set(ref, material.manifest.needs);
    // 앱 source가 아닌 repo 코드로 읽히면 deno task check가 lint와 type check를 건다.
    for (const file of material.files) {
      if (file.path.startsWith("source/")) {
        assert(file.path.endsWith(".tmpl"), `${ref} ${file.path}`);
      }
    }
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (ref: string) => {
    if (done.has(ref)) return;
    assert(!visiting.has(ref), `needs cycle at ${ref}`);
    visiting.add(ref);
    for (const need of needsOf.get(ref) ?? []) visit(need);
    visiting.delete(ref);
    done.add(ref);
  };
  refs.forEach(visit);
  assertEquals(done.size, refs.length);
});
