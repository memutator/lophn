# dk-kinds-worker

kinds worker process의 일을 만든다: `kinds.yaml`과 project 폴더의 문서를 읽어 item을 뽑고, 칸 schema로 검사하고, derived sqlite에 index를 두고, `list`(조건·정렬·집계)·`check`·`get`에 답한다. context worker의 추출·검사·index·조건·정렬·worker 코드를 **복사해 줄여** 새 module `packages/core/projects/kinds/`에 둔다. 옛 `packages/core/projects/contexts/`는 건드리지 않고(wave 3이 지운다) 새 코드가 거기서 import하지 않는다.

이 task는 worker 쪽(순수 일 + 파일 읽기 + sqlite + IPC)만 한다. core 쪽 process 띄우기·dispatcher·watch·route handler는 `dk-kinds-host`다. 코드 이름은 아직 `project`다.

- 단위: kinds (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/projects/kinds/extract/`
  - `packages/core/projects/kinds/check/`
  - `packages/core/projects/kinds/index/`
  - `packages/core/projects/kinds/query/`
  - `packages/core/projects/kinds/worker/`
  - `packages/core/main/worker/main.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`의 "정한 것", roadmap `project-docs/products/roadmap/domain.md`의 "재료 schema: kind와 item"(파이프라인 그림과 "남기는 것" 표), "내장 tool"
  - architecture: `project-docs/architecture/layers.md`(core domain끼리 import 금지. `projects`는 `problems`를 import하지 못한다. worker는 problem에 직접 닿지 않고 답에 실어 보낸다), `tools/check-deps.ts`(rule)
  - 복사해 줄일 원본(모두 `packages/core/projects/contexts/`):
    - 문서 읽기: `extract/document.ts`(`parseMarkdown`, `readYaml`, `splitFrontmatter`: BOM·CRLF 정리, `---` 앞머리, `@std/yaml` `schema: "core"`), `extract/fields/frontmatter.ts`의 `toText`·`coerceFieldValue`(YAML 스칼라를 글로)
    - glob 맞추기: `extract/docs-paths.ts`의 `matcherFor`(picomatch 옵션 `{ dot: true, fastpaths: false, windows: false }`)
    - 파일 보기: `worker/files.ts`의 `openProjectFiles`(≈:179)·`collect`·`readChecked`(예산: 파일 20,000개, 파일 하나 4 MiB, `.git` 제외, 폴더 밖을 가리키는 symlink 제외, 같은 상대 경로는 앞 root가 이긴다). **snapshot 쪽(`createSnapshotPort`, `cleanSnapshots`)은 가져오지 않는다.**
    - index: `index/store.ts`의 `openIndexStore`(sqlite WAL, `DatabaseSync`), `index/scan.ts`(stat으로 바뀐 파일을 찾는 방식과 "바뀐 게 없으면 다시 추출하지 않는다" 규칙), `index/scan-write.ts`
    - 질의: `search/where.ts:9`(`evaluate`), `search/sort-page.ts:54`(`sortRows`)·`:96`(`paginate`와 cursor)
    - worker 몸통: `worker/run.ts`(hello·stop·`startChild`·`reply`·`openStore`의 "손상이면 지우고 다시 만든다")
  - 계약: `packages/protocol/projects/kinds-file.ts`, `kinds-api.ts`, `kinds-work.ts`(`dk-kinds-contract`가 정했다. 이름과 모양을 그대로 쓴다)
  - 테스트 규칙: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `kindsFileSchema`, `checkKindsStructure`, `kindWatchFolders`, `folderCovers`, `kindsFilePath`, `kindsIndexPath`, `KINDS_WORKER_KIND`, `KINDS_WORK_OPS`, `KINDS_VIOLATION_CAP`, 요청·응답 schema, `Violation`, `kindListQuerySchema`, `kindCheckQuerySchema`, `kindList.output`·`kindCheck.output`
  - 내놓는 것: `packages/core/projects/kinds/worker/run.ts`가 `runKindsWorker(): Promise<void>`와 `KINDS_WORKER_KIND`(re-export)를 낸다. `packages/core/main/worker/main.ts`의 `WORKER_ENTRIES`에 `[KINDS_WORKER_KIND]: runKindsWorker`가 있다(`CONTEXTS_KIND`는 그대로 둔다).

## 만드는 것(파일 배치는 제안이다. 소유 폴더 안에서 바꿔도 된다)

1. `extract/`
   - `document.ts`: 원본 `parseDocument`에서 필요한 만큼만. md는 frontmatter map, `.yaml`·`.yml`·`.json`은 최상위 map(yaml 파서가 json도 읽는다), 그 밖의 확장자는 문서 data 없음. 읽을 수 없으면(YAML 문법 오류, map이 아님, 읽기 실패, 예산 초과) `null`. md **본문은 칸이 아니다** — 제목·section·outline·links·series·index·app-data 추출기는 가져오지 않는다.
   - `capture.ts`: `from: path`의 `capture`(예 `receipts/{year}/*.md`)를 정규식으로 바꿔 project 기준 경로에서 `{이름}`을 뽑는다. `{이름}`은 `[^/]+`, `*`는 `[^/]*`, `**`는 `.*`, 나머지는 글자 그대로 이스케이프. 안 맞으면 null.
   - `items.ts`: kind마다 glob에 맞는 파일 → item `{ kind, key, path, file, fields }`. 규칙: ① 한 파일이 둘 이상의 kind에 맞으면 어느 kind의 item으로도 올리지 않고 `overlap` violation 하나를 낸다. ② 읽지 못한 파일은 `unreadable`. ③ 칸마다 값을 `type`으로 맞춘다 — `string`(YAML number·boolean은 글로, Date는 `YYYY-MM-DD`), `number`(number만. 글자 `"12"`는 `type` 위반), `boolean`, `date`(달력에 있는 `YYYY-MM-DD` 글), `enum`(`values` 안의 글), `ref`(글), `list: true`는 배열이고 원소마다 같은 검사. `from: path`는 capture 글이고 `number` 칸이면 `Number()`로 읽어 유한하지 않으면 `type` 위반. 값이 없으면(`undefined`·`null`) `required`면 `required` 위반. ④ `key`가 가리키는 칸(`path`·`file`이면 그 값)이 비면 item key를 `path`로 둔다(위반은 `required`가 이미 냈다). item의 `path`는 project 기준 상대 경로, `file`은 확장자를 뺀 이름이다.
2. `check/`
   - `kinds-file.ts`: `applyKindsFile({ text: string|null, previous: AppliedKinds|null, files: readonly string[] })` — 순수 함수. ① `text === null`이면 `{ state: "none", using: "none", kinds: null, errors: [] }`(적용 중이던 것도 버린다). ② `@std/yaml` `parse(text, { schema: "core" })` 실패 또는 `kindsFileSchema` 실패면 `kinds_syntax` 오류 하나(메시지에 zod issue 경로만, 값 원문 없이). ③ `checkKindsStructure`(protocol)의 오류. ④ **hash가 `previous.hash`와 다를 때만** 실제 파일 목록으로 겹침 판정: 한 파일이 둘 이상 kind의 glob에 맞으면 `glob_overlap`(어느 파일·어느 두 kind인지 메시지에). ⑤ 오류가 하나라도 있으면 `{ state: "invalid", using: previous ? "previous" : "none", kinds: previous?.kinds ?? null, errors }`, 없으면 `{ state: "valid", using: "current", kinds }`. 앞의 맞던 kind를 지우지 않는 규칙이 여기 있다(위험 test).
   - `fields.ts`(또는 `items.ts` 안): item 전체를 보고 `unique`(같은 kind 안에서 null이 아닌 같은 값. 중복된 모든 item에 위반 하나씩)·`ref`(값이나 원소가 `to` kind의 어느 item key와도 안 맞으면. `to`가 가리키는 kind가 적용 중인 kinds에 없으면 이 검사는 건너뛴다)·`pattern`(string 칸의 값 또는 원소를 정규식으로)·`enum`을 낸다. **message에 문서의 값을 싣지 않는다**(칸 이름, 기대 type, 규칙, 필요하면 kind 이름·path만).
3. `index/`: `schema.ts`, `store.ts`, `scan.ts`. 표(제안): `kinds_applied(project PK, hash, text)` — 마지막으로 맞았던 kinds 파일 글(**index가 지워져도 잃는 것은 "앞의 맞던 것" 하나뿐이다. index는 파생이라 정본이 아니다**), `kinds_state(project PK, kinds_hash, scanned_at, status_json)`, `kinds_files(project, path, size, mtime_ms, kind, status ok|skipped)`, `kinds_items(project, kind, key, path, fields JSON)`, `kinds_violations(project, ord, source, kind, path, field, rule, message)`. migration 기록 없이 표가 없을 때만 한 번에 만든다(원본 `openIndexStore`와 같다). scan: `kinds.yaml` 글의 hash와 project 파일의 `(size, mtime_ms)`가 직전과 같으면 다시 추출하지 않고(직전 scan이 끝난 뒤 2초 안이면 stat도 건너뛴다. `force`면 건너뛰지 않는다), 달라지면 그 project 전체를 다시 추출·검사해 한 transaction으로 바꾼다. 파일을 읽다 실패하면 `unavailable`이고 store를 건드리지 않는다.
4. `query/`: `where.ts`(원본 `evaluate`를 `field` 기반으로. `path`·`file`도 칸으로 읽는다. list 칸은 원소 하나라도 맞으면 참. `exists`는 값이 null이거나 빈 배열이 아니면 참. 선언 입력 참조 `{input}`·`follow`는 없다), `sort.ts`(원본 `sortRows`에서 series·alias·group 정렬 제거. null은 방향과 무관하게 마지막. 같으면 key, path 순으로 tie-break), `list.ts`(kind의 item을 sqlite에서 읽어 메모리에서 거르기 → 정렬 → page. cursor는 `offset:fingerprint`이고 fingerprint는 (kind, where, sort)의 지문이다. 다르면 `invalid_input`), `aggregate.ts`(`count`·`sum`·`min`·`max`, `group_by` 칸 하나. `sum`은 number 칸만(아니면 `invalid_input`), `min`·`max`는 number·date·string 칸, `count`는 `field`가 있으면 null이 아닌 값의 수. 결과 이름은 `as` 또는 `count`·`<op>_<field>`. group 값이 null인 묶음은 마지막). 모르는 kind·칸·연산은 `invalid_input`, kinds 파일이 없으면 `not_found`.
5. `worker/`: `run.ts`(원본 `worker/run.ts`에서 `index`·`check`·`preview` 셋을 `sync`·`get`·`list`·`check` 넷으로 바꾼다. 같은 project의 일은 순서대로 하나씩, 다른 project의 일은 서로 기다리지 않는다. 일을 한 번에 받아 같은 요청은 합친다는 원본 `createContextJobs`(`work-jobs.ts`)의 규칙을 project 기준으로 줄여 쓴다), `files.ts`(`openProjectFiles`만).
   - `hello`의 `data_root`로 index 경로 `kindsIndexPath(dataRoot)`를 정한다. **요청의 `kinds_file`이 `kindsFilePath(dataRoot, project)`와 다르면 `invalid_input`으로 거절한다**(worker가 읽을 파일을 요청이 마음대로 정하지 못하게 한다).
   - `sync`는 scan 뒤 `{ status, violations(200개까지), truncated, violations_hash, changed }`를 답한다. violations 순서는 (source, kind, path, field, rule)의 code unit 순이다(같은 상태면 같은 목록이어야 hash가 같다). `status.errors`는 kinds 파일 오류이고, 그 오류도 `source: "kinds_file"` violation으로 violations 맨 앞에 넣는다.
   - `get`·`list`·`check`는 먼저 scan(2초 규칙)한 뒤 답한다. `check`는 `kind`로 거르고 같은 순서로 page한다.
6. `packages/core/main/worker/main.ts`에 위 한 줄과 import를 더한다. 이 file을 `dk-delete-core`도 나중에 고친다(옛 context 줄을 뺀다).

## 정한 것

- 원본을 import하지 않고 복사한다: 옛 module은 wave 3에서 지워지고, 원본의 type(`BundleContent`, `ContractType`)에 묶여 있다.
- 새 index 파일은 `kindsIndexPath(dataRoot)`(`derived/kinds.sqlite`)다. 옛 `derived/contexts.sqlite`는 건드리지 않는다.
- 잃는 것: 설명했듯이 index가 지워지면 "앞의 맞던 kind"가 없다. 지금 kinds 파일이 틀려 있으면 kind가 없는 상태가 되고 problem은 열린 채다. 감수한다(prototype).

## 끝남

- `deno task check`가 통과한다.
- 위험 test 둘(각각 `*_test.ts`, 임시 폴더만 쓰고 process를 띄우지 않는다):
  1. `check/kinds-file_test.ts`: "틀린 kinds 파일은 앞의 맞던 kind를 그대로 쓰게 하고(`using: "previous"`), 앞의 것이 없으면 kind가 없고, 파일이 없으면 적용 중이던 kind를 버린다" (표 하나).
  2. `worker/files_test.ts`: "project 폴더 밖을 가리키는 symlink 파일과 폴더는 `paths()`에도 `read()`에도 나오지 않고, `.git`은 건너뛴다" (원본에는 이 test가 없다. 읽기 sandbox 경계다).
- 남지 않음: `rg -n "projects/contexts" packages/core/projects/kinds packages/core/main/worker`가 0줄이다(복사본은 옛 module을 import하지 않는다). `rg -n "snapshot|bundle|ledger|series|app-data" packages/core/projects/kinds`가 0줄이다(옛 개념을 끌어오지 않았다는 뜻. 주석 포함).
- core 기동은 이 task에서 확인하지 않는다(host가 붙기 전에는 이 worker를 띄우는 곳이 없다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음(옛 module을 건드리지 않았다)
- 정한 것: 파일 배치, 표 모양, 위 "정한 것" 밖에서 정한 것
- 넘길 줄: `packages/core/main/worker/main.ts`의 한 줄
- 계약 바꾸기 요청: `kinds-work.ts`에서 모자란 칸이 있으면 여기에 적는다(고치지 않는다)
- **무겁게 짠 것**
- **알려진 미완 동작**
