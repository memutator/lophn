# dk-prompt-place

agent가 자기 project의 kind를 알게 하고(prompt의 kind 글, kind 파일이 바뀌면 notice), PM이 `kinds.yaml` 하나를 file tool로 고칠 수 있게 한다(file 범위, rewind, runtime 권한). context 글 자리를 kind 글로 바꾼다. 옛 context 코드(`context-text.ts` 등)는 지우지 않는다(wave 3의 `dk-delete-context-tools`가 지운다). Operator의 `contexts` 칸(`agent.contexts`)은 이 task가 읽기를 그만둘 뿐 칸 자체는 `dk-operator-contexts`가 지운다.

코드 이름은 아직 `project`·`project_manager`다.

- 단위: prompt (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/kind-text.ts`
  - `packages/protocol/lophn-agent/input-tags.ts`
  - `packages/core/lophn-agent/prompt-assembly/kind-text.ts`
  - `packages/core/lophn-agent/prompt-assembly/model.ts`
  - `packages/core/lophn-agent/prompt-assembly/basis.ts`
  - `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`
  - `packages/core/lophn-agent/prompt-assembly/mod.ts`
  - `packages/core/lophn-agent/tools/file/scope.ts`
  - `packages/core/lophn-agent/tools/file/scope_test.ts`
  - `packages/core/agent-roles/place/place-data.ts`
  - `packages/core/agent-roles/place/place-info.ts`
  - `packages/core/agent-roles/place/place-info_test.ts`
  - `packages/core/agent-roles/place/place-folders.ts`
  - `packages/core/agent-roles/place/place-folders_test.ts`
  - `packages/core/agent-roles/credentials.ts`
  - `packages/core/main/daemon/place-folders-glue.ts`
  - `tests/support/loop/harness.ts`
  - `tests/eval/experiment/assembly/prefix_test.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`의 "정한 것"(자리, 판 없음, prompt, Operator), roadmap `project-docs/products/roadmap/domain.md`의 "폴더"(PM은 `kinds.yaml`을 쓴다)
  - architecture: `project-docs/architecture/agent-definition.md`(prompt 조립, place 정보, context 글), `project-docs/architecture/place-session.md`(file 범위, rewind의 쓰기 폴더, Deno 권한은 같은 표로 만든다)
  - 지금 코드(바꿀 곳): `packages/core/lophn-agent/prompt-assembly/context-text.ts`(`buildContextText`·`renderContextText`, level `full`/`names`/`count`), `basis.ts`(`SeenBasis.contexts`, `diffBasis`), `turn-prompt.ts:132`(`diff.contexts`와 `contexts_changed` notice), `model.ts`의 `PlaceContext`, `packages/core/agent-roles/place/place-data.ts`(`readPlaceData`, `placeScope` 호출 ≈:361, `ROLE_LINE`), `place-info.ts`(`visibleContexts`, `contextLines`), `place-folders.ts`(`placeScope`, `runtimeFolders`, `draftFolders`·`draftRoot`), `packages/core/main/daemon/place-folders-glue.ts`, `packages/core/lophn-agent/tools/file/scope.ts`(`resolveInPlace`: 허용 entry는 지금 폴더만), `packages/core/lophn-agent/session/rewind/write-routes.ts:46`(`openRoot`: 기록의 root가 `foldersOf(session)`의 realpath와 같아야 한다)
  - 계약: `packages/protocol/projects/kinds-api.ts`(`kindGet`, `kindsStatusSchema`), `packages/protocol/projects/kinds-file.ts`(`Kind`, `kindsFilePath`)
  - 테스트 규칙: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `kindGet`(memory route. handler는 `dk-kinds-host`), `Kind`, `kindsFilePath`
  - 내놓는 것: prompt의 `<lophn-kinds>` 글, notice 종류 `kinds_changed`, `placeScope`가 PM의 쓰기 범위에 `kinds.yaml` 하나를 더한 것

## 할 일

1. `packages/protocol/lophn-agent/kind-text.ts`(새 file; 옛 `context-text.ts`의 꼴): `KIND_TEXT_TAG = "lophn-kinds"`, `kindTextSchema`(`{ kinds: [{ name, summary, files: string[], key, fields: [{ name, type, required: boolean, list: boolean, detail: string|null }] }], warning: boolean }`; `detail`은 enum의 `values` 또는 ref의 `to`를 글로), `KindText`, `KindTextLevel`(`full`·`names`·`count`). `packages/protocol/lophn-agent/mod.ts`의 export는 lead가 등록한다. 이 task의 코드는 file 경로로 직접 import한다.
2. `prompt-assembly/kind-text.ts`: `buildKindText(read: { kinds: readonly Kind-모양[]; warning: boolean }): KindText`(kind는 이름 순, 칸은 이름 순. 같은 입력이면 같은 글), `renderKindText(text, level)`(`<lophn-kinds>` 태그, 본문은 `escapeTagBody`, 칸은 `name: type`+`required`·`list`·detail, key 표시, glob, `warning`이면 "The kinds file has errors; kind.check lists them. The previous version is in use." 한 줄), `FolderRead` type(옛 `context-text.ts`에서 옮긴다. `place-info.ts`가 쓴다). level `count`는 "N kinds. Read them with `kind.get`"이 아니라 `kind.check`/`kind.list` 안내로(wire 이름은 `toWireToolName`). 같은 prompt prefix가 turn마다 같도록 결정적이어야 한다.
3. `model.ts`: `PlaceContext`를 `PlaceKinds = { hash: string; text: KindText }`로 바꾼다. `basis.ts`: `SeenBasis.contexts`를 `kinds: { hash: string } | null`로, `basisOf` 입력 `contexts`를 `kinds: PlaceKinds | null`로, `BasisDiff.contexts`를 `kinds: { was: boolean; now: boolean } | null`로 바꾼다(hash가 다르면 바뀐 것). `turn-prompt.ts`: `place.contexts`를 `place.kinds`로, `place.show_project`는 지운다(kind 글에 project 이름이 없다). notice는 `noticeInput({ kind: "kinds_changed", body })` 하나 + 바뀐 뒤의 글(`renderKindText(text, "full")`), kind가 없어졌으면 body만("The kinds were removed."). `prompt-assembly/mod.ts`: `buildKindText`·`renderKindText`·`PlaceKinds` export를 더한다(옛 `buildContextText` export는 그대로 둔다).
4. `packages/protocol/lophn-agent/input-tags.ts`: `NOTICE_KINDS`에 `"kinds_changed"`를 더하고 `"contexts_changed"`를 뺀다. `ATTACHED_KINDS`는 건드리지 않는다(`dk-chips-reactions`가 한다).
5. `place-data.ts`: `PlaceRead`가 `kinds`를 갖게 한다. role이 `project_manager` 또는 `operator`이고 `place.kind === "project"`일 때 `readOf(call, kindGet, { project: place.id })`를 부르고, `status.state === "none"`이거나 `kinds === null`이면 `kinds: null`, 아니면 `{ hash: status.applied_hash, text: buildKindText({ kinds, warning: status.state === "invalid" }) }`. 못 읽으면(`unavailable`) kind 글만 비우고 turn은 계속한다. lophn과 App Engineer는 kind 글이 없다. **PM에게는 kind 파일이 아직 없어도 그 경로를 알려야 한다**(PM이 처음 `kinds.yaml`을 쓸 자리다): `PlaceData`에 `kindsFile: string | null`(PM이고 project place일 때 `status.file`)을 더한다. 옛 context 읽기(`activeContexts`, `readContext`, `openDraftFolders`와 그 route 가져오기)는 이 file에서 모두 뺀다. `agent.contexts`를 더 읽지 않는다. `ROLE_LINE`의 "contexts" 문구를 "kinds"로 고친다(`project_manager`: "Looks after the project's folders and kinds.", `operator`: "Works with the kinds and tools it was granted."). `placeData()`의 반환 `place`는 `{ text, kinds, agents }`(`show_project`·`contexts` 없음).
6. `place-info.ts`: `PlaceData.contexts`와 `visibleContexts`·`contextLines`를 `kinds: PlaceKinds | null`과 `kindLines`로 바꾼다. 예산(글자 수)을 넘으면 `full`→`names`→`count`. `placeInfo(role, data, budget)`는 `visibleContexts` 없이 `data.kinds`를 그대로 쓴다. `data.kindsFile`이 있으면 place 줄 아래에 `  Kinds file: <path>` 한 줄을 싣는다(`dk-skill`의 skill이 "place 정보의 Kinds file 경로에 쓴다"고 안내한다). `place-info_test.ts`는 지운다(Operator가 남의 project context를 못 본다는 옛 규칙의 test였고, 이제 읽는 project는 place 하나다).
7. file 범위(`place-folders.ts`, `place-data.ts`의 scope, glue):
   - `PlaceFacts.draftFolders`를 `kindsFile: string | null`로 바꾼다. `placeScope`: `project_manager`이고 project place이면 `read`·`write` 모두 `[...projectFolders, ...(kindsFile ? [kindsFile] : [])]`. Operator는 project 폴더만(바뀌지 않는다). lophn은 읽기만(바뀌지 않는다). **PM만 `kinds.yaml`을 쓴다**(위험 test).
   - `place-data.ts`에서 PM의 `kindsFile`(scope의 `PlaceFacts.kindsFile`과 위 `PlaceData.kindsFile`)은 `kindGet` 출력 `status.file`이다(`kind.get`이 파일이 없어도 `file` 경로를 준다).
   - `resolveInPlace`(`tools/file/scope.ts`)가 허용 entry로 **파일 하나**를 받게 한다. 지금은 entry를 폴더로만 본다(`real(folder)`가 null이면 건너뛰고 `inside(root, actual)`). 규칙: entry가 파일이거나 아직 없는 경로(부모 폴더는 있다)이면, `actual`이 그 entry와 같은 경로일 때만 허용하고 결과를 `{ path: actual, root: dirname(entry의 실제 경로), relative: basename }`으로 낸다(rewind 기록은 root·relative를 쓴다. root가 파일이면 relative가 빈 글이 되어 기록이 깨진다). 같은 폴더의 다른 파일은 거절한다(그 폴더에는 agent 정의 `agents/`와 `extensions.json`이 있다). `scope_test.ts`에 "파일 entry는 그 파일(아직 없는 파일 포함)만 열고 같은 폴더의 다른 파일과 하위 경로는 거절한다" 경우를 표에 더한다.
   - 기준 폴더(상대 경로의 시작)는 지금처럼 `read[0]`이다. PM의 project에 등록 폴더가 하나도 없으면 상대 경로는 못 쓰고 절대 경로만 쓴다(알려진 미완 동작으로 보고).
   - `place-folders-glue.ts`: `placeFoldersOf`(rewind의 쓰기 폴더)는 `placeScope(facts).write`를 쓰되 **kinds 파일 entry는 그 부모 폴더(`<data>/projects/<id>`)로 바꿔 돌려준다**(`write-routes.ts`의 `openRoot`가 root를 폴더 목록과 비교한다). 이유와 한계를 주석 한 줄로: 쓰기 허용은 file tool의 `resolveInPlace`가 파일 하나로 좁히고, rewind 쪽은 그 폴더의 pre-image만 읽는다. `runtimeFolders`·`runtimeFoldersOf`는 `draftRoot`(`projectsRoot` 전체 쓰기)를 빼고 **active project 각각의 `kindsFilePath(dataRoot, id)`를 write에 더한다**(`projectIds(sql)`는 `packages/core/projects/lookups.ts`). `createContextFolders`·`projectsRoot`·`draftBundles` import를 없앤다(`packages/core/projects/contexts/`에서 오는 import가 이 file에 남지 않아야 한다). `runtimeFoldersOf`는 `packages/core/main/daemon/wiring/lophn-agent-runtime.ts:264`에서 부른다 — 새 project가 생겼을 때 runtime child의 권한이 project 폴더와 같은 길로 갱신되는지 그 호출을 읽고 확인한다(폴더가 갱신되는 길이면 kinds 파일도 같이 갱신된다. 아니면 보고에 적는다).
8. `credentials.ts`의 `PLACE_READS`에 `kindGet.name`을 더한다(`place-data.ts`가 turn의 agent 자격으로 읽는다. 옛 context route 줄은 그대로 둔다).
9. `tests/support/loop/harness.ts:105`와 `tests/eval/experiment/assembly/prefix_test.ts:36`의 `place` 값을 새 모양(`kinds: null`, `show_project` 없음)으로 맞춘다.
10. `place-folders_test.ts`: 표에서 `draftFolders`를 `kindsFile`로 바꾸고 PM 줄만 `kinds.yaml`을 갖는지, Operator·lophn·App Engineer는 갖지 않는지 본다. `runtimeFolders` test는 `kindsFiles` 입력으로 바꾼다.

## 정한 것

- kind 글은 project 하나의 것이라 project 이름·목적을 싣지 않는다(place 정보가 이미 `Place: project …`를 갖는다).
- 판 번호(`r3`) 대신 kinds 파일 hash로 바뀜을 본다(판이 없다).
- Operator는 그 project의 kind를 모두 받는다(README). `agent.contexts`로 거르지 않는다.
- rewind root: 파일 entry의 부모 폴더. 위 설명의 trade-off를 받아들인다(prototype).

## 끝남

- `deno task check`가 통과한다.
- 위험 test 둘: ① `place-folders_test.ts` — "PM만 `kinds.yaml`을 쓸 수 있다(Operator·lophn·App Engineer의 범위에는 없다)". ② `scope_test.ts` — "파일 entry는 그 파일만 열고 같은 폴더의 다른 파일(`extensions.json` 같은)과 밖은 거절한다".
- 남지 않음: `rg -n "draftFolders|draftRoot|show_project|visibleContexts|PlaceContext|createContextFolders|contexts_changed" packages tests`가 0줄이다. `rg -n "projects/contexts" packages/core/agent-roles packages/core/main/daemon/place-folders-glue.ts packages/core/lophn-agent/prompt-assembly`가 0줄이다(옛 `context-text.ts`와 그 test는 wave 3이 지우므로 `prompt-assembly/context-text*.ts` 안의 자기 줄은 제외).
- core 기동: `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `packages/protocol/lophn-agent/mod.ts`에 `export * from "./kind-text.ts"`
- 안 쓰게 된 export: `buildContextText`·`renderContextText`·`ContextRead`·`PlaceContext`(wave 3이 지운다), `agent.contexts`를 읽던 곳
- 정한 것
- 넘길 줄: `credentials.ts`·`place-data.ts`·`place-info.ts`·`place-folders.ts`는 다른 계획(`domain-place`, `artifact`)도 고친다. 옛 context 줄만 바꾸고 나머지는 건드리지 않았다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: project에 등록 폴더가 없는 PM은 상대 경로를 못 쓴다.
