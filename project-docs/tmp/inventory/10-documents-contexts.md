# 문서와 context 구현 목록 (2026-10-15)

기준 코드: main `acfe4cc3`. 본 설계: spec S1(event), S4(agent definition 4장 context·용어집·목차 tool, 9장 `document.*` 지움, 11장 13), S8(place), `requirements/core-projects.yaml`(req-0001, 1471~1480), `requirements/core-contexts.yaml`(28개), `tmp/changes.md` 3~4장, `tmp/changes-by-topic.md`(documents/*, 7장 context 보관), `tmp/notes/removed.md` 1장, docs-review의 projects·contexts 절, `products/AGENT-ROLE.md`(Project Manager, C1~C8, E5), `PRODUCT.md` 3장 pdf 목차 예.

규모 감: `packages/core/projects/`는 테스트 빼고 약 4만 3천 줄이다. 아래 여섯 폴더가 통째로 사라진다. `addressing` 770줄, `versions` 3,281, `file-tracking` 11,467, `formats` 2,593(+ QuickJS guest `bundle.js` 301KB), `outline-and-search` 7,334, `series` 1,873. 그 테스트 파일이 93개(약 3만 5천 줄)다. `registry`(2,262)는 고치고 `contexts`(14,415)는 대부분 남는다.

## 덜어낼 것

### documents 쪽: core 폴더

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| 문서 주소 체계 통째로 | removed.md 1장 "문서 주소 체계", docs-review projects 절 | `packages/core/projects/addressing/`(7개 파일 770줄 + 테스트 4개 1,874줄). `place_names`·`document_names` 표(`addressing/schema.ts`), 문서 이름 command·read, `testing-fixture.ts` | 문서 = 파일, 주소 = 파일 경로다 |
| place 이름 예약 port | 같음. 문서 주소 이름 공간이 없어진다 | `packages/protocol/projects/places.ts`(`placeNameReservation`), `core/projects/addressing/mod.ts`의 `createPlaceNameReservation`, 쓰는 곳 `core/projects/registry/commands.ts:21,70`, `core/apps/register.ts:68-71,266`, `core/apps/registration/commands.ts:22,80` | 앱 등록 쪽에서 이름 예약을 걷어내는 일은 앱 영역(05)과 겹친다 |
| 문서 판(version)과 판 주소 | removed.md 1장 "문서의 판과 file-tracking" | `packages/core/projects/versions/`(32개 파일 3,281줄 + 테스트 19개 7,589줄): `documents`·`versions`·`version_files` 표(`versions/schema.ts`), 저장·복원·이름 바꾸기·옮기기·archive command(`commands.ts` 1,013줄), 판 읽기(`reads.ts`), 문서 저장 범위·권한(`authorization.ts`), 앱 문서 출력(`app-output.ts`), 원본 연결(`source.ts`) | 설치 안내 manifest reader(`versions/guides.ts`)는 지우지 않고 다른 곳으로 옮긴다(고칠 것 참고) |
| file-tracking 통째로 | removed.md 1장 "tracking 켜기·포함·제외 규칙", changes-by-topic 2장 "watch·scan·version 준비, hash 비교 원자 저장" | `packages/core/projects/file-tracking/`(97개 파일 11,467줄 + 테스트 42개 14,204줄): coordinator·준비 worker 2 slot·관측 큐·상태 기억·working copy·hash 비교 쓰기·placement | 단, 이 폴더의 `DocumentsChannel`(`coordinator/serving.ts`)은 문서와 상관없이 다른 곳이 쓰는 worker 요청 통로 type이다(고칠 것에 별도 항목) |
| documents worker process 종류 셋 | 위와 같음 | `core/projects/register.ts:189-330`의 `workerSpecs`(`documents/worker`, `documents/format-runner`), `documents/preparation`(`file-tracking/worker/preparation.ts`), `core/main/worker/coordinator-entry.ts`, `preparation-entry.ts`, `core/main/worker/main.ts`의 두 import, `core/storage/blobs/child-prepare.ts:42-51`의 `documents/worker` 준비 허락 | process 종류 이름은 `protocol/supervision`의 kind 표에 있다(`supervision_test.ts:229`에서 `documents`를 확인). 확인 못함 목록 참고 |
| format module과 section 추출 | removed.md 1장 "agent에게 주는 md 목차와 부분 읽기"의 format module 줄, changes.md 3장 "목차 색인…format module의 section 추출 규칙" | `packages/core/projects/formats/`(30개 파일 2,593줄 + 테스트 6개 1,467줄): `pure/module.ts`·`pure/input.ts`, `modules/document/markdown.ts`·`html.ts`, QuickJS 호스트(`adapters/quickjs-host/host.ts`), guest 묶음(`guest/bundle.js` 301KB, `guest/module-hash.ts`의 pinned hash), runner(`runner/`), module 저장(`module-store.ts`), 저장 검사(`check.ts`, `worker/validation.ts`) | 의존 `quickjs-emscripten`(`packages/core/deno.json:7`)도 같이 빠진다. `format.list`·`format.get` 읽기(`core/projects/register.ts:123-165`)도 지운다 |
| 목차 색인과 FTS 검색 색인 | removed.md 1장 "목차 색인", req-1476 "index 없이" | `packages/core/projects/outline-and-search/`(39개 파일 7,334줄 + 테스트 15개 7,624줄): derived store 표 8개(`derived_versions`·`derived_sections`·`derived_texts`·`search_documents`·`search_rows`·`summary_cache`·`derived_cursors`, `schema.ts`), 추출 consumer(`consumer.ts`, `search-sync.ts`, `worker/search.ts`, `worker/ledger-gate.ts`), 목차·부분 읽기·cursor(`reads.ts` 1,555줄, `reader.ts`, `outline-support.ts`), 판 이력과 diff(`history-reads.ts`, `diff.ts`), series 목차(`series-outline.ts`), summary cache | 키워드 검색은 새로 만든다(새로 만들 것) |
| series registry | removed.md 1장 "series 화면과 series registry" | `packages/core/projects/series/`(16개 파일 1,873줄 + 테스트 7개 2,320줄): `series`·`series_instances`·`series_keys` 표, 가족 만들기·draft·instance·archive command(`commands.ts` 728줄), `join.ts`(저장 때 멤버로 넣기) | 다음 이름 계산은 이미 `contexts/series/next.ts`에 따로 있어 영향 없다 |
| 문서 export | removed.md 1장 "export 전부" | `packages/protocol/projects/documents.ts:321`의 `document.export`, `outline-and-search/served.ts`의 `documentExport` | |
| 사람이 올리는 문서 upload | 문서가 판이 아니라 파일이다 | `packages/protocol/projects/uploads.ts`(`document.upload`), `core/projects/file-tracking/routes/upload.ts`, `core/main/daemon/core.ts:145,1457` | `core/apps/tickets/summary-upload.ts:11`, `core/problems/repairs/fix-summary-upload.ts:12`가 이 파일의 `exactBytes`만 가져다 쓴다. 쓰는 곳 정리가 먼저다 |
| 문서 쓰기·읽기 contract 전부 | removed.md 1장, S4 9장 "document.* 전부" | `packages/protocol/projects/`: `documents.ts`(385줄: prepare·save·restore·update·set_source·archive·move·rename·list·get·resolve·export), `document-events.ts`, `document-files.ts`, `document-fixtures.ts`, `versions.ts`(384), `history.ts`(161: `document.history`·`section_history`·`diff`), `read.ts`·`read-values.ts`·`read-fixtures.ts`(`document.read`, `document.file`), `sections.ts`, `address.ts`(107), `outline.ts`·`outline-entries.ts`(`outline.root`·`place`·`document`·`series`), `guides.ts`의 outline·read 부분, `formats.ts`(257)·`format-extraction.ts`·`format-bounds.ts`, `search.ts`의 `search.query`·`search.status`, `series.ts`·`series-values.ts`, `values.ts`의 document·version·section·place 값 | 테스트 `*_test.ts` 14개가 같이 간다. `projects/mod.ts`의 `ROUTES`·`EVENTS` 모음도 정리 |
| 문서·file·series·project event type 42개 | S1 2장 "domain event인지 가리는 법", 3장 "지금은 domain마다 event type을 만들어 모든 변경을 ledger에 쓴다", 5장 목록 | `protocol/projects`의 `defineEvent`: `document-events.ts` 9개, `series.ts` 9개, `projects.ts` 5개(`ProjectCreated`·`Updated`·`TrackingChanged`·`Archived`·`Unarchived`), `files.ts` 3개(`FileWritten`·`Renamed`·`Deleted`), `context-api.ts` 16개 | 새 설계에서 문서·project·context 쪽 domain event는 `ContextViolationFound` 하나뿐이다. 위반 알림 외 context event 15개(ContextCreated 등)도 포함(고칠 것에서 `ContextViolationFound` 항목 참고) |
| Documents event 구독자와 feed | S1 3장 "Gateway", 위와 같음 | `core/projects/file-tracking/coordinator/events.ts`(`DOCUMENTS_FEED_PRINCIPAL`, `DOCUMENTS_FEED_CONTEXT`), `coordinator/feed.ts`, `core/server/credentials.ts:11`, `core/main/daemon/core.ts:209-210,2446-2460,2729,2856` | |
| machine 자격 `machine:documents*` 기록 | 위와 같음 | `core/main/daemon/core.ts:1175-1216`(documents worker token), `3228-3273`(`machine:documents-basis`·`-search`·`-roots`) | |
| 문서 tool 묶음(Operator와 모든 role) | S4 9장 "`document.*` 전부 → file tool", 3장 file read·write·edit·glob·grep | `core/lophn-agent/tools/bundles/document.ts`(791줄: `document.list`·`outline`·`search`·`read_version`·`read_section`·`read_range`·`history`·`diff`·`create`·`save_version`), `tools/tool-documents.ts`(334줄), `tools/series-next-tool.ts`(`series.next_name`), `tools/bundles/format.ts`(243), `tools/bundles/guide.ts`의 outline·read 부분, `tools/registry.ts:207-218`의 `SaveToolDocument`·`LinkProblemInterpretation` 보조 operation, 테스트 `document_tools_test.ts`·`document-tools-core_test.ts` | tool 레지스트리 전체는 영역 04가 맡는다. 여기는 문서 쪽 항목만 적었다 |
| agent tool 판정에서 "Operator의 쓰기 대상 문서가 담당 place에 있는지" 확인 | S4 3장 "file read, write, edit … Gate 거치지 않음" | `core/lophn-agent/tool-judgment`가 `document.get`을 읽어 보는 부분(`tools/registry.ts:210`의 주석) | 확인 못함: tool-judgment 쪽 실제 코드는 영역 04가 본다 |
| coding agent의 문서 통로 | removed.md 1장 "coding agent의 앱 밖 tool" | `packages/coding-agent/connection/document-save.ts`(375줄), `upload-bytes.ts`, `cli/commands/document.ts`(read·list·history·diff), `cli/commands/save.ts`, `cli/commands/series.ts`, `cli/commands/format.ts`, `cli/commands/index.ts` 중 문서 부분, `mcp-server/tools/save_test.ts` | 영역 06(coding agent)과 겹친다. 여기서는 위치만 적는다 |
| 앱 문서와 `document.save` 권한 | removed.md 1장 "앱 문서", "place 없는 문서"; changes.md 3장 "place 없는 문서, 앱 문서" | SDK `packages/sdk/cap-save/`(616줄), `core/apps/permissions/adapters/documents-save.ts`(309줄), `broker/documents.ts`, `core/apps/preview/adapters/documents.ts`, `core/apps/runtime/entrypoint/cap-host.ts`의 cap-save 연결, `core/apps/permissions/flags.ts`·`model.ts`·`schema.ts`의 `document.save` kind, `core/apps/releases/sdk-permissions.ts`, `core/projects/versions/app-output.ts`, `core/projects/addressing/app-place.ts`, blueprint의 "남길 문서" | SDK·권한은 영역 05·07과 겹친다 |
| SDK format module | changes.md 3장, docs-review sdk 절 | `packages/sdk/format-document/`(78줄 + guide), `e2e/sdk/format-document/` | |
| 문서 쪽 blob 목적 | 위 file-tracking 항목 | `core/storage/blobs/purposes.ts:43`의 `document_file`·`document_files`, `core/storage/blobs/prepare-worker-probe.ts:30`, `coding-agent/connection/testing/mod.ts:106,123,224` | blob 저장소에 남는 쓰임이 있는지는 changes-by-topic 7장 열린 질문이다 |
| project의 tracking 규칙 | removed.md 1장, changes-by-topic 3장 "tracking 규칙이 빠진다" | `packages/protocol/projects/projects.ts`의 `trackingGlobSchema`·`trackingPatternSchema`·`trackingRuleSetSchema`·`INITIAL_TRACKING_PROPOSAL`·`trackingPreviewSchema`, `project-routes.ts`의 `project.set_tracking`·`project.preview_tracking`·`project.tracking_roots`; `core/projects/registry/`의 `rules.ts` 중 include/exclude 규칙(`matchTrackingPatterns`), `placement.ts`(`exactFileGlob`·`includeExactFile`), `tracking-apply.ts`, `work.ts`(`previewTracking`), `scan.ts`, `cursor.ts`, `visibility.ts`, `store.ts` 중 tracking 열; 표 `project_tracking_patterns`와 `projects.tracking_enabled`·`use_gitignore` 열(`registry/schema.ts`) | `.gitignore` 해석(`rules.ts`의 `gitignoreExcludes`)은 새 키워드 검색이 재사용한다(새로 만들 것) |
| `project.set_tracking` 앞 단계에 묶인 "folders 바꾸기는 tracking preview 필요" 규칙 | req-1473에는 preview가 없다 | `protocol/projects/projects.ts`의 `projectUpdateInputSchema`에서 `preview`를 요구하는 두 `.refine`(folders ↔ preview) | |

### shell main process (문서 편집 길)

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| 판 복원 통로 | removed.md 1 "문서의 판" | `packages/shell/main/editor/restore.ts`(475줄), `ipc/restore.ts`, `ipc/editor.ts`의 `EDITOR_RESTORE_CHANNEL` | |
| 문서를 파일로 두기 통로 | removed.md 1 "place 없는 문서" | `main/editor/place.ts`(117줄), `EDITOR_PLACE_CHANNEL` | |
| series 새 멤버 첫 판 만들기 통로 | removed.md 1 "series 화면과 registry" | `main/editor/create.ts`(125줄), `EDITOR_CREATE_CHANNEL` | |
| version 준비와 형식 검사 | removed.md 1 | `main/editor/file-adapter.ts`(615줄) 안 `validate`, version 확정, 충돌의 `newest`(460~520, 580~600). 파일 쓰기 자체는 고칠 것 | |
| 문서 탭 layout의 문서 ID | removed.md 1 | `main/workspace/kinds/document-editor.ts`, `values.ts` 14(`DOC_ID`), `kind.ts` 27~33(`documentExists`, `canRead`) | 고칠 것의 탭 key 항목과 한 묶음 |

### context 쪽

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| 위반 넘김 command와 Run 만들기 | removed.md 4장 "위반 근거를 붙인 채 Context Engineer에게 바로 넘긴다"는 남지만 방식이 바뀐다: S1 8장 toast 반응(누르면 Router로 부른다), S3의 call. 옛 방식은 assignment와 Run을 직접 만든다 | `packages/protocol/projects/context-api.ts:882`의 `context.hand_off_violations`, `core/projects/contexts/handoff.ts`(83줄: 요청 글 만들기), `contexts/api/commands-violations.ts`의 `handOffViolations`, `api/commands-violations-evidence.ts`, `contexts/ledger/deps.ts:255-300`의 `startHandOffRun`·`isContextEngineer`(assignments 표를 직접 읽음), `api/state.ts`의 `startHandOffRun` port | 근거를 글로 옮기는 `violationRequestText`는 새 흐름에도 쓰일 수 있으나 글 안의 옛 tool 이름(`context.read_contract`)을 새 이름으로 바꿔야 한다 |
| `ContextViolationsHandedOff` event | 위와 같음, S1 5장 "domain event가 아닌 것" | `protocol/projects/context-api.ts:1198` | |
| context 만들기·보관·되살리기 command를 agent tool에서 | S4 4장 PM 쓰기 tool은 `context.draft`·`submit`·`glossary.set`·`outline.set`·`outline.delete` 다섯뿐 | `core/lophn-agent/tools/context-engineer-tools.ts`의 `context.create` tool | 확인 못함: S4가 `context.create`를 뺐는지 `context.draft`가 만드는지 정해지지 않았다(문서끼리 어긋난 것) |
| 검색마다 만드는 동적 tool | S4 11장 2 "context 검색은 `context.search` 하나에 context 이름을 인자로", docs-review S4 "컨텍스트마다 툴을 어떻게 만든다는거야" | `core/lophn-agent/tools/context-search-tools.ts`(478줄: `ctx_<ctx ULID>_<slug>_<hash8>` 이름, `searchToolName`, `CONTEXT_TOOL_PREFIX`), `context-search.ts`(218), `series-next-tool.ts`가 이 동적 tool에 붙음 | 읽기 route `context.search`는 그대로 쓴다 |
| outline kind의 "제목마다 개체" 추출 | req-0012, docs-review core-contexts 결정, changes.md 4장 "지금은 제목마다 개체를 만든다" | `core/projects/contexts/extract/outline.ts`(`outlineKind`가 heading마다 `EntityAnchor` 하나), `extract/outline-documents.ts` | 파일 하나에 개체 하나로 바꾸는 쪽은 고칠 것에 있다. 여기는 지울 로직만 적었다 |
| `context-engineer`라는 이름 | S4 11장 13, AGENT-ROLE P5 | `packages/core/lophn-agent/roles/context-engineer/`, `tools/context-engineer-tools.ts` 등. `Context Engineer`·`context_engineer`·`context-engineer` 이름이 든 파일이 `packages`와 `e2e`에 206개다(`core/lophn-agent` 86, `shell/renderer` 69, `core/projects` 20, `protocol/lophn-agent` 11, `core/testing` 6 …) | 이름을 바꾸는 것은 "고칠 것"이다. 이 칸에는 지우는 것이 없다 |
| `tracking_enabled` 열을 쓰는 context 시험 | 위 tracking 항목 | `core/projects/contexts/ledger/testing.ts:20-21,281` | |

### 시험과 fixture (문서와 context 쪽)

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| 판·tracking·series 가족·문서 주소를 다루는 e2e | AGENTS.md "틀린 옛 test는 지우고 다시 쓴다" | `e2e/flows/write-series_test.ts`(326줄), `e2e/flows/first-project_test.ts`(808줄)의 tracking·판 부분, `e2e/shell/save_test.ts`·`read-edit_test.ts`의 판·충돌 부분 | `first-project_test.ts`는 project 등록·폴더·보관 줄기만 새로 쓴다. 정확한 갈래는 확인 못함 |
| documents fixture helper | 위와 같음 | `fixtures/projects/scenarios.ts`의 `deleteAndRecreate`·`modifyKeepingSizeAndMtime`·`addLophnDataDir`(file-tracking 관측용), `fixtures/projects/weekly-report/`(series 가족 정렬용 — contexts의 series 다음 이름 시험이 쓰면 남긴다), `mixed-formats/`(format 추출용) | `korean-search/`, `notes-basic/`, `multi-folder/`는 새 키워드 검색 시험에 남는다. 영역 13(시험)이 최종 판정 |

## 고칠 것

### project(registry)

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| project 등록 입력 | folders 하나 이상을 필수로 받고, tracking 입력(`enabled: false`)을 없앤다. "폴더 없이 등록하려 하면 거절"을 검사한다 | req-1471, 1473 | `protocol/projects/projects.ts`의 `projectCreateInputSchema`(`tracking` 칸), `core/projects/registry/commands.ts:77-130`. `foldersSchema`는 빈 배열을 막지 않는다(`min(1)`이 없다. 확인함) |
| project 읽기 모양 | `project.list`·`get`에서 `tracking`, `initial_tracking_proposal`, `document_count`, `documents`(고정 문서 참조)를 뺀다. 폴더별 "찾을 수 없음" 상태를 더한다 | req-1472, 0001, 1471 | `projects.ts`의 `projectSchema`·`userProjectSchema`·`agentProjectSchema`, `registry/reads.ts:80,152,351-394`, `registry/rows.ts` |
| 폴더를 찾을 수 없을 때의 상태 | 지금은 tracking 관측이 `source_missing`으로 표시한다. 새 설계는 등록 폴더가 디스크에서 없으면 "찾을 수 없음"으로 보이고, 사람이 새 위치를 고를 때까지 짐작해 잇지 않는다 | req-1472 | `core/projects/registry/model.ts`의 `deepestRegisteredRoot`(tie면 conflict), 폴더 존재 확인은 현재 file-tracking(`worker/observers.ts`)에 있어 지워진다 |
| project 변경(update) | 이름·목적·폴더·폴더 설명 변경에서 preview 요구를 걷어낸다 | req-1473 | `registry/commands.ts:150-220` |
| 폴더 겹침 규칙 | tracking이 켜진 root끼리만 겹침을 막던 규칙을 새 규칙으로 정한다(project끼리 폴더가 겹쳐도 되는지) | req-1471 acceptance에 겹침이 없음 | `registry/model.ts`의 `overlappingEnabledRoots`(`enabled` 칸에 기댐), `validateFolderRoots`(같은 project 안 중복만 막음) |
| project archive 효과 | context 쪽 보관과 서로 어떻게 닿는지 | req-1473 "보관해도 폴더 파일 그대로", changes-by-topic 7장 | `registry/commands.ts:353`(`unarchive`가 tracking 켜짐을 확인하는 분기 제거) |
| `name`(slug) 칸 | 문서 주소의 project 이름 공간이 사라지면 `name` 유일 제약이 왜 필요한지 | removed.md 1장 주소 체계 | `registry/schema.ts`의 `name TEXT NOT NULL UNIQUE` 와 `projects_no_name_collision` trigger, `projectCreateInputSchema.name` | 확인 못함: 요구에 `name`과 `title`이 둘 다 나오지 않는다(req-1473은 "이름, 목적, 폴더, 폴더 설명"). 둘 중 무엇을 남길지 정해진 곳이 없다 |
| project 등록이 Project Manager를 만든다 | project command가 같은 tx 안에서 그 project의 Project Manager 정의를 만들어 둔다. 사람이 더하거나 지울 수 없다 | S4 2장, S8 2장, AGENT-ROLE P5, req-0035 | 지금은 없다. 현재 Context Engineer는 `assignments/bootstrap.ts:18`의 `BUILTIN_ROLES = ["lophn","context_engineer"]`로 전체에 하나 심는다 |
| `project.resolve_cwd` | 쓰는 쪽이 coding agent CLI뿐인데 coding agent는 앱 개발만 한다 | removed.md 1장 "coding agent의 context 통로", S6 | `protocol/projects/project-routes.ts:145`, `core/projects/registry/reads.ts:307`, `packages/coding-agent/cli/commands/project.ts`. 확인 못함: 앱 source가 project 폴더 안에 있을 때 앱 쪽에서 쓰는지 영역 06이 본다 |

### 파일 읽기·쓰기와 검색 (documents 남은 몫)

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| 사람 파일 통로 `files.*` | `FileTarget`이 `project_file`·`working_copy`·`instruction_file` 셋이고 판·tracking·document id에 묶여 있다. 새 모양은 "디스크 파일 경로 하나"를 읽고 쓰는 통로(원자 교체는 유지 가능, hash 비교 쓰기·version 요청·placement·unlink는 뺀다). `working_copy`와 `place`·`version_request`·`unlink`를 지운다 | req-0001, 1474, removed.md 1장 "hash 비교 원자 저장" | `protocol/projects/files.ts`(`files.list`·`read`·`status`·`watch`·`write`·`rename`·`delete`·`file.record_result`), `file-values.ts`(`fileTargetSchema`, `fileStatusStateSchema`의 6상태, `filePlacementSchema`, `FILE_VERSION_RESULTS`), `core/projects/file-tracking/routes/files.ts`(746줄), `file-ops.ts`·`fs.ts`·`adapters/file-ops.ts`(원자 쓰기 구현 일부는 살려 쓸 수 있다) |
| 지침 파일(LOPHN.md) 편집 길 | `instruction_file` 목표로 같은 `files.*` 통로를 탄다. 위 통로를 고치면 이 목표도 함께 단순한 경로 파일로 바뀐다. 전역은 data root, project는 첫 등록 폴더 바로 아래 | req-0036, 0037, S2 5장 "지침 파일 쓰기는 설정 고치기(물음)" | `protocol/projects/versions.ts`의 `instructionTargetSchema`, `core/projects/file-tracking/instruction.ts`·`instruction-work.ts`·`worker/observation.ts`의 instruction 관측, `shell/main/editor/instructions.ts` |
| 폴더 밖 경로·symlink 거절 | 사람의 문서 탭은 project 밖 파일도 연다(req-1475 폐기). 지금 사람 통로는 `project_file` 목표의 `path`가 등록 root 안이어야 한다 | req-1475 rejected, req-0001 related | `core/projects/file-tracking/placement.ts`(614줄), `files-locate.ts`, `routes/file-read.ts`, `registry/rules.ts`의 `symlinkEscapesRoot` | agent file tool만 "place 폴더 안에서만, 밖을 가리키는 경로와 symlink 거절"(S4 3장). 이 규칙의 근거로 S4가 req-1475를 인용하는데 그 요구는 rejected다(문서끼리 어긋난 것) |
| 열기 가능한 형식 | 지금은 `FORMAT_NAMES = document, pdf, image, data` 넷과 media type 판별이 저장 때 형식을 가른다. 새 모양은 확장자로 text(열고 고침)·이미지·pdf(열어 봄)를 가르는 일만 한다. 알 수 없는 확장자는 text로 열 수 있으면 열고 아니면 거절 | req-1474 | `core/projects/formats/model.ts:123-140`(`formatForMediaType`), 쓰는 곳 `file-tracking/routes/validate.ts`·`format-validate.ts` |
| 문서 흐름의 "읽고 열기" 길 | `files.read`가 byte를 흘려 준다. 이미지·pdf를 보여 주려면 content type 판정이 필요하다 | req-1474 | `core/projects/file-tracking/routes/file-read.ts`, `file-windows.ts`(창 읽기) |
| `DocumentsChannel` 재배치 | 문서와 무관하게 `apps/revert`, `problems/{repairs,reporting,tests}`가 쓰는 "worker 요청 통로" type이다. file-tracking을 지우기 전에 공용 위치(예: `core/supervision`)로 옮긴다. 이름에서 `Documents`를 뗀다 | AGENTS.md 이름 규칙, `../../dev/code-map.md` | `core/projects/file-tracking/coordinator/serving.ts`의 `createDocumentsChannel`·`DocumentsChannel`, 쓰는 곳 `core/apps/revert/caller.ts:12`, `core/problems/repairs/context.ts:12`, `core/problems/reporting/collector.ts:20`, `core/problems/tests/control.ts:33`, `core/main/daemon/core.ts:616-627`(채널 다섯 개), 맥락 worker 채널(`core.ts:2001`) |
| redactor 위치 | `createProductRedactor`는 outline-and-search에 있는데 approvals·handoff·questions·trace-export·message-body도 쓴다. 코드 지도상 redaction은 `packages/base/redaction/` 몫이다 | code-map "platform/redaction", S4 | `core/projects/outline-and-search/redactor.ts`(48줄), 쓰는 곳 `core/approvals/text-prepare.ts:19`, `core/main/daemon/runtime.ts:56`, `core/main/daemon/core.ts:340`, `core/lophn-agent/tools/{tool-documents,handoff/body,questions/text-prepare}.ts`, `observability/trace-export.ts`, `session/message-body.ts` | outline-and-search를 지우려면 먼저 옮긴다(영역 02·11과 겹침) |
| 설치 안내(guide) 읽기 | 안내는 문서 판이 아니라 설치 묶음의 읽기 전용 파일이다. 지금 목차 자르기·부분 읽기·cursor·redaction이 문서 읽기 코드(outline-support)를 공유한다. S4 4장의 `guide.read`(제품 안내)는 단순 읽기 primitive다 | S4 4장 "안내 `guide.read`, `settings.get`", removed.md 1장 목차·부분 읽기 | `core/projects/versions/guides.ts`(127줄, 설치 manifest reader — 남김), `core/projects/outline-and-search/guides.ts`(420줄 — 목차·cursor 부분은 빼고 단순 읽기로), `protocol/projects/guides.ts`(`guide.list`·`get`·`outline`·`read`), `core/lophn-agent/tools/bundles/guide.ts`(307줄), `core/lophn-agent/roles/lophn/guides/` |
| core.ts 조립 | documents worker, coordinator 요청 통로, 준비 relay, 형식 검사 relay, search 서빙, 색인 따라잡기, root 변경 시 documents worker 재시작을 걷어내고 contexts worker만 남긴다 | 위 덜어낼 것 | `core/main/daemon/core.ts` 3,628줄 중 documents 관련 약 190줄 곳곳(142-243 import, 477-480, 573-627, 744-771, 878-939, 1175-1300, 1453-1580, 1805-1990, 2446-2460, 3205-3273, 3502-3600), `core/main/daemon/runtime.ts`, `core/main/daemon/registration.ts`, `core/projects/register.ts`(전체 재작성), `core/projects/mod.ts`(addressing·outline-and-search·versions export 제거) |

### shell main process

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| 편집기 파일 adapter | main이 core `/v1/files/*`로 `project_file`·`working_copy`·`instruction_file` 목표를 부르고 원자 교체·hash 비교·version 준비 단계를 옮긴다 → 경로 하나를 읽고 쓰는 얇은 adapter(project 밖 경로도 허용). 쓰기 충돌은 디스크 hash 비교만 | req-0001, 1474 | `main/editor/file-adapter.ts`(615줄), `core-port.ts`(235줄), `ipc.ts`(246줄), `ipc/editor.ts`(309줄), `preload/editor-api.ts` |
| 지침 파일 길 | 연결 문서 id를 풀어 열고 첫 저장이 파일을 만든 뒤 문서가 생기길 기다린다 → project `LOPHN.md`는 일반 경로 파일 | req-0036, 0037 | `main/editor/instructions.ts`(228줄), `ipc/instructions.ts`(66줄) |
| 창 닫기 guard | 저장 중 수·쓰기 실패·불명·충돌을 묻는다. 판 확정 단계가 빠지면 상태 수가 줄 뿐 남는다 | removed.md 1 | `main/editor/close-guard.ts`(193줄) |

### contexts

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| outline kind | 제목마다 개체 → 파일 하나의 목차 전체가 개체 하나. `min_level`·`max_level`은 개체 수를 정하는 게 아니라 목차 tree의 깊이 제한이 된다. `format`은 `markdown` 하나(`OUTLINE_FORMATS`)에서 pdf·docs 같은 저장 목차로 넓힌다 | req-0012, docs-review core-contexts 결정 | `protocol/projects/context-contract.ts:90-103`(`outlineSourceSchema`, `OUTLINE_FORMATS = ["markdown"]`), `core/projects/contexts/extract/outline.ts`, `extract/types.ts`(`Heading`·scope `section`), `validate/sources.ts`, `validate/fields-from.ts`(`from: outline`의 `max_level` field) |
| 두 번째 md 목차 parser 통합 | 지금 목차 parser가 둘이다: context는 `protocol/projects/outline-markdown.ts`의 `parseOutline`을 쓰고, 문서 탭 Outline과 agent 부분 읽기는 format module(`formats/modules/document/markdown.ts`, 저장 때 `derived_sections`에 씀)을 쓴다. 문서 탭 Outline이 `parseOutline` 하나를 쓴다 | req-0002, 0003, docs-review projects 절 "parser가 둘이다" | `shell/renderer/editor`가 `outline.document`(worker route, derived 표)를 읽는다(`renderer/editor/core-source.ts`, `main/desktop/core/allowlist.ts:18`). 두 parser 모두 같은 줄 규칙을 복붙해 둔다(`formats/modules/document/markdown.ts:5-13`와 `outline-markdown.ts:67-73`) |
| md 목차 parser 안의 agent용 칸 | 새 요구(req-1484, 1485)는 ATX·setext, front matter·fenced code 제외, level 건너뛰기, section 범위만 말한다. `key`(slug, `-2` 붙이기), `anchor`(`{#id}` 꼬리), `estimated_tokens`, `body_hash`, `children_count`, HTML `<pre>` 제외는 지운 주소 체계·부분 읽기·section 비교의 몫이었다. 쓰는 곳을 보고 뺄지 정한다 | removed.md 1장 "section을 이름으로 부르기", "agent용 md 목차(estimated token)" | `protocol/projects/outline-markdown.ts`(`OutlineNode`, `slugFromTitle`, `ANCHOR_TAIL`, `PRE_OPEN`), `outline-markdown-sha256.ts`(136줄: `body_hash`만을 위한 sha256), `outline_test.ts`, `outline-markdown_test.ts`. 쓰는 곳은 `contexts/extract/document.ts:70`과 `types.ts:26`이 `level`·`title`·`subtree_range`만 쓴다. 지금 parser는 이미 ATX·setext·front matter·fence 규칙을 지킨다 |
| `context.search`를 부르는 tool | 위 덜어낼 것의 동적 tool 대신 `context.search`(context 이름, 검색 이름, 입력)를 받는 한 tool | S4 4장, 11장 2 | `core/lophn-agent/tools/context-search-tools.ts`, `registry.ts` |
| Project Manager 쓰기 tool | `context.draft`(새 판의 초안 폴더를 연다)·`context.test`·`context.submit`·`glossary.set`·`outline.set`·`outline.delete`로 맞춘다. 읽기는 모든 role: `context.list`·`context.get`·`context.search`·`context.violations`·`glossary.get`·`outline.get` | S4 4장 자원별 tool 표 | 현재 이름은 `context.create`·`context.read_contract`·`context.draft`(= `bundle.save_draft`로 JSON 내용을 통째로 저장)·`context.preview`·`context.submit`·`context.violations`·`context.glossary_read`·`context.glossary_write`(`context-engineer-tools.ts:42-60`), 조회 `context.list`·`get`·`overview`·`containing`(`context-lookup-tools.ts:36-55`). `context.draft`는 지금 읽기 route 이름(`protocol/projects/context-api.ts:950`)과 쓰기 tool 이름이 뒤섞여 있다 |
| 초안 판의 저장 방식 | 초안 판 내용(JSON `BundleContent`)을 tool 인자로 통째로 저장한다 → "초안 폴더"를 열고 계약과 검색 script를 그 폴더에 file tool로 쓴다. `context.test`가 그 폴더를 격리 test로 돌린다 | S4 4장 `context.draft`·`context.test`, S4 4장 나누는 기준 5, req-0021 | `bundle.save_draft`·`discard_draft`·`submit`(`protocol/projects/context-api.ts:787-816`), `core/projects/contexts/api/commands-bundle.ts`(331줄), `ledger/content-blobs.ts`·`blob.ts`(내용 blob), `contexts/preview/`(초안을 현재 파일로 추출해 보기) | 폴더 위치와 PM의 file tool 범위가 어긋난다. 확인 못함 참고 |
| 판 test | 지금 `bundle.submit`이 곧 검사 시작이고 통과하면 자동 적용된다. 새 설계는 제출 전 `context.test`(읽기)를 따로 둔다. 제출 뒤 통과하면 자동 적용은 같다 | S4 4장, req-0021, 0023 | `contexts/check/`(runner 446줄), `bundle.finish_check`·`bundle.rollback`(`context-api.ts:818-838`), `contexts/preview/` |
| 판 적용 뒤 되돌리기 | 사람이 판을 되돌리는 command(`bundle.rollback`)는 남는다(req-0022). PM tool에는 없다. 사람 화면의 되돌리기 진입은 영역 UI | req-0022 | `context-api.ts:829`, `contexts/api/commands-bundle.ts` |
| 위반 알림 event | `ContextViolationsRecorded`(count before/after, 모든 변화를 기록)를 `ContextViolationFound`(새 위반이 생김)로 바꾸고, subject를 project로 둔다. 위반이 줄거나 고쳐지는 건 domain event가 아니다 | S1 5장 목록과 "domain event가 아닌 것"(위반이 고쳐짐) | `protocol/projects/context-api.ts:1187`, `contexts/api/commands-violations.ts`의 `recordViolations`(개수 비교·bundle hash 확인), `core/notifications/model.ts:69-99`(`violationsRose`가 개수 증가를 본다), `protocol/notifications/notifications.ts:22,99`. "새 위반"을 개수 증가로 판정할지 집합 비교로 할지 정해야 한다(고쳐진 위반 하나와 새 위반 하나가 같은 scan에 겹치면 개수가 같다) |

| 용어집 | `set_by: user | agent` 값과 도구 이름만 바꾼다. `glossary.remove`는 S4 도구 표에 없다 | S4 4장 | `ledger/schema.ts:glossary_entries.set_by`, `api/commands-glossary.ts`, `protocol/projects/context-api.ts:893-913`(`glossary.set`·`remove`·`list`) |
| saved view의 출처 값 | `origin: 'user' | 'engineer'`의 `engineer`를 `project_manager`로 | S4, AGENT-ROLE | `ledger/schema.ts:saved_views.origin`, `api/commands-views.ts:58-66`, 계약 안 `saved_views`는 `context-contract.ts:486-503` |
| context 보관 | 옛 contexts R4(보관하면 검색·위반 알림에서 뺀다)가 새 요구에 없고 지운 기록도 없다. 지금 watch는 보관된 context를 건너뛴다 | changes-by-topic 7장 "context 보관" | `contexts/ledger/schema.ts:contexts.status`(`archived`), `api/commands-lifecycle.ts`, `watch/service.ts` | 정해질 때까지 그대로 둔다 |
| 사람 쪽 command 행위자 | `context.create`는 agent·user 둘 다, `bundle.save_draft`는 agent만, `view.save`는 user만이다. PM이 saved view를 둔다(req-0026)는 `BundleContent.saved_views` 안에 선언한다 | req-0026, 0028 | `protocol/projects/context-api.ts:756-870` |
| 용어 정리: 이름 | `Context Engineer` → `Project Manager`. project마다 하나로 바뀌므로 role 판별(`isContextEngineer`), 역할 표(`role-caps.ts`), 명령(`commands/registry.ts` role built-in: check-contracts·new-context), prompt(`roles/context-engineer/prompt.md`), 알림 계기 표(`NOTIFICATION_ASK_ROLES`)가 바뀐다 | S4 7장·11장 13, AGENT-ROLE P5 | 206개 파일(위 덜어낼 것 항목). 지침 파일 위치, 놓이는 위치(project place)는 영역 04·08 |
| context 파일 읽기의 경로 규칙 | 계약 경로는 project 폴더 기준 상대 경로다. 지금 `.git`만 건너뛰고 `.gitignore`는 보지 않는다. 계약이 가리키는 파일에 `.gitignore`가 영향을 주는지 정해진 곳이 없다 | req-0005, 0006 | `contexts/worker/files.ts:40`(`SKIPPED_NAMES`), `contexts/watch/fs.ts` | 확인 못함 |

## 새로 만들 것

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| project 키워드 검색 | 한 project(폴더 하나로 좁힐 수 있음)의 text 파일을 검색할 때 훑는다. `.gitignore`가 뺀 경로와 `.git` 폴더를 건너뛰고, 대소문자 무시 부분 문자열 일치를 NFC로 맞춘 뒤 비교한다. 결과는 경로, 줄, 일치 부분이 든 snippet이고 경로 순서 다음 줄 순서로 낸다 | req-1476~1480, 0001 | 새 module(예: `packages/core/projects/search/`). `ignore` 의존(`packages/core/deno.json:4`)과 `registry/rules.ts`의 `gitignoreExcludes`는 재사용. 새 읽기 route(옛 `search.query`와 다른 모양: place·format·cursor·score·summary 없음). 중첩 `.gitignore`·등록 폴더 여럿·도는 동안 파일이 사라지는 경우도 다룬다 |
| pdf·docs 목차 저장과 `outline.get/set/delete` | Project Manager가 pdf·docs 같은 program이 못 만드는 형식의 목차를 만들고 고치고 지우며 lophn data의 그 context 아래에 둔다. 읽기는 모든 role. outline kind가 md면 program이 파싱하고 그 밖은 이 저장본을 쓴다 | req-0012, S4 4장 "목차", AGENT-ROLE C4·C5, PRODUCT.md 3장 | contexts 표(새 표 또는 data 폴더 파일)와 `contexts/extract/outline.ts`, `protocol/projects/context-api.ts`의 새 route 셋, `core/lophn-agent/tools`의 새 tool 셋. 원본이 바뀌어도 program은 낡음을 감지하지 않는다(PRODUCT.md 3장, AGENT-ROLE C5) |
| `pdf.read`·`image.read` core 쪽 | pdf의 쪽 범위를 text로 읽어 주고, 이미지를 model에 보인다. 지금 pdf 본문 추출 코드가 없다(`formats/model.ts:85`는 "Section extraction is unsupported"라고만 한다. 의존도 없음을 확인함) | S4 3장·11장 3 | `core/lophn-agent/tools/`의 새 tool(영역 04와 같이). 새 pdf 의존이 필요하다 |
| `ContextViolationFound` domain event와 handler | 위 고칠 것 참고. 이름이 새 event이니 새로 쓰는 쪽으로 센다 | S1 5장 | `protocol/projects/context-api.ts`, ledger 등록, Reactor handler |
| 초안 폴더 열기와 `context.draft`·`context.test` tool | 새 판의 초안 폴더를 열고(내용은 file tool로 씀), 그 폴더를 격리 test로 돌린다. 폴더는 판이 제출·버려질 때까지만 있다 | S4 4장, req-0021, 0023, 0024(초안이 있는 동안 적용된 판을 쓴다) | `contexts/api/commands-bundle.ts`, 새 route·tool. 폴더 위치(lophn data의 context 아래)와 PM의 file tool 범위 연결이 필요하다 |
| 위반 반응 | `ContextViolationFound` → Reactor handler → reaction grant → Router(보낸 쪽 program, 근거 seq) → 그 project의 Project Manager 새 session. 위반 근거를 그 session 입력에 붙인다 | S1 5장·9장 흐름 2, AGENT-ROLE E5, S3 | 지금은 없다(사람이 누른 `hand_off_violations`뿐). Reactor handler는 영역 01 |
| `context.list/get/search/violations`, `glossary.get`, `outline.get`의 새 tool 이름 | 읽기 primitive를 `<자원>.<동사>`로 | S4 4장 | `core/lophn-agent/tools/` |
| 사람의 문서 탭이 여는 형식 viewer용 core 길 | 이미지·pdf를 byte로 읽어 주는 길과 그 content type 판정 | req-1474 | 고칠 것의 `files.*` 항목에 포함. UI 쪽은 UI 새로 만들 것 |
| 폴더가 없어진 project 폴더 다시 잇기 | 등록 폴더가 디스크에서 없어졌을 때 "찾을 수 없음"으로 보이고, 사람이 새 위치를 고를 때 그 폴더만 새 경로로 바꾼다 | req-1472 | `registry/commands.ts`(폴더 경로 바꾸기 command), 폴더 존재 확인 read |
| Project Manager 생성 hook | project 등록 command가 PM place 정의를 같은 tx에서 만든다 | S8 2장 | `registry/commands.ts` + `core/lophn-agent/agents` (영역 08과 같이) |

## UI 덜어낼 것

경로는 `packages/shell/` 아래다. 줄 수는 test와 css를 뺀 대략이다. 지울 때 같은 폴더의 `_test`와 testdata도 같이 지운다.

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| 버전 비교 화면 | removed.md 1 "문서의 판과 file-tracking", changes-by-topic 4 shell/editor | `renderer/editor/compare/` 약 1330줄(compare-view.tsx 757, model.ts 279). `renderer/editor/document-view.tsx` 625~640(CompareView 분기), `openCompare`. `renderer/workspace/workspace.tsx` 243(`compares`), 643(`compareOf`) | 정보 패널 버전 탭에서만 열린다. 충돌의 `compare` action(document-view.tsx 481)은 conflict 화면이라 남긴다 |
| 판 복원(옛 판으로 되돌리기) 흐름 | removed.md 1 "문서의 판" | `renderer/editor/document-view.tsx` 611~640(`restoreVersion`, `RestoreAnswer`), compare-view.tsx 안 복원 확인 줄 | main 쪽 `main/editor/restore.ts`(475줄)는 아래 "main process" 항목 |
| 정보 패널 버전 탭 | removed.md 1, changes-by-topic 4 shell/editor | `renderer/editor/versions/` 약 690줄(versions-tab.tsx 254, core-source.ts 310, source.ts 129). `renderer/editor/info-panel/info-panel.tsx`의 `VersionsTab` 분기. `renderer/workspace/info-panel-slot/info-panel.tsx` 10~20. `renderer/workspace/workspace.tsx` 247, 645, 899~910(`versionsTick`, `DocumentInfoPanel`) | 탭 줄이 info/versions/contexts 셋에서 info/contexts 둘이 된다 |
| 문서 머리 메타 줄의 판 번호 문구 | 같음 | `renderer/editor/document-view.tsx` 658~663(`versionMeta`) | 메타 줄에는 저장 상태만 남는다 |
| file-tracking 안내 카드와 [Turn on tracking] | removed.md 1 "tracking 켜기·포함·제외·Turn on tracking" | `renderer/workspace/tracking/tracking.tsx` 76줄. `renderer/workspace/workspace.tsx` 77~78, 125, 174, 198, 845~860 | 읽기 실패 안내(`loaded.failed`)는 남는다 |
| tracking 켜기 dialog(포함/제외 규칙, 미리보기 목록) | 같음 | `renderer/workspace/tracking/` 나머지 약 1250줄: tracking-dialog.tsx 422, preview-list.tsx 96, model.ts 191, core-source.ts 212, source.ts 69. 연결 `renderer/desktop/entry.tsx` 43, 109, `renderer/desktop/main.tsx` 28, 67, 212 | |
| Workspace의 Documents 화면(틀과 reader) | removed.md 1 "Workspace의 Documents·Context 화면" | `renderer/desktop/lophn-space/documents/` 약 1330줄(documents-screen.tsx 201, reader.tsx 353, notices.tsx 32). `lophn-space/lophn-space.tsx` 213~240. `lophn-space/model.ts`의 `LOPHN_SCREENS`에 "documents". `lophn-space/screens.ts`. `renderer/desktop/router.ts` 13~18. `renderer/desktop/main.tsx` 182, 256~261. `renderer/desktop/dev-mock/documents.ts` 397줄 | reader의 판 이동과 판 고정 읽기도 같이 사라진다 |
| Documents 화면의 문서 검색 패널 | 같음 | `lophn-space/documents/search-panel.tsx` 452줄 | place, format, series 조건으로 거르는 문서 검색. 새 키워드 검색과 다른 물건이다 |
| series 목록 화면 | removed.md 1 "series 화면과 registry" | `lophn-space/series/series-panel.tsx` 131줄, `documents-screen.tsx`의 series 탭 | |
| series 상세(멤버 목록, 보관, 순서) | 같음 | `lophn-space/series/series-detail.tsx` 436줄 | |
| series 등록 form | 같음 | `lophn-space/series/register-form.tsx` 194줄 | |
| series 새 멤버 쓰기와 판 없는 draft 문서 | 같음, "place 없는 문서" | `lophn-space/series/member-writer.tsx` 250줄, `renderer/editor/draft-document.ts` 218줄, `renderer/editor/sessions.ts` 안 draft 처리, `sessions-draft_test.ts` | `draft-document.ts`는 지침 파일의 첫 저장에도 쓰인다(UI 고칠 것의 지침 항목) |
| 문서 정리의 이름 바꾸기(링크 이름 slug) | removed.md 1 "문서 주소 체계" | `lophn-space/organize/document-panel.tsx`(534줄) 이름 칸, `organize/model.ts`의 `validName`, `nameFromTitle` | |
| 문서 정리의 place 옮기기 | 같음, "place 없는 문서" | `organize/document-panel.tsx` 옮기기 select, `placeValue`, `placeableProjects` | |
| 문서 정리의 "파일로 두기"와 "빼기", 단계 결과 표시 | removed.md 1 | `organize/document-panel.tsx`의 place와 unlink 흐름, `organize/steps.tsx` 106줄 | |
| project 상세의 소속 문서 목록 | 같음 | `lophn-space/projects/project-detail.tsx` 246~296(`source.placeDocuments`), `projects-screen.tsx` 안 `DocumentPanel` 연결 | project 이름·목적 수정과 보관은 남는다 |
| 문서 export 패널 | removed.md 1 "export 전부" | `organize/export-panel.tsx` 271줄, `project-detail.tsx`의 `ExportPanel`, `organize/model.ts`의 `leftOut`, `keptOriginal` | |
| 편집기의 형식 문제 표시(problems gutter, 문제 목록) | changes-by-topic 4 documents/formats "아예 덜어냄" | `renderer/editor/problems-gutter/` 217줄. `document-view.tsx`의 `saveProblems`, `shownProblems`. `live-preview.ts`의 문제 여백. 정보 패널의 `info-format` 줄 | |
| Context 탭 머리의 [Ask Context Engineer]와 [History] 단추 | removed.md 1 "화면마다 둔 agent 부르기 단추" | `renderer/workspace/contexts/context-frame.tsx` 162~175, `context-tab-body.tsx`의 `onAsk`, `onHistory={onAsk}`. `renderer/workspace/kinds/context.tsx` 100, `kinds/host.ts` 57 | [History]는 지금 [Ask]와 같은 함수다. 판 이력·되돌리기 화면은 없다 |
| Search 하위 탭과 Search 탭의 [Ask Context Engineer] | 같음 | `contexts/context-search-list.tsx`, `search-tab-body.tsx`, `search-tab.tsx`, `search-input-form.tsx`의 `onAsk`. `renderer/workspace/kinds/search.tsx` 172 | |
| Contexts 탭의 [New context] 단추와 안내 글 | 같음, "새 context form" | `contexts/contexts-tab.tsx` 45, 64~69 | |
| [New context] 뒤 agent 탭 열기와 draft 탭 남기기 | 같음 | `renderer/workspace/workspace.tsx` 92(`engineerTabOpen`), 205~228, 583~592(`newContext`), 655 | `context-drafting.tsx`는 확인 못함 |
| 위반 목록의 [Send to Context Engineer], [Send all …], "Context Engineer is on it" | S1 8장(agent 부르기는 위반 toast만), removed.md 1 | `contexts/context-violations.tsx` 79~190(`handOff`). `contexts/source.ts` 197(`handOffViolations`), `contexts/core-source.ts` 299 | 위반 목록에서 Project Manager를 부르는 길은 새 설계에 없다. 목록은 읽기와 파일 열기만 남는다 |
| context 목록 30초 polling(context watch) | S1 8장·12장, removed.md 1 "context watch" | `contexts/context-watch.ts` 87줄, `workspace.tsx` 211~228 | event store로 대신한다 |
| 화면을 둔 채 다시 읽는 `stamp` 장치 | S1 8장 "Context 탭은 열 때 읽는다" | `contexts/use-context-read.ts` 59줄의 `contextStamp`, `context-frame.tsx` `stamp` prop, `context-drafting.tsx`, `kinds/context.tsx` 100 | |
| 문구: Workspace Documents와 series | removed.md 1 | `packages/design/wording/en.ts`의 `documents.*` 99키(series 21키 포함) | 정규식으로 센 근사값 |
| 문구: 버전·비교·복원·저장 주체·diff | removed.md 1 | `en.ts`의 `document.*` 중 compare/version/restore/saver/diff 계열 약 60키, `project-workspace.label.info-tab-versions` | 근사값 |
| 문구: 문서 정리·export·place 단계 | removed.md 1 | `en.ts`의 `projects.*` 88키 중 export 25, step 10, file·place·move·rename·document 계열 | project 이름·목적·보관 문구는 남는다 |
| 문구: tracking | removed.md 1 | `en.ts`의 `project-workspace.tracking.*` 12키, `project-workspace.button.turn-on-tracking`, `heading.tracked`, `label.reason-tracking-off`, `title.tracking`, `launcher.label.status-tracking`·`status-not-tracking`, `projects.label.tracking-on`·`tracking-off` | |
| 문구: context의 agent 부르기·new context | removed.md 1 | `en.ts`의 `contexts.button.frame-ask`, `frame-history`, `input-ask`, `violations-send`, `violations-send-all`, `contexts.error.violations-send-failed`, `contexts.label.violations-on-it`, `contexts.button.tab-new-context`, `contexts.note.tab-new-context`, `conversation.placeholder.new-context`, `settings.button.ask-lophn`(쓰는 코드 없음) | |

## UI 고칠 것

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| 문서 탭이 여는 대상과 탭 key | 문서 ID(`doc_…`)가 탭 key이고 `documents.list`에 잡힌 문서만 연다 → 파일 경로가 key이고 project 안팎 어느 파일이든 연다. 지금은 project 밖 파일을 열 입구가 없다(`FileTarget`이 project_file, working_copy, instruction_file 셋) | req-0001, 1474, 1475(rejected) | `renderer/workspace/kinds/document-editor.tsx` 11, 14~21, 36~54. `renderer/editor/document-view.tsx` `documentId` prop. `renderer/workspace/workspace.tsx` 559~565(`openPath`: `loaded.files`에 잡힌 파일만 탭이 된다) |
| 문서 읽기 | `documents.get`, `documents.read` 12,000 codepoint page와 cursor로 판에 고정해 읽는다 → 디스크 파일을 한 번 읽는다 | req-0001 | `renderer/editor/core-source.ts` 262줄, `source.ts`(`DocumentInfo.version`, `BodyState`), `model.ts` 1~30(`joinPage`) |
| Outline 목록 | core worker route `outline.document`를 page로 이어 부르고 key, title, level, line을 받는다. `parseOutline`을 부르는 코드는 shell에 없다 → 화면이 가진 본문에 `parseOutline`을 쓸 때마다 부른다(편집 중에도 갱신). 이 parser는 의존성이 없다. 다만 `editor/core-source.ts`에 "contracts를 import하지 않는다"는 주석이 있어 import 방향은 code-map으로 확인해야 한다 | req-0002, 0003, 1484, 1485 | `renderer/editor/core-source.ts` 138~170(`outline`), `document-view.tsx` 204, 256~266, 512~560 |
| 읽기 위치 기억의 section key | outline route의 key를 layout에 저장 → `parseOutline`의 key | 위와 같음 | `document-view.tsx` 549~552, `renderer/workspace/kinds/document-editor.tsx`(`readPosition`) |
| 문서 탭이 다루는 확장자 | Markdown 전용(읽기는 design `Markdown`, 편집은 CodeMirror `lang-markdown` 하나, `EDITOR_MAX_BYTES` 8MB 글만). 그 밖은 `BodyState.unsupported`로 막힌다. 이미지·pdf viewer는 어디에도 없다(grep 확인) → 확장자를 보고 viewer를 고른다 | req-1474 | `renderer/editor/markdown-editor.tsx` 372줄, `live-preview.ts` 538줄, `preview.ts` 453줄, `document-view.tsx` 147, 169 |
| 저장 흐름과 저장 상태 | 디스크 저장, 기록 확인, version 확정, 형식 검사를 따로 기억하는 5단계 상태. 편집 종료(탭 닫기·읽기 전환·창 닫기·Ctrl+S)가 "version 준비 경계" → 디스크 저장과 충돌만 | removed.md 1 | `renderer/editor/save-state.ts` 689줄, `save-status.tsx` 292줄, `notice-bar.tsx` 90줄, `sessions.ts` 308줄(`EditorCounts.unsettled`), `leave-dialog.ts` 72줄 |
| 충돌 해결 화면 | `against: "disk"`와 `"newest"`(편집하는 사이 생긴 최신 판) 둘, 해결에 "내 것을 새 판으로 남기기"(`keepMineAsVersion`) → `"disk"`만 남긴다. 화면(conflict-view.tsx 74줄, compare.ts 117줄)은 편집기 초안과 디스크 글의 줄 비교라 file-tracking에 붙은 것이 아니다. 쓰기 충돌은 `base_hash`로 난다 | removed.md 1, req-0001 | `renderer/editor/conflict/`, `document-view.tsx` 440~470, 481~485 |
| 정보 패널 Info 탭 | 파일 경로, 원본 연결 여부, 보관 여부, format 이름, 저장 판 번호·주체·개수 → 판·format·원본 연결 줄을 빼고 파일 정보만 | removed.md 1 | `renderer/editor/info-panel/info-panel.tsx` 66~130, `versions/source.ts`의 `DocumentFacts` |
| 문서 탭의 판 표시 힌트와 pending | 탭이 판을 알아야 hint를 낸다(`TabPresentation.version`) → 판 조건을 뺀다 | removed.md 1 | `kinds/document-editor.tsx` 56~66, `kinds/host.ts` 26~32, `workspace.tsx` 469 |
| 문서 링크 고르기(`[[`)와 링크 열기 | 문서 이름이 있는 문서만 목록에 넣고 `[제목](place/이름)` 주소를 넣는다. 링크는 `documents.resolve`로 푼다 → 주소 체계 없이 project 안 파일 경로 링크 | removed.md 1 "문서 주소 체계" | `renderer/editor/link-picker/` 243줄, `model.ts` 92~102(`documentAddress`), `core-source.ts` 105~125, 190~262 |
| 지침 파일 [Instructions] 진입 | 전역, project, app 세 층의 지침을 "연결된 문서 ID"로 풀어 같은 편집기로 연다. 없으면 빈 draft를 편집기가 붙들고 첫 저장이 파일과 첫 판을 만든다 → project의 `LOPHN.md`는 일반 파일이라 일반 문서 탭으로 연다. 전역·app 층은 새 요구가 말하지 않는다 | req-0036, 0095, S4 5장 | `renderer/editor/instructions-entry.tsx` 414줄, `renderer/desktop/main.tsx` |
| sidebar 문서 목록 | 폴더 아래 "문서로 잡힌 파일"과 따로 `documents.list` 기반 평평한 Documents 묶음 → 폴더의 파일 트리 하나 | req-0001 | `renderer/workspace/sidebar/sidebar.tsx` 90~190, `workspace/source.ts`(`DocumentRow`, `FileRow.document`), `workspace/core-source.ts` 91~100, 187~215 |
| 위반 toast | 문구 "N documents don't match", [View](Violations 하위 탭), 선택 [Ask <agent 이름>](위반된 context 하나를 chip으로 붙인 새 Agent 탭을 열고 아무것도 보내지 않는다). 위반이 늘었는지는 30초 polling 비교 → toast를 누르면 그 project의 Project Manager session을 열고 그 위반(파일과 규칙)을 붙인다. 띄우는 계기는 `ContextViolationFound` | S1 8장, req-0083, 0085, 0086 | `renderer/workspace/contexts/violation-toast.tsx` 45줄, `workspace.tsx` 199~228, 737, 919~950, `openRole` 559~570 |
| 이름 Context Engineer → Project Manager | 화면 문구와 role 식별자 둘 다. shell에서 이름이 나오는 곳은 시험·testdata 포함 65개 파일 165곳, 시험 아닌 코드 약 32개 파일. 대표: `workspace/workspace.tsx`(8), `sidebar/agents-section.tsx`(5), `workspace/agents/agents-tab.tsx`(4), `app-frame/agent-select.tsx`(4), `desktop/lophn-space/settings/agents/agents-panel.tsx`(3), `workspace/ask-view.ts`의 `AskRole`, `workspace/contexts/*`. 문구 `en.ts` 18줄(`contexts.*` 11줄, `*.label.role-context-engineer` 4곳) | S4 11장 13, S8 2장, AGENT-ROLE | `packages/design/wording/en.ts`, 위 파일들 |
| Context 탭 머리·Glossary·Contract의 이름 문구 | "Kept up to date by Context Engineer", "Details for Context Engineer and the curious", "Context Engineer is drafting", 용어집 줄의 "by Context Engineer" → Project Manager | 위와 같음 | `en.ts` 996~1007, `contexts/context-glossary.tsx`, `context-glossary-model.ts`, `contract-details.tsx` |
| Context 탭 읽기 시점 | store 없이 하위 탭이 mount 때 읽고 `stamp`가 바뀌면 다시 읽는다 → 열 때 읽는다(주석과 배선 정리) | S1 8장 | `contexts/use-context-read.ts`, `context-frame.tsx`, `context-overview.tsx`, `context-violations.tsx`, `context-glossary.tsx`, `contract-details.tsx` |
| context 목록의 공급원 | `useContextWatch`가 읽은 목록이 Contexts 탭 카드, 팔레트, sidebar, 대화의 context 링크 이름, 탭 복원에 쓰인다 → store 층의 목록 | S1 8장 | `workspace.tsx` 573~577, 640, 722 |
| Contexts 탭 카드 | [New context]를 뺀 나머지(이름, 목적, 개체 종류 수, 적용된 판과 검사 결과, 위반 수, 쓰는 Operator 수, [Open])가 남는다. Operator 수 카드(`operatorCounts`)는 새 설계에 근거가 없다 | removed.md 1 | `contexts/contexts-tab.tsx` 170줄, `contexts-tab-load.ts`, `contexts-tab-rows.ts` |
| Search 탭이 context 하나에 묶임 | Search 탭 layout이 `context`를 필수로 갖고 context가 없으면 Contexts 탭이 대신 열린다 → project 하나의 키워드 검색은 context 없이도 열려야 한다 | req-0069, 1480, 0078 | `renderer/workspace/kinds/search.tsx` 79~106, `contexts/settle-tabs.ts` |
| 팔레트의 문서 묶음 | `documents.search` 결과를 문서 ID와 판으로 열고(Documents 화면 reader로 보냄), 작업대 안에서는 `DocumentRow`로 연다 → project 파일 경로로 연다 | removed.md 1 | `renderer/desktop/palette/search.ts` 24줄, `lophn-scope.ts` 81~89, `workspace-scope.ts` 100~150, `host.tsx` 33, `router.ts` 17 |
| 대화의 문서 결과 링크 | `(document, version)`으로 열고 작업대 밖에서는 Documents 화면을 연다 → 파일 경로로 연다 | 같음 | `renderer/conversation/result-links.tsx`, `renderer/desktop/main.tsx` 257~261, `workspace/kinds/host.ts` 82(`openResult(document, version)`) |
| 런처 project 카드·등록 dialog | 카드에 tracking 상태와 패턴·gitignore 줄·문서 수. 등록 dialog는 짧은 이름(slug)이 겹치지 않게 고른다 → tracking 줄을 빼고, slug가 문서 주소 이름 공간용이면 같이 뺀다. 폴더와 폴더 설명 입력은 남는다 | req-1473, removed.md 1 | `renderer/desktop/launcher/project-card.tsx` 24, 100~126, `launcher/model.ts` 9~13, `launcher/register-dialog.tsx`(`takenNames`, `shortNameOf`) |
| project 상세의 이름·tracking 표시 | slug 이름 칸(`validName`, "name-taken")과 tracking on/off 줄 → tracking 줄은 뺀다. slug 칸은 정해진 곳이 없다 | 같음 | `lophn-space/projects/project-detail.tsx` 124~135, 183~195 |
| 대화 composer의 context chip | chip이 context 하나(id와 label)를 가리킨다 → 위반 toast가 파일과 규칙을 붙이려면 chip이 그것을 실어야 한다(UI 새로 만들 것의 위반 chip과 한 묶음) | req-0085 | `renderer/conversation/composer/agent-composer.tsx` 47, 125, `renderer/workspace/kinds/agent.tsx` 32 |

## UI 새로 만들 것

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| 확장자별 viewer 선택 | 파일 확장자로 viewer를 고른다(md는 지금의 live preview 편집기, 그 밖은 아래) | req-1474 | `renderer/editor/document-view.tsx`가 md 전용으로 짜여 있어 고치기보다 viewer 선택 층을 앞에 새로 두는 쪽이 맞다 |
| text 파일 편집기(JSON, YAML, 코드) | 열고 고친다. CodeMirror 언어 팩이 `lang-markdown` 하나뿐이라 언어 지원을 새로 더한다 | req-1474 | `renderer/editor/`(CodeMirror는 이 폴더에만 둔다: `boundary_test.ts`) |
| 이미지 viewer | png, jpg를 열어 본다(읽기 전용) | req-1474 | 없음(grep 확인). 바이트를 renderer에 넘기는 통로가 필요하다(`ipc/editor.ts`는 8MB 글 전용) |
| pdf viewer | pdf를 열어 본다(읽기 전용) | req-1474 | 위와 같음 |
| project 밖 파일 열기 | 파일 선택(OS dialog나 팔레트 입력)으로 임의 경로를 문서 탭으로 연다 | req-1474, 1475(rejected) | 문서 탭 key가 경로가 되는 쪽과 한 묶음 |
| 검색 탭의 project 키워드 검색 | 검색어 입력, 폴더 하나로 좁히기, 결과를 경로 순·줄 순으로, 일치한 부분이 든 snippet, 결과를 눌러 그 줄에서 파일 열기 | req-1476~1480 | 지금 Search 탭은 context의 선언된 검색만 그린다(`renderer/workspace/contexts/search-tab*.tsx`). 키워드 검색 UI는 코드에 없다. 지운 요구(snippet redaction, 건너뛴 파일 알림, 50개 cursor)의 UI 흔적도 없다 |
| 문서 탭이 줄 번호로 열리는 길 | 검색 결과의 줄로 읽기 모드에서도 scroll한다 | req-1479 | 지금은 편집 모드의 `revealLine`(`markdown-editor.tsx`)뿐 |
| renderer event client·store 층·반응 층 | 연결 하나가 구독 조건을 합치고, store가 event로 상태를 고치고, 순수 함수 `event → 반응 목록`이 toast와 agent 부르기를 낸다 | S1 8장·12장 | 지금은 기능마다 따로다: `renderer/conversation/agent-core-source.ts`의 자체 구독, `workspace/contexts/context-watch.ts` polling, `desktop/notification-chip/*`. 한곳에 모인 event client는 없다. 위치는 code-map이 정한다 |
| 위반 chip | Project Manager 대화에 파일과 어긴 규칙이 붙은 채로 열린다. 사람이 글을 쓰지 않는다 | req-0083, 0085 | UI 고칠 것의 위반 toast·composer chip과 한 묶음 |
| sidebar의 saved view 목록 | project 화면에서 saved view 이름을 눌러 그 결과를 연다 | req-0082 | sidebar에는 saved view 줄이 없다. 접힌 rail의 "Saved views" 단추는 Search 탭만 연다(`contexts/shortcut-rail.tsx`, `workspace.tsx` 696~701) |
| 파일 정보 Info 탭 | 판이 빠진 Info 탭에 보일 파일 사실(경로, 형식 등) | req-0070 | 무엇을 보일지 정한 문서가 없다 |

## 문서끼리 어긋난 것

1. **위반 toast를 누르면 어디로 가는가가 문서마다 다르다.** `requirements/core-contexts.yaml` req-0020은 "그 toast를 누르면 그 context의 위반 목록이 열린다". shell req-0083은 "위반 toast에서 시작해 글을 쓰지 않고 Project Manager session을 열 수 있다". S1 8장 반응 표는 "누르면 그 위반을 붙여 그 project의 Project Manager를 부른다". 그런데 S1 5장은 `ContextViolationFound`가 Reactor를 거쳐 reaction grant가 열려 있으면 Project Manager 새 session을 이미 연다고 하고, AGENT-ROLE E5도 "program이 부르고 toast로 알린다"고 한다. Reactor가 session을 연 뒤 toast를 누르면 또 연다면 session이 둘이다. 정할 것: toast 누르기가 이미 열린 session으로 가는지, 위반 목록으로 가는지.
2. **pdf·docs 목차가 낡았음을 표시하는가.** docs-review "core-contexts"(2026-10-12 결정)는 "원본이 바뀌면 program이 파일 hash로 낡았다고 표시한다"고 했고, 이어 PRODUCT.md 3장·AGENT-ROLE C5·changes.md 4장은 "program은 감지하지 않고 계기는 사람의 요청"이다. req-0012 본문에는 낡음 이야기가 없다. 나중 쪽(감지 없음)을 따랐다.
3. **S4 4장 Project Manager의 쓰기 tool에 `context.create`와 archive가 없다.** ledger에는 `context.create`·`archive`·`unarchive`(`protocol/projects/context-api.ts:756-784`)가 있고, req-0004는 "한 project에 context를 둘 이상 둘 수 있다", AGENT-ROLE C1은 "context를 청하면 계약과 검색 script를 만들거나 고친다"이다. `context.draft`가 첫 판과 함께 context도 만드는지, 별도 create가 남는지 정해지지 않았다. 보관은 changes-by-topic 7장이 열린 질문으로 둔다.
4. **S4 4장 file tool 범위와 `context.draft` 폴더.** S8 2장은 Project Manager의 file tool 범위를 "그 project의 폴더"로 정하는데, S4 4장은 초안 판을 "새 판의 초안 폴더"에 file tool로 쓴다고 한다. 그 폴더가 lophn data의 context 아래라면 file tool 범위 밖이다. req-0012도 pdf 목차를 "lophn data의 그 context 아래"에 둔다고 한다.
5. **S4 3장 file tool의 "경로 검사는 req-1475와 같다"는 rejected 요구를 인용한다.** req-1475는 사람 문서 탭이 project 밖 파일을 열 수 있다는 이유로 폐기됐다. 폐기 이유는 사람 통로만 말한다. agent file tool이 place 밖을 거절하는 근거는 S4 자체이고, 요구에는 근거가 없다.
6. **changes-by-topic 4장 documents/contexts "index store"를 뺀다는 줄이 무엇을 가리키는지 알 수 없다.** 문서에 context 훑기 결과를 담는 `derived/contexts.sqlite`(`docs/architecture/documents.md:100`)가 따로 있고 코드도 `contexts/index/`(697줄)와 worker의 `context.index`가 그것이다. 이 줄이 outline-and-search의 목차 색인(removed.md의 "목차 색인")을 context 쪽에 잘못 적은 것인지, context의 `derived/contexts.sqlite`를 뺀다는 뜻인지 알 수 없다. 뒤라면 req-0018(결정적 위반 감지)과 req-0006(늘 지금 파일을 읽는다)을 파일 훑기 직접 계산으로 다시 짠다는 뜻이다. 어느 쪽 결정도 requirements에 없어서 코드는 그대로 두는 쪽으로 적었다.
7. **changes-by-topic 5장은 documents/series를 "그대로"라고 하고, changes.md 3장은 `packages/core/projects/series`를 지운다고 한다.** 실제로는 series registry(가족, draft, instance)가 지워지고 다음 이름 계산은 `contexts/series/next.ts`가 이미 따로 갖고 있다. "그대로"는 뒤의 계산만 뜻한다.
8. **docs-review projects 절의 코드 경로가 옛 위치다.** `packages/documents/addressing/`, `packages/contracts/documents/outline-markdown.ts`는 src layout 뒤 각각 `packages/core/projects/addressing/`, `packages/protocol/projects/outline-markdown.ts`다. 두 parser가 아직 갈라져 있다는 지적은 그대로 맞다(확인함).
9. **`handoff.ts`의 요청 글이 옛 tool 이름을 부른다.** `core/projects/contexts/handoff.ts`는 `context.read_contract`를 적는데 S4의 이름은 `context.get`이다. 같은 글에 "Do not edit the documents"가 있다.

10. **Context 탭 하위 화면.** event.md 8장은 Context 탭을 "도메인 모델, 위반 목록, 용어집"이라 하고, shell req-0077은 "위반 목록, saved view, 용어집", req-0075는 Overview와 별도 Contract 탭을 말한다. 코드는 Overview, Search, Violations, Glossary, Contract 다섯 하위 탭이다.
11. removed.md 1은 "새 탭 메뉴의 Agent 항목"을 지웠다고 하는데, 코드의 `renderer/workspace/kinds/agent.tsx` 주석은 "`+`에는 열기 항목을 두지 않는다"이고 `+` 메뉴에 있는 것은 Agents 관리 탭 항목(`kinds/agents.tsx` 83)이다. 무엇을 지운 것인지 불분명하다.
12. changes-by-topic 7장은 "context 보관"이 새 요구에도 지운 기록에도 없다고 한다. 코드는 보관된 context를 목록과 탭 복원에서 건너뛴다(`contexts/settle-tabs.ts`, `contexts-tab-load.ts`, `main/workspace/kinds/context.ts`).

## 다른 영역에 넘긴 것

- 영역 04(agent definition): tool registry 전체 개편, `FORBIDDEN_TOOL_NAMES`, role 상한 표(`agents/role-caps.ts`), `roles/context-engineer/` 폴더와 prompt, `commands/registry.ts`의 role built-in(`check-contracts`·`new-context`), 문서 tool의 `SaveToolDocument` 판정.
- 영역 08(place·session): Project Manager place 정의가 project 등록에서 생기는 길, `assignments/bootstrap.ts`의 `BUILTIN_ROLES`, `lophn-agent/assignments`.
- 영역 06(coding agent): `packages/coding-agent/cli/commands/{document,save,series,format,index,project}.ts`, `connection/document-save.ts`, `mcp-server`의 문서·save tool, `project.resolve_cwd`의 쓰임.
- 영역 05·07(apps): `cap-save`, `document.save` grant kind, 앱 등록의 place 이름 예약, 앱 preview의 documents adapter, blueprint "남길 문서".
- 영역 02·11(platform·process): `core/main/daemon/core.ts` 조립 정리(documents worker, 채널 다섯 개), process 종류 표(`protocol/supervision`), blob 목적 `document_file(s)`, `core/storage/blobs/child-prepare.ts`, `core/notifications`(보류 중인데 `ContextViolationsRecorded` 계기를 가진다), 의존 `quickjs-emscripten` 제거.
- 영역 12(sdk UI kit·design): 위반 toast 문구, `packages/design/wording`의 문서·context 문구. 문서와 context 화면의 wording key는 UI worker 목록에 있다.
- 영역 13(시험·fixture): 지운 폴더의 테스트 93개, `fixtures/projects/*` 가운데 남길 것, `e2e/flows/{write-series,first-project,build-context}_test.ts`, `e2e/shell/{save,read-edit}_test.ts`, `e2e/sdk/format-document`.
- 영역 01(event): `ContextViolationFound`를 domain event 10개 안에 넣는 일은 S1 쪽 항목이다. 여기서는 발생 지점만 적었다.
- shell 쪽 event·agent 영역: `renderer/desktop/notification-chip/ask-agent-toast.tsx`, `renderer/workspace/notice-ask.tsx`, `ask-view.ts`(`AskRole`의 `context_engineer`). S1 8장이 반응 층으로 모으라고 한 것들이다.
- `settings/agents`, `things-to-confirm`, `workspace/agents/*`의 Context Engineer 이름은 UI 고칠 것에 센 값에 들어 있고, 고치는 일은 agent 영역과 나눈다.
- `renderer/app-frame/app-detail/versions/`는 앱 release 판이라 이 영역이 아니다.

## 확인 못함

- `documents/worker` 계열 process 종류 이름이 `protocol/supervision`의 어느 표에 있는지(`supervision_test.ts:229`에서 `"documents"`만 확인). 제거할 때 감독 표와 launch spec 시험을 같이 고쳐야 한다.
- S1이 "있음"이라 한 Reactor의 지금 모양. `storage/ledger/reaction.ts`는 반응 멱등 key를 만드는 파일이고, 실제로 event에 반응하는 구독자는 `lophn-agent/assignments/reactions.ts`(`AppCreated`와 place 보관에만 반응)뿐이다. 위반 event에 반응하는 길은 지금 없다(영역 01).
- `first-project_test.ts`·`save_test.ts`·`read-edit_test.ts`에서 어느 갈래가 새 설계에서도 맞는지(전체 파일을 읽지 않았다).
- project의 `name`(slug)과 `title`을 둘 다 남길지.
- `core/lophn-agent/tool-judgment`가 `document.get`을 읽는 부분의 위치.
- 계약의 `docs`·`folder`·`section` kind가 `.gitignore`로 빠진 파일을 보는지(`contexts/worker/files.ts`는 `.git`만 건너뛴다).
- pdf 본문 추출 의존(라이브러리)이 어느 것인지. 없다는 것은 확인했다.
- (UI) core `files/watch`가 주는 `compared_version`과 `state`(`version_pending` 등)가 file-tracking 관측에서 오는지, tracking을 뺀 뒤 어떤 신호로 "밖에서 바뀜"을 알릴지.
- (UI) 만드는 중(drafting) context 화면(`contexts/context-drafting.tsx` 216줄, `context-drafting-model.ts` 47줄). [New context]를 지우면 같이 지울 수 있어 보이나 core-contexts에 drafting 상태 요구가 없어 근거가 없다.
- (UI) 새 Search 탭에서 키워드 검색과 context 검색(req-0017)을 한 화면에서 어떻게 나누는지.
- (UI) 이미지·pdf를 renderer에 넘기는 크기 한도와 통로.
- (UI) context 판 이력·되돌리기(req-0022)를 사람이 쓰는 화면. `rollback` command는 source에 있으나 화면에서 부르는 곳이 없고 [History] 단추는 [Ask]의 별칭이다.
- (UI) Contexts 탭의 "쓰는 Operator 수"를 새 설계가 유지하는지.
- (UI) 전역·앱 층 지침 편집(docs-review "확인할 것"). 새 요구는 project `LOPHN.md`와 agent 설정 화면(req-0095)만 말한다.
- (UI) 접힌 rail의 "Agent" 단추(lophn을 연다, `workspace.tsx` 698)와 `+` 메뉴 Agents 항목을 지울지. 문서 링크 `[[` 선택기를 파일 경로 링크로 유지할지.
- (UI) 시험 파일과 testdata는 따로 세지 않았다. wording 키 수는 `en.ts`를 정규식으로 센 근사값이다.
- UI worker가 grep으로 확인한 "이미 없음": Workspace의 Context 화면, perspective·reason·"Why it's here" 흔적, context export("Save as Markdown"), 객체 탭, 일반 조건 saved view, snippet redaction·건너뛴 파일 알림·50개씩 이어 보기 UI. "그대로 남는 것": Overview, Contract, Violations 목록의 읽기와 파일 열기, Glossary 추가·고침·지움, 검색 선언으로 그리는 입력·결과, 결과 page 이동, 보기 저장, 정보 패널 Contexts 탭, 문서 안 찾기, 읽기 폭.
