import { loadCriterion } from "../criteria/mod.ts";
import { REPEAT_KIND } from "../experiment/repeat/mod.ts";
import { loadJudgeDefinition } from "../judge/mod.ts";
import {
  MATERIALS_ROOT,
  orderMaterials,
  verifyMaterial,
} from "../restore/manifest.ts";
import { parseRef, type VersionRef } from "../types.ts";
import {
  criterionContent,
  hashText,
  judgeContent,
  registerAuthored,
  scenarioHash,
} from "../versions/mod.ts";
import type { Discovered } from "./discover.ts";
import { REGISTRY_DIR } from "./paths.ts";

// 재료 hash를 확인하고 시나리오, 재료, criterion, judge를 registry에 올린다. 문제를 모아 돌려준다.
// judge와 repeat-kind는 judge check가 없어도 올린다: 되풀이 진단 item이 둘을 쓴다.
export async function registerAll(selected: Discovered[]): Promise<{
  problems: string[];
  materials: Map<string, VersionRef[]>;
}> {
  const problems: string[] = [];
  const materials = new Map<string, VersionRef[]>();
  const register = async (
    ref: VersionRef,
    hash: string,
    content?: string,
  ) => {
    const result = await registerAuthored(REGISTRY_DIR, ref, hash, content);
    if (!result.ok) problems.push(result.error.message);
  };
  const registerCriterion = async (ref: string) => {
    const content = criterionContent(await loadCriterion(ref));
    await register(
      parseRef(ref, "criterion"),
      await hashText(content),
      content,
    );
  };

  for (const { scenario, path } of selected) {
    await register(
      { kind: "scenario", name: scenario.id, n: scenario.n },
      await scenarioHash(path),
    );
    const ordered = await orderMaterials(MATERIALS_ROOT, scenario.world);
    if (!ordered.ok) {
      problems.push(`${scenario.id}: ${ordered.error.message}`);
      continue;
    }
    const refs: VersionRef[] = [];
    for (const material of ordered.value) {
      const verified = await verifyMaterial(material);
      if (!verified.ok) {
        problems.push(
          `${verified.error.message}. 내용이 바뀌었다. n을 올려라`,
        );
        continue;
      }
      const ref = parseRef(material.ref, "material");
      refs.push(ref);
      await register(ref, material.manifest.content_hash);
    }
    materials.set(scenario.id, refs);
    for (const check of scenario.checks) {
      if (check.kind === "judge") await registerCriterion(check.criterion);
    }
  }
  await registerCriterion(REPEAT_KIND);
  const judge = await loadJudgeDefinition();
  const content = judgeContent(judge);
  await register(
    { kind: "judge", name: "judge", n: judge.n },
    await hashText(content),
    content,
  );
  return { problems, materials };
}
