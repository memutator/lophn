# uf-catalog-read

model catalog 읽기가 늘 `unavailable`인 것을 고친다. 모든 model 선택 칸이 이것 때문에 비어 있다.

- 단위: uf-catalog-read (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/models/reads.ts`
  - `packages/core/lophn-agent/models/work.ts`
  - `packages/core/lophn-agent/models/snapshot-catalog.ts`
  - `packages/core/lophn-agent/models/work_test.ts`
  - `packages/core/lophn-agent/register.ts`(createModelReads에 reader를 넘기는 줄만)
- 읽을 것:
  - README의 "찾은 것"과 "정한 것"
  - `packages/core/lophn-agent/register.ts`의 catalog read 주석(약 203~208줄), `createNodeAgentFiles`
  - `packages/core/lophn-agent/models/work.ts`의 `createCatalogRead`, `CatalogReadDeps`, fallback 갈래
  - 동기 file API를 막는 check(`tools/check.ts`의 platform/responsiveness 규칙을 찾는다)
- 계약:
  - 쓰는 것: `modelCatalogRead`(`packages/protocol/lophn-agent/models.ts`)
  - 내놓는 것: 없음(route 모양 그대로)

## 할 일

1. 동기 file API가 허락되는 자리를 check 규칙에서 확인한다. 허락되는 자리라면 그곳에서 `<data root>/derived/lophn-agent`를 읽는 동기 reader를 만들어 `createModelReads` → `createCatalogRead({ files, loadSnapshot })`로 넘긴다. 허락되지 않으면 `loadSnapshot`만 넘긴다.
2. `loadSnapshot`을 늘 넘긴다. `snapshot-catalog.ts`의 entries를 내놓는 함수를 쓴다.
3. fallback 갈래에서 `state`도 만든다. catalog 결과 schema가 요구하는 꼴(`model.ts`의 초기 state)을 쓰고, `undefined as unknown as CatalogState`를 없앤다.
4. 동작: derived file이 정상이면 그것, 없거나 깨졌으면 snapshot.

## 끝남

- `deno task check`가 통과한다.
- 위험 test 하나(`work_test.ts`, 이미 있으면 거기에): "derived file이 없는 새 data root에서도 catalog 읽기가 snapshot의 model을 돌려준다(예: `anthropic`의 `claude-sonnet-4-5`와 그 `effort` 축)." 오래 깨진 채 아무도 몰랐던 길이다.
- 손 확인: core를 띄워 dev처럼 fake provider를 붙인 뒤 `agent-model-catalog/read`가 entry를 돌려준다.
- 남지 않음: `grep -rn "catalog read 파일 reader가 없다" packages`가 0줄이거나, 그 갈래가 이제 닿지 않는다.

## 보고

- 바꾼 file, 통과한 check, 고른 길(동기 reader 또는 snapshot만)과 이유
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
