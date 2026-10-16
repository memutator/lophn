# agent-tools-file

place 폴더 안에서 쓰는 file tool 일곱 개를 짓는다: `file.read`, `file.write`, `file.edit`, `file.glob`, `file.grep`, `pdf.read`, `image.read`. place 경로 검사와 session rewind용 쓰기 직전 기록도 같이 한다. 이 tool들은 agent runtime process 안에서 돌고 Gate를 거치지 않는다.

- 단위: agent-tools (wave 3)
- 선행: agent-tools-registry (`ToolDefinition`, `ToolContext`, `PlaceScope`, 껍데기 `bundles/file.ts`)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/bundles/file.ts`
  - `packages/core/lophn-agent/tools/file/` (새 폴더: `scope.ts`, `read.ts`, `write.ts`, `search.ts`, `pdf.ts`, `image.ts`)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I2.10#10`
  - spec: S4 3장(file·shell·web, pdf read, image read), 11장 3 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S8 9장 3·4(role별 file 범위) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - inventory: `I3.4#1`, `I3.4#2`, `I3.4#3`, `I3.4#4`, `I3.4#5`, `I3.8#8`
  - 결정: `../README.md` 3장 #5, #41
  - 지금 코드(옛 `document.*`는 고쳐 쓰지 않는다. 새로 짓는다): `packages/core/lophn-agent/session/rewind/record.ts`의 `recordBeforeWrite`·`RecorderPorts`, `packages/core/lophn-agent/tools/result.ts`(`limitJson`, `fitJson`)
- 계약:
  - 쓰는 것: `protocol/lophn-agent/tool-catalog.ts`의 `TOOL_INPUTS`(contract-agent-tools-catalog), `ToolContext.scope: PlaceScope`와 `ToolContext.rewind`(agent-tools-registry). place 폴더 목록은 projects의 `project_folders` 읽기에서 온다(`core/projects/ports.ts`, contract-calls-places). 이름이 다르면 그 file에서 찾는다. 모자라면 `PlaceScope`의 입력으로만 가정하고 보고한다.
  - 내놓는 것: `FILE_TOOLS` (agent-tools-registry가 `builtin.ts`에서 모은다), 순수 함수 `resolveInPlace(roots, path)`.

## 할 일

1. `file/scope.ts` (`I3.4#3`): `resolveInPlace(roots, path, mode)`는 순수 판정에 가깝게 짓는다. `roots`는 `PlaceScope`가 role과 session의 place에서 계산한 읽기·쓰기 허용 폴더다 (lophn은 등록된 모든 project 폴더를 읽기만, Project Manager는 그 project 폴더와 lophn data 안 그 project context의 초안·목차 폴더, App Engineer는 앱 source 폴더, 앱 place의 Operator는 사람이 정한 project 폴더, project place의 Operator는 그 project 폴더).
   - 상대 경로는 place의 첫 폴더 기준이다.
   - `..`로 나가는 경로, 폴더 밖 절대 경로는 `forbidden`이다.
   - 실제 경로(`Deno.realPath`, 새 파일이면 가장 가까운 있는 상위 폴더)가 허용 폴더 안인지 본다. 폴더 안에 있어도 밖으로 나가는 symlink는 `forbidden`이다.
   - lophn은 쓰기 mode를 거절한다.
2. `file/read.ts` (`I3.4#1`): `file.read`는 UTF-8 text를 줄 단위 `offset`·`limit`으로 읽는다. 상한을 넘으면 `bundles/paging.ts`의 이어 읽기 안내를 쓴다. docx 같은 나머지 형식은 text로 읽는다: 지금 코드에서 `formatForMediaType`(wave 1 remove-documents가 `packages/core/projects`에서 옮겨 둔 것)를 찾아 쓰고, 없으면 읽을 수 없는 형식 오류로 돌려주고 보고한다.
3. `file/write.ts` (`I3.4#2`, `I3.8#8`): `file.write`, `file.edit`(`old_string`이 한 번만 나와야 하고 `replace_all`이면 전부 바꾼다). 쓰기 전에 `ToolContext.rewind`(`recordBeforeWrite`의 `RecorderPorts`)로 pre-image를 남긴다. 기록이 실패해도 쓰기는 막지 않는다. shell tool이 바꾼 파일은 기록하지 않는다. `LOPHN.md` 쓰기는 설정 고치기라 Gate가 걸린다: 허용 폴더 안의 `LOPHN.md`면 `ToolContext.gate`에 설정 고치기 intent로 먼저 묻는다 (S2 5장).
4. `file/search.ts` (`I3.4#4`): `file.glob`(`pattern`, `path?`), `file.grep`(`pattern`, `path?`, `glob?`). 허용 폴더 밖과 symlink 탈출은 결과에 넣지 않는다. 결과 개수는 상한을 두고 넘으면 이어 읽기 안내를 쓴다.
5. `file/pdf.ts` (`I3.4#5`): `pdf.read`는 `pages`("1-5") 범위의 text를 돌려준다. 지금 코드에 pdf 본문 추출이 없다. npm이나 jsr의 pdf 라이브러리 하나를 고르고(license와 Deno 호환을 확인한다) 이유를 보고에 적는다. 의존성을 더하는 일은 lead가 한다(`deno.json`).
6. `file/image.ts` (`I3.4#5`): `image.read`는 이미지 파일을 읽어 tool 결과의 content를 `{ image: { media_type, data_base64 } }`로 돌려준다. 크기 상한(5 MiB)을 넘으면 오류다. 이 결과를 provider message의 image part로 옮기는 일은 agent-definition-models(`providers/adapters/messages.ts`)가 한다.
7. `bundles/file.ts`: 일곱 tool을 `defineBuiltin`으로 정의해 `FILE_TOOLS`로 내보낸다. `file.read`, `file.glob`, `file.grep`, `pdf.read`, `image.read`는 effect `read`, `file.write`, `file.edit`는 `write`.
8. (lead가 맞추며 더함 (`I2.10#10`)) 폴더 밖 경로·symlink 거절. 새 file tool이 폴더 밖과 밖으로 나가는 symlink를 거절한다. 옛 구현은 file-tracking과 함께 이미 지워졌다

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "file tool은 place 폴더 밖과 밖으로 나가는 symlink를 거절한다" — `file/scope_test.ts`가 임시 폴더에 place 폴더와 바깥 폴더, 안쪽 symlink(밖을 가리킴)를 만들고 읽기·쓰기 mode로 `..`, 절대 경로, symlink, 새 파일을 표로 돌려 허용과 `forbidden`을 본다. 임시 폴더를 쓰고 사람의 data root를 쓰지 않는다. subprocess는 띄우지 않는다.
- 남지 않음: `grep -rn "document\.\(read_section\|save_version\|create\)" packages/core/lophn-agent` 가 0줄이다(agent-tools-registry가 지운 뒤라 이 task에서 새로 생기지 않는다).

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: pdf 라이브러리, 이미지 상한, `LOPHN.md` Gate intent의 모양
- 계약 바꾸기 요청: `PlaceScope`에 필요한 projects 읽기가 contract에 없으면 그 이름

- (lead가 더함, approvals-tool-judgment가 넘긴 것) file tool 실행기가 설정 file·`LOPHN.md` 편집에 `settingsEditIntent({what, id, session, turn, toolCall, agent})`와 `isInstructionFile`(tool-judgment/intents.ts)을 쓴다. `tools/toolkit.ts`의 `builtinBinding`은 새 `ToolGate`로 옮긴 뒤 cleanup이 지운다.
