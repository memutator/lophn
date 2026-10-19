# dk-kinds-contract

kind 파일(`kinds.yaml`)의 schema, 내장 tool `list`·`check`의 입출력(core memory route 셋), core와 kinds worker 사이의 IPC 모양을 protocol에 새로 더한다. 옛 context 계약(`context-*.ts`)은 지우지 않고 옆에 둔다(wave 3의 `dk-delete-protocol`이 지운다).

코드 이름은 아직 `project`다(roadmap의 "domain"은 `domain-rename` 계획이 바꾼다). 이 task의 새 이름은 `kind`·`kinds`뿐이라 이름 바꾸기와 부딪히지 않는다.

- 단위: kinds (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/projects/kinds-file.ts`
  - `packages/protocol/projects/kinds-file_test.ts`
  - `packages/protocol/projects/kinds-api.ts`
  - `packages/protocol/projects/kinds-work.ts`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/domain.md`의 "재료 schema: kind와 item", "내장 tool", "정한 것 (agent, 초안)"
  - plan: `project-docs/plan/domain-kinds/README.md`의 "정한 것"
  - route 정의 본보기: `packages/protocol/projects/project-api.ts`(`defineRead`·`defineCommand` 꼴), `packages/protocol/base/route.ts:205`(`defineMemory`), `packages/protocol/apps/package-routes.ts:118`(`packagesBuiltin`: core 메모리 route를 agent tool이 `readOf`로 부르는 본보기)
  - 조건 연산자 본보기: `packages/core/projects/contexts/search/where.ts:9`(`evaluate`)의 `eq ne in lt lte gt gte contains exists`와 `all any not`
  - 옛 worker IPC 꼴: `packages/protocol/projects/context-work.ts`(`CONTEXT_WORK_OPS`, request·response schema)
  - 테스트 규칙: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `packages/protocol/base/{ids,values,route}.ts`(`idSchema`, `sha256Schema`, `defineMemory`), `packages/protocol/projects/values.ts`(`projectIdSchema`)
  - 내놓는 것(다른 task가 import한다. 아래 이름과 모양을 그대로 쓴다):

## 내놓는 모양

`kinds-file.ts`

- `KINDS_FILE_NAME = "kinds.yaml"`, `kindsFilePath(dataRoot, project)` = `${dataRoot}/projects/${project}/kinds.yaml`, `kindsIndexPath(dataRoot)` = `${dataRoot}/derived/kinds.sqlite`. 순수 함수다. core의 worker·host·agent-roles가 같은 경로를 쓰게 여기 한 곳에 둔다.
- `KIND_FIELD_TYPES = ["string","number","boolean","date","enum","ref"]`.
- `kindNameSchema`·`fieldNameSchema`: `^[a-z][a-z0-9_]{0,39}$`. 칸 이름은 `path`·`file`이 될 수 없다(예약. 모든 item에 늘 있는 칸).
- `kindFieldSchema`(strictObject): `type`, `required?`, `unique?`, `list?`, `values?`(enum, string 1개 이상), `pattern?`(string 전용 정규식), `to?`(ref 전용 kind 이름), `from?: "path"`, `capture?`(from이 `path`일 때 필수, 아니면 금지). refine: `enum`⇔`values`, `ref`⇔`to`, `pattern`은 `string`만.
- `kindSchema`(strictObject): `name`, `summary`(비지 않은 한 줄, 200자 이하), `files`(glob 문자열 1~20개), `key`(칸 이름이거나 `path`·`file`), `fields`(map 칸이름 → `kindFieldSchema`, 기본 `{}`).
- `kindsFileSchema`(strictObject) = `{ kinds: kindSchema[] }`(1~50개). 타입 `KindsFile`, `Kind`, `KindField`.
- 규칙 이름 목록(violation과 오류가 쓴다):
  - `DOCUMENT_RULES = ["unreadable","required","type","enum","pattern","unique","ref","overlap"]`
  - `KINDS_FILE_RULES = ["kinds_syntax","duplicate_kind","unknown_kind","bad_key","bad_capture","bad_pattern","bad_glob","duplicate_glob","glob_overlap"]`
- `kindsFileErrorSchema` = `{ rule: kindsFileRule, kind: string|null, field: string|null, message: string }`(message는 한 줄, 값 원문을 싣지 않는다).
- `kindWatchFolders(kinds: Kind[]): { path: string; recursive: boolean }[]`와 `folderCovers(folder, path): boolean`: kind의 glob이 가리키는 폴더 집합을 낸다(순수 함수, picomatch 없이 `* ? [ ] { } ( ) !`가 든 칸을 glob 칸으로 본다). 규칙은 옛 `packages/core/projects/contexts/watch/folders.ts`의 `folderOfPattern`·`mergeFolders`·`folderCovers`와 같다(파일 이름 칸을 뺀 폴더 칸 중 처음 glob 칸 앞까지가 literal 폴더, glob 폴더 칸이나 `**` 이름 칸이 있으면 recursive, 같은 폴더는 recursive가 이기고 recursive 폴더 아래 폴더는 합쳐 지운다. path 순). worker(훑을 폴더)와 host(감시할 폴더)가 같은 값을 쓰려고 여기 둔다.
- `checkKindsStructure(file: KindsFile): KindsFileError[]`: **순수 함수**(yaml·fs·picomatch 없음). 잡는 것: 이름이 겹치는 kind(`duplicate_kind`), 없는 kind를 가리키는 `ref.to`(`unknown_kind`), 선언되지 않은 `key`(`bad_key`), `capture`에 `{<그 칸 이름>}`이 정확히 한 번 없음(`bad_capture`), 컴파일 안 되는 `pattern`(`bad_pattern`), 절대 경로·`..`·빈 값·`\`가 든 glob(`bad_glob`), 두 kind에 문자열이 같은 glob(`duplicate_glob`). `kinds_syntax`(yaml 문법·zod 실패)와 `glob_overlap`(실제 파일 목록이 필요하다)은 core가 낸다.

`kinds-api.ts`: core 메모리 route 셋(`defineMemory`, resource `kinds`, actors `["user","agent","machine"]`). handler는 core가 붙인다(`dk-kinds-host`).

- 공통: `violationSchema` = `source: "kinds_file"` 변형(`rule`은 `KINDS_FILE_RULES`, `kind`·`field`는 null 가능, `path`는 null)과 `source: "document"` 변형(`rule`은 `DOCUMENT_RULES`, `kind`는 string, `path`는 project 기준 상대 경로, `field`는 null 가능)의 discriminated union, 둘 다 `message`(한 줄). 타입 `Violation`. 문제의 정체성 key는 `(source, kind, path, field, rule)`이다.
- `kindsStatusSchema` = `{ file: 절대 경로, state: "none"|"valid"|"invalid", using: "current"|"previous"|"none", errors: kindsFileError[], applied_hash: sha256|null }`. 파일이 없으면 `none/none`, 맞으면 `valid/current`, 틀렸으면 `invalid`이고 앞에 맞던 것이 있으면 `previous` 없으면 `none`.
- `kindGet`: `name: "kind.get"`, method `get`. input `{ project }`. output `{ project, status, kinds: Kind[] | null }`(쓰고 있는 kind. 없으면 null).
- `conditionSchema`: leaf `{ field, op, value }`(op: `eq ne in lt lte gt gte contains`), `{ field, op: "exists" }`, `{ all: condition[] }`, `{ any: condition[] }`, `{ not: condition }`. `field`는 칸 이름이거나 `path`·`file`. **재귀(`z.lazy`)로 쓰지 않고 깊이 3까지 풀어 쓴다**(함수로 3단 만든다). 이유: agent tool의 input schema는 `z.toJSONSchema`(`packages/core/lophn-agent/tools/wire.ts:58`)로 model에 가고, 재귀는 `$ref`를 내서 provider마다 받는 쪽이 갈린다. 실행하는 쪽(worker)의 평가는 깊이 제한이 없는 재귀여도 된다.
- `aggregateSchema` = `{ op: "count"|"sum"|"min"|"max", field?, as? }`(`count` 외에는 `field` 필수).
- `kindListQuerySchema`(strictObject, **zod `.default()`를 쓰지 않는다**: tool 입력은 파싱 결과가 입력과 달라지면 거절된다 — `packages/core/lophn-agent/tools/schema.ts`의 `unchanged`. 기본값은 handler가 적용한다): `{ kind, where?, sort?: [{field, dir: "asc"|"desc"}], fields?: string[], limit?: 1..200(기본 50), cursor?, aggregate?: aggregate[](1~8개), group_by?: field }`. refine: `aggregate`가 있으면 `sort`·`fields`·`limit`·`cursor`가 없고, `group_by`는 `aggregate`가 있을 때만.
- `kindList`: `name: "kind.list"`, method `list`. input `{ project, query: kindListQuerySchema }`.
  - output: `{ kind, mode: "items", items: [{ key, path, fields }], total, next_cursor: string|null, skipped }` 또는 `{ kind, mode: "aggregate", groups: [{ group: unknown|null, values: record<name, number|string|null> }], total, skipped }`. `skipped` = `{ count: int, reason: string }`(읽지 못했거나 type이 맞지 않아 index에서 빠진 문서 수. 0이어도 늘 준다).
  - 오류: kind 파일이 없으면 `not_found`, 모르는 kind·칸·맞지 않는 연산(숫자가 아닌 칸의 `sum`)은 `invalid_input`, worker가 없으면 `unavailable`.
- `kindCheckQuerySchema`(strictObject, default 없음): `{ kind?, limit?: 1..200(기본 50), cursor? }`.
- `kindCheck`: `name: "kind.check"`, method `check`. input `{ project, query: kindCheckQuerySchema }`. output `{ status, violations: Violation[], total, next_cursor }`. kind 파일이 없어도 `not_found`가 아니라 `status.state: "none"`과 빈 목록이다(검사할 것이 없다는 사실을 돌려준다).
- `KIND_ROUTES = [kindGet, kindList, kindCheck] as const`.

`kinds-work.ts`: 공개 route가 아니다. 감독 pipe의 worker_request 꼴이다.

- `KINDS_WORKER_KIND = "documents/kinds"`, `KINDS_DISPATCH_PRINCIPAL = "machine:kinds-dispatch"`(core가 problem 쪽에 command를 낼 때의 machine 자격 이름. `dk-problem-core`가 이것으로 호출자를 확인한다), `KINDS_WORK_OPS = { sync: "kinds.sync", get: "kinds.get", list: "kinds.list", check: "kinds.check" }`.
- 요청 공통 `{ project, kinds_file: 절대 경로, roots: 절대 경로[](64개 이하), force?: boolean }`. `force`는 직전 scan 뒤 2초 안이어도 다시 훑으라는 뜻이다.
- `sync` 응답: `{ status, violations: Violation[], truncated: boolean, violations_hash: sha256 hex, changed: boolean }`. `KINDS_VIOLATION_CAP = 200`개까지 싣고 넘으면 `truncated: true`다. `violations_hash`는 (`status.errors` + 실은 violations)의 canonical JSON hash다.
- `get`는 요청 공통만, `list`·`check`는 요청 공통에 route input의 `query`를 더한 것이다. 응답은 해당 route output과 같다. 실패는 worker의 `ok:false` 답(`not_found` 등)이다.

## 할 일

1. 위 세 file을 만든다. zod 4(`deno.json`의 `zod`)를 쓰고 기존 protocol file의 import 꼴(`../base/...`)을 따른다.
2. `kinds-file_test.ts`에 `checkKindsStructure`의 표 test 하나를 쓴다(아래 위험 test).
3. mod.ts와 ROUTES는 고치지 않는다. 등록은 lead가 한다(보고의 "등록할 것").
4. `rg "context" packages/protocol/projects/kinds-*.ts`가 비어야 한다(옛 이름을 새 file에 끌어오지 않는다).

## 정한 것(문서에 답이 없어 이 brief가 정했다)

- 겹침(`glob_overlap`)은 **kinds 파일이 바뀔 때 그 파일 목록으로 판정**하고 그때만 kinds 파일 오류다. 이미 쓰는 kinds 파일에서 나중에 새 문서 때문에 생긴 겹침은 그 문서의 `overlap` violation이다(문서 하나 때문에 쓰던 kinds 파일이 통째로 무효가 되지 않게). 이유: 문서는 사람의 것이라 막지 않는다(roadmap "문서 위반은 아무것도 막지 않는다").
- violation `message`에는 문서의 값을 싣지 않는다(칸 이름, 기대 type, 규칙만). 문서 내용이 problem 목록과 agent tool 결과로 퍼지지 않게 한다.
- 집계가 `skipped`를 가진다: 읽지 못했거나(`unreadable`) type이 맞지 않는(`type`) 문서는 index에 올리지 않고 `skipped`로 센다. `required`·`enum`·`pattern`·`unique`·`ref` 위반 문서는 값이 있으므로 올린다.
- `kind.check`는 kind 파일이 없어도 오류가 아니다(위 output 설명).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "`checkKindsStructure`가 중복 kind, 없는 `ref` 대상, 선언 안 된 key, 틀린 `capture`·`pattern`·glob, 같은 glob 문자열을 각각 잡고, 맞는 kind 파일은 오류가 없다" (`kinds-file_test.ts`, 표 하나. 앞의 맞던 kind를 지우지 않는 규칙이 이 판정에 기댄다).
- 남지 않음: 해당 없음(새 file만 더한다). 대신 `kinds-file.ts`·`kinds-api.ts`·`kinds-work.ts`에 `context`라는 단어가 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `packages/protocol/projects/mod.ts`에 세 file의 `export *`와 `ROUTES`에 `...KIND_ROUTES`(lead가 한다. `dk-problem-contract`·wave 2가 이 등록에 기댄다)
- 안 쓰게 된 export: 없음
- 정한 것: 위 "정한 것"에서 더 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
