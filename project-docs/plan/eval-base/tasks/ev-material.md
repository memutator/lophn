# ev-material

재료의 담기 쪽을 만든다: `material.json` 읽고 쓰기, content hash 재기와 확인, `needs` 순서 정하기, 결과를 새 `n`으로 쓰기, 재료 하나의 hash를 새로 써 주는 `pack` 명령. 되살리기(restore)는 `ev-restore`가 한다.

- 단위: ev (wave 2)
- 선행: ev-contracts
- 소유(이 task만 고친다):
  - `tests/eval/material/{manifest,hash,order,save,pack}.ts`
- 읽을 것:
  - 계획: `project-docs/products/roadmap/eval.md`의 "재료"(종류와 되살리는 길, 버전과 조립), `project-docs/plan/eval-base/README.md`(정한 것 5)
  - 조사: `project-docs/plan/eval-base/research/reuse-and-materials.md` Part 3(기존 hash: `bundleBytes`, `sha256Hex`), 2.7(담을 수 없는 것)
  - 코드: `packages/core/apps/packages/install.ts`의 `bundleBytes`(경로를 byte 순으로 정렬한 `path\nlength\nbytes\n`의 이음. 이 함수는 정렬하지 않으므로 호출 전에 정렬한다), `packages/base/hash.ts`의 `sha256Hex`, `packages/base/canonical-json.ts`의 `canonicalize`
  - 계약: `tests/eval/types.ts`(`Manifest`, `MaterialKind`, `MaterialRef`, `SaveSpec`)
- 계약:
  - 쓰는 것: `tests/eval/types.ts`, `packages/core/apps/packages/install.ts`의 `bundleBytes`, `packages/base`의 `sha256Hex`·`canonicalize`
  - 내놓는 것:
    - `materialsRoot(): string`(= `tests/eval/materials`의 절대 경로. 인자로 바꿀 수 있게 아래 함수들은 `root` 인자를 받고 기본값이 이것이다)
    - `parseRef(ref: MaterialRef): { name: string; n: number }`
    - `readManifest(ref, root?): Promise<Manifest>`, `readFiles(ref, root?): Promise<{ path: string; bytes: Uint8Array }[]>`(`files/` 아래 모든 파일, 상대 경로, byte 순 정렬)
    - `contentHash(manifest, files): Promise<string>`와 `verifyMaterial(ref, root?): Promise<Manifest>`(hash가 다르면 어느 재료가 어떻게 다른지 담아 던진다)
    - `orderWorld(refs: MaterialRef[], root?): Promise<MaterialRef[]>`(`needs`를 먼저 되살리는 순서. 중복 없음. 순환이나 없는 재료는 던진다)
    - `writeNextVersion(args, root?): Promise<MaterialRef>`(결과를 `<이름>/<n+1>/`에 쓰고 hash를 채운다)
    - `deno run -A tests/eval/material/pack.ts <이름>@<n>`: 그 재료의 `content_hash`를 다시 재서 `material.json`에 쓴다.

## 할 일

1. `hash.ts`: `contentHash`.
   - 입력은 `files/` 아래 모든 파일에 가상 파일 하나를 더한 것이다. 가상 파일의 경로는 `material.json#recipe`, 내용은 `canonicalize({ kind, needs, recipe })`의 UTF-8 byte다. 이유: Operator·grant 같은 재료는 `files/`가 비어 있고 내용이 recipe에 있어 recipe가 hash에 안 들면 바뀌어도 모른다. roadmap이 적은 `sha256Hex(bundleBytes(files))` 그대로에 recipe를 더한 꼴이다.
   - 경로 정렬은 byte 순(`<`, `>` 문자열 비교. `bundleBytes`를 쓰는 package의 `sortFiles`와 같다). `.git/`, `node_modules/`, `*.sqlite*`는 담지 않는다고 정하고 읽을 때 건너뛴다.
   - `content_hash`·`produced_by`·`parent`는 hash 입력에 들지 않는다.
2. `manifest.ts`: `material.json`을 읽고 `Manifest` 모양을 검사한다(zod 아님. `kind`가 `MATERIAL_KINDS`에 있고 `n`이 양의 정수고 `needs`가 `이름@n` 꼴인지 정도만. 전체 recipe 검사는 하지 않는다). 쓸 때는 `JSON.stringify(x, null, 2) + "\n"`.
3. `order.ts`: `needs`를 따라 위상 정렬한다. 같은 이름의 다른 `n`이 한 world에 같이 들면 던진다(앱 id가 겹친다).
4. `save.ts`: `writeNextVersion({ name, kind, needs, recipe, files, parent, produced_by })`. 같은 이름의 가장 큰 `n`을 찾아 `n+1` 폴더에 쓴다(이미 있으면 던진다. 덮지 않는다). `parent`는 호출자가 준다. 첫 판이면 `n=1`, `parent=null`. 사람이 보고 commit하므로 commit은 하지 않는다.
5. `pack.ts`: 위 명령. 재료 데이터를 손으로 쓴 사람(ev-world)이 hash를 채울 때 쓴다.
6. 확인: scratch(`.dev-data/ev-material/`, commit하지 않는다)에서 임시 root에 재료 둘(`b`가 `a@1`을 needs)을 만들어 `pack` → `verifyMaterial` 통과, 파일 한 byte를 바꾸면 던짐, recipe만 바꿔도 던짐, `orderWorld(["b@1"])`가 `["a@1","b@1"]`, `writeNextVersion`이 `a@2`를 씀. core는 띄우지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. `tests/eval`은 check의 test discovery에 안 든다. hash 불일치는 runner가 provider를 부르기 전에 멈추는 것으로 지킨다(ev-run).
- 남지 않음: scratch를 commit하지 않았다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 `deno.json`의 `exclude`에 `tests/eval/materials`를 더하고, `tools/check.ts`의 `DENO_EXCLUDED`에도 같은 줄을 더해야 한다(재료의 json·md·소스가 fmt, lint, `deno check` 대상이 되지 않게). 이유를 보고에 적는다.
- 정한 것: hash 입력에 recipe를 더한 것(roadmap 글자 그대로와 다르다), 건너뛰는 폴더
- 계약 바꾸기 요청: `Manifest` 칸을 바꿔야 하면 여기 적는다
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: 없음이면 "없음"
