// context 자료(lophn-agent/harness/prompt-assemble#R4, R5, presets#R17)의 spec stub이다.
// 구현은 ctx-I55가 한다. 옛 `context-materials.ts`(관점별 outline)는 ctx-R6이 지울 때까지 그대로 두고,
// I55가 이 파일의 내용을 `context-materials.ts` 자리로 옮겨도 된다. 이 파일의 이름은 시험이 import하는
// 표면만 고정한다.
import type { Contract } from "../../packages/contracts/documents/mod.ts";
import type { CoreCall } from "./core-call.ts";

export type ContextMaterialInput = {
  context: { id: string; title: string };
  // 적용된 판의 hash. 자료의 cache key이며 본문에는 쓰지 않는다.
  bundle_hash: string;
  // 적용된 판의 계약(`context.contract`의 content.contract).
  contract: Contract;
  // run을 시작할 때 센 type별 개체 수(`context.overview`의 types). 빠진 type은 0이다.
  counts: readonly { type: string; count: number }[];
  // `glossary.list`가 준 순서 그대로.
  glossary: readonly { term: string; meaning: string }[];
};

// 머리 한 줄 `[context] <이름> | <id>` 다음에 overview(type·뜻·개수, 관계)와 용어집. 순수 함수이고 같은
// 입력은 같은 byte다. 검색 결과·개체 field·문서 본문·관점·변경됨 표시는 없다.
export function renderContextMaterial(_input: ContextMaterialInput): string {
  throw new Error("not implemented");
}

export type ContextMaterial = {
  context: string;
  title: string;
  bundle_hash: string;
  text: string;
};

export type ContextMaterialSelection = { kind: string; target: string | null };

export type ContextMaterialSet = {
  // 중복 없이, 선택 순서 다음 `context.list` 순서(제목, id)로.
  materials: readonly ContextMaterial[];
  // 자료가 0개인 이유(project가 정해지지 않음). 자료가 있으면 null이다.
  reason: string | null;
};

// run을 시작할 때 한 번 읽는다. `all`·`project` 선택은 그 project의 active context들로 풀리고
// (`context` 선택은 그 context 하나) 보관·초안 context, 읽을 수 없는 context, 적용된 판이 없는 context는
// 조용히 뺀다. 읽기만 한다(`context.list|get|contract|overview`, `glossary.list`).
export function loadContextMaterials(
  _agent: CoreCall,
  _input: {
    // 세션 작업 자리 또는 담당 범위의 project. 정해지지 않았으면 null이다.
    project: string | null;
    selections: readonly ContextMaterialSelection[];
  },
): Promise<ContextMaterialSet> {
  throw new Error("not implemented");
}
