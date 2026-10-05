---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---

# roster (session 3)
contracts af3c1f4e00e6179c9 | platform a346846bbc81fe225 | shell a107f31be59407c36
documents a6ec8c13d942d0ccf | problems af1ddd1492d8bda94 | lophn-agent aa9ec6da9bc126e85
apps: none (spawn when T1/T2 unblocked: platform T9, contracts T33) | coding-agent: none (T9 deps)
quota: contracts 2, platform 4, shell 2, documents 2, problems 2, lophn-agent 1

## 2026-10-04 rate-limit 대비 snapshot (lead)
- main a3046e8. 이번 구간 병합: #58(125d31d, lead), #59(f38861c, lead), #60, #61, #57, #44(a3046e8, lead).
- 사람이 /permissions로 Bash(gh pr merge *) 추가. 팀원들은 이전 거절 때문에 merge 안 함 → 준비(최신 main 반영, full check, review 기록)만 해서 head hash 보내면 lead가 `gh pr merge N --squash --match-head-commit <sha>` 후 원격 branch 삭제.
- 활성 팀원: contracts af3c1f4e00e6179c9, platform a346846bbc81fe225, shell a107f31be59407c36, documents a6ec8c13d942d0ccf, apps affaa080d055bb064(신규, 몫 2). problems·lophn-agent 종료(대기).
- platform 다음: T60 PR → T59 harness PR (lead가 병합). T4 local f9ac9a3.
- contracts: apps용 checker follow-up(contracts-blueprint-portability) → T39.
- apps: T2 테스트 보강 중, checker follow-up 병합 뒤 T2 PR. T3 결정: recursive dir 직접 grant 허용 + R25 한계, escape link deny, protected link면 전체 거절, protected deny 항상, unscoped/run/ffi 동반 금지, symlink 생성 NotCapable 회귀.
- documents: T3 pure format extraction 진행, T7 WIP(Q12+T59 대기).
- problems: T7 WIP 8925a55 pushed (problems-tests/ledger). T59 병합되면 재spawn. T5는 contracts T39 대기.
- lophn-agent: T1 = platform T5, T9 대기. coding-agent: T9 deps 대기.
- 모든 팀원에 WIP commit+push+handoff 지시함.
- documents handoff: T7 documents-projects/ledger 82efe25 pushed (Q12 + T59 대기, 이후 merge로만 갱신). T3 documents-formats/extraction a3046e8 pushed, 소스 미착수(선행 충족, 결정 대기 없음).
- platform handoff: T60 PR #62 (platform-ledger/immutable-keys 0f64464) → main a3046e8 merge·full check 후 lead 병합. T59 platform-ledger/testing 9ca0f52 (PR 없음, T60 뒤). T4 platform-ledger/events 00e73b4 (PR 없음, T60→T59 뒤). 모두 pushed.
- apps handoff: T2 apps-blueprint/sdk-definition ca108d8 pushed. 다음: typed helper/compile 테스트 보강 → contracts checker 병합 뒤 main merge·full check·PR. T3 미착수(T2 뒤). limit key: permissions.limit.symlink-changes. probe 파일은 scratchpad apps-permission-*.ts.
- 429로 apps·shell·platform 팀원 종료. lead가 보존: shell T34 shell-design/charts WIP 75133ff pushed (handoff 없음; T11은 #61 병합됨, T34 SDK review 보정 중이었음). platform T60 immutable-keys fcbe4cb(main a3046e8 merge 포함, full check 결과 미확인) pushed. contracts 팀원은 아직 살아 있음(contracts-problems-reporting 20 dirty, blueprint-portability 2 unpushed).

## 2026-10-04 respawn (Opus 5.5 members, workers grok 7 : space-bunny 3) main 83399ef
platform a0e6081afdccaec07 (4) | contracts a8c051ce7d09b4848 (3) | apps a3fdb201904505871 (3) | documents a92c2121944a497ee (3) | shell afd10ac1a5ba7d319 (2)
problems/lophn-agent/coding-agent 비활성. common handoff: scratchpad/common.md
- problems 재spawn a2dccad802f01f85a (2). shell 종료(T34 PR #64 병합 사용자 승인 대기 head 8e7203b). T59 #65 eec49d1.
- #66 e4aeb3f, #64 4930450 lead 병합(사람이 병합 판단을 lead에 위임). #68 T4 1db8bec.
- #73 apps T3 996c4e7 lead 병합. apps 팀원 종료(남은 작업 T1: platform T9, documents T5 대기). shell 종료(T3: platform T9 대기). contracts T10: platform T9, shell T3, shell T9 대기.
- platform 재spawn a318cb4f2cee557ce (사용자 실수로 이전 member 중단).
- #75 contracts T19 e39c23e, #76 problems T7 ff9f620 lead 병합. problems 종료(T5/T2: contracts T39 대기, T2는 platform T14도). platform authorize domain targets gap → platform.
- #79 documents T7 1d1de7a, #78 platform T6 428c9ea. platform T9 시작. coding-agent spawn a53d9d17a3e72ca32 (2) T9 connection core.
- #87 94c7cec, #90 d6ad677 documents lead 병합. #86 coding-agent T9 72a1380 (확인: #87 check가 #86/#88/#89 포함 1395/0). documents·coding-agent 팀원 종료(대기: documents T2·T6 → platform T9·T14, coding-agent T10 → contracts T48·platform T9). contracts #82 #84 #88 병합, lophn-agent 선행 일부 풀림.
- contracts #67 T39 b444fc1, #93, #94(T48). problems 재spawn a40c355a2572ad77f (2) T5.
- D32 screenshot redaction 삭제 PR #100 976cdf8 (platform T37 취소).
- contracts #105 T38 aca9e39. apps 재spawn a2a0f490c52922714 (3) T7. #103 documents Q13 f66f9f3, #106 D32 후속.

## 2026-10-05 구조 변경: team member 없음, lead가 worker 직접 (main a4fa088)
기본 worker glm-flash-max / hive-flash-max, 어려운 것 grok-4-7-xhigh. 공통 brief: scratchpad/worker-common.md + docs/dev/team-brief.md(worker 지침).
진행 중 worker:
- grok afea4846b4f8221a8: platform T9 #111 마무리(platform-core-entry)
- hive a01fdba30d7c806c9: contracts T49 #110
- glm a6a4758133506c04f: contracts T41 tickets
- glm a45f56fecb807808e: contracts T35 invocation
- hive ab5275c6d15d706af: contracts T37 grants
- glm a32fdc2e4a04cf332: contracts T46 coverage gate
- hive adc07a5e1fbc13e43: platform T31 app credential
- glm a1778bcc345dfd672: shell launch bugs (cjs, preload path, overlay destroyed)
- grok adb27742795891b7c: apps T7 + contracts test-mode gaps
T9 병합되면: apps T1, shell T3, lophn-agent T1, coding-agent T10, documents T2 등.
- 병합: #113 contracts T41 fb209c4, #111 platform T9 0659240 (lead).
- wave2 worker: glm a5447b4b265562f22 apps T1 | hive a317e6ca36d79ce04 coding-agent T10 | glm ae5afe89563c87eed contracts T42 | hive a38bf680a0f5127fd contracts T44 | glm a56556731935e992d documents T2 | grok aadea98340bf92e84 lophn-agent T1 | hive aa1d72c334e9a5136 platform T10 | grok a31c992e40e5cef32 platform T56 | glm aee20b2306dd41b47 platform T25 | grok a95ec003db1782685 shell T3
- 대기 ready: platform T11, T12, T13, T24, T28
- #115 contracts T46 coverage gate: 보류. T35·T42·T44 병합 뒤, T36(release contract, 아직 미착수) 4개 route·event는 T36 작업 줄을 가리키는 명시적 pending 목록으로 넣고 병합. head 1b4cc47.
- #112 contracts test-mode d5488e6, #114 apps T7 c7f555a (lead 병합, 서명 canonical JSON). grok a14c6bc847e735525 apps T8 supervisor. hive aec8d65eb2c5ec8ed platform T13.
- #116 shell launch fixes 48d7563, #117 platform T56 bd19add (lead 병합). PR #118 apps T8 → hive review a2f8f57781d102ad7. PR #119 shell T3 → glm review acdb797c68546d27c. #115 보류.
- #120 lophn-agent T1 5a4cfb6, #110 contracts T49 5ecec72 (lead 병합). wave3: glm a335d8252a6ece22f lophn-agent T3 | hive a01e91d9e2c0981f7 lophn-agent T17 | grok affa85962eae0d263 platform T24 | glm aab0bbf60e443829f platform T28. 대기 ready: platform T11, T12.
- #121 contracts T35 79e7ae3, #122 platform T25 ff7d224 (lead가 secret 패턴 하나로).
- #123 contracts T42 fd7d8da, #124 platform T28 9f4ce12 (lead 병합).
- wave4: glm ae6f1cecdc2d51fee contracts T36 | glm a0f3bbea031a5a722 contracts T43 | glm a4241811fa0a0f94b lophn-agent T4 | hive a04b68eca8b2b5e30 platform T26.
- hive 전부 중지(9 작업 + #118 review, worktree에 아무것도 안 남김) → glm으로 재시작: T37 a42545fd338affcde, platform T31 a706a79b6ed11a72a, coding-agent T10 aca49e7854a85e032, contracts T44 a8f36f24a9153eaf3, platform T10 a286d681bd3b930f5, T13 aebcf15b071a617f2, lophn-agent T17 aa8f971ea49871401, platform T11 aa011c5d52b6b9d0e, T26 a0c6ee129e3a189b6, review #118 ad9fa63139ea04d70. team.md 기본 worker = glm만.
- #119 shell T3: glm review blocker 3(PATH env, child error, WS 인증/OPEN 전 send) → grok a95ec003db1782685에 수정 요청(ws header client, contract 변경 없음).
- #125 documents T2 b4bb3b6 (진행 표시: core dispatch·감독 seam, scan·hash 제출은 T11, preview route 연결 남음).
- xai 로그인 만료로 grok worker 2개 실패(shell T3 수정, platform T24). WIP 보존 후 glm 이관: shell T3 수정 ac944ff4bd266a49d, platform T24 마무리 ab4fbf9cd12f9e3eb. 사람에게 ocx login xai 요청.
- #126 contracts T43 8f415e9. xai 로그인 갱신됨(사람). grok a5b020d5a0c531c37 documents T2 core seams 마무리.
- #127 platform T10 7099c5a. #118 apps T8 review(glm): blocker 2(record compare 400, verifyKey snapshot) 등 → grok a14c6bc847e735525에 수정 요청. lead 결정: record_* 는 base_revision CAS 빼고 관측 식별(app, release, nonce·시작 시각, 종류)로.
- #128 documents T2 완료 4a3c6d8. glm ade1bb8b6b456a8b7 documents T4 남은 것(format-runner kind, /v1/formats route; blob은 platform T14 대기). documents T10 나머지는 T11 대기.
- #129 lophn-agent T17. 후속: defuseBoundaryMarkers가 platform/security와 lophn-agent/safety에 중복 → packages/base로 올리기.
- #118 apps T8 6dae58e (lead 병합). #130 platform T24 grok review blocker 2(port 없으면 gate 통과, 일회 예약 휘발) → 같은 grok a7a9be1a789a3cc21에 수정 요청(fail closed, ledger 표로 영속).
- #131 platform T26 0d96591.
- #132 contracts T44.
- #134 contracts T36 7a12a30 (coverage 빠짐 0 → #115 병합 가능). #133 platform T13: quota statfs가 I/O worker에 sys 권한 필요 → glm aebcf15b071a617f2에 최소 sys 권한 추가 요청.
- #115 contracts T46 coverage gate 병합.
- #135 contracts T37 984d5f1 (lead가 registry·mod 충돌 해결), #130 platform T24 59e3f05. #136 T31·#137 T12 → grok review a685f9212a599b4f7.
- #133 platform T13 d9baf92 (statfs sys), #119 shell T3 3f8f0b6 (실제 core 통합 테스트). lophn-agent T3 worker가 main checkout 오염 → 되돌림·경고.
- #138 platform T11 a628638, #139 coding-agent T10 893bfc2. 발견: core가 startApiServer에 RouteRegistry를 안 넘겨 팀 route가 HTTP에 안 닿음 → grok 작업. #136·#137 review blocker → glm 원작자 수정 중.
- #140 shell T51 6d8005e. 사고: lophn-agent T3 worker가 실제 ~/.lophn(이전 lophn 데이터)에 새 core를 띄움(03:52) → schema 적용 실패로 끝남, DB 표는 이전 것만(read-only 확인), run/instance.lock 빈 파일만 남음. worker-common에 데이터 root 금지 규칙 추가. T3 남은 것: dev seed는 contracts T9로 이관, core.ts RouteRegistry는 grok core-routes와 겹침.
- 병합: #141 shell T9 1043f66, #142 core route registry b7a0122, #143 apps T1 0e711c4, #144 shell T33 9cf7b71, #136 platform T31 3a79a3c, #137 platform T12. #145 shell T22 수정 요청(tsc 실패, 테스트 미실행).
- wave6: glm a58f9387f024c44e5 lophn-agent T3 마무리 | glm a203b10488d302872 apps T11 | glm a20710a7e8f727a6a coding-agent T11 | glm ab9a0f596002e9735 coding-agent T12 | glm abfb3a4658ca88186 platform T55. 실행 중 shell 창(temp LOPHN_HOME /tmp/tmp.WqJSXOXJXa, debug port 9334) 띄워 둠.
- 병합: #146 shell T13, #147 contracts T9 dev, #148 platform T57, #145 shell T22, #149 platform T40.
- wave7: grok a396ebc64d6efabd0 contracts T10 E2E | glm ac500845e9e8f7b00 platform T43 | grok a5f5f7e9208c1b4a2 shell T23 | grok af0f937d0a8a8b0ba shell T24. main da2da55.
- #150 platform T14 grok → 수정 요청(notePrepared harness 전용·제품 경로 끊김, core가 blob 직접 읽음 → I/O worker blob.read).
- #151 contracts T50 b6ace90.
- #152 contracts T10 E2E harness (deno task e2e). contracts 51/51 완료.
- 병합: #155 lophn-agent T3 d4a3665(주의: check test 실패 상태로 병합됨 — e2e skeleton이 check에 섞여 Electron 없는 worktree에서 실패) → #158 e2e를 LOPHN_E2E로 분리해 main 복구. #157 platform T55, #156 documents T4(진행), #153 platform T27(진행, R29는 lophn-agent question option 쪽). #150 T14: main 충돌(io.ts settings op, registration ApiRead) → grok 해결 중. merge.sh는 check exit code로만 병합. T23 worker가 main에 상태 줄 1커밋 직접 push(8c75b74) — PR #154 병합 전까지 계획만 앞섬.
- 병합: #150 platform T14 5de7613, #161 apps T11 eb180cd. #159 lophn-agent T4 main 충돌 → glm 해결 중. #160 shell T24: Electron main에서 process.execPath spawn으로 두 번째 Electron 뜨는 blocker → grok 수정 중. 후속: apps invocations의 로컬 redaction → platform redaction port로.
- wave8: glm a87880454d4184873 apps T5 | grok a5d9644782ed7fe12 documents T6 | glm a30ac668218366887 documents T4 module blob | glm ad692280493821cd3 problems T2 | glm a79dc3e6e154fbe39 platform T17 | grok afa5e7dea216dbdea platform T21 | glm acecd65e1be15524d platform T41.
- #160 shell T24 3889bff(진행), #162 platform T43 8601a16(진행), #163 coding-agent T11. 주의: MCP discovery 43KB로 R4 2,000 token 목표 초과 → schema 축소 후속 필요.
- #164 documents T6 4bfa2cd. wave9: glm a9ce4d39ee55d1c4a documents T9 | grok a3681791c06990d59 shell T14 | glm ac61d1b544a0ed6a9 MCP schema 축소.
- 규칙(사람 지시): UI·화면·design component 작업은 전부 opus(general-purpose, model opus). team.md엔 안 적음.
- grok 크레딧 소진(xai 403 spending-limit). 어려운 작업은 사람 결정 전까지 glm + grok 대신 glm 리뷰 2회로.
- 사람 결정: grok 대신 glm + 리뷰 2회(옵션 2). 어려운 작업도 glm-flash-max, 보안·삭제·권한 작업은 독립 glm 리뷰 2명.
- 사람 정정: 리뷰 2회 필요 없음. glm 리뷰 1회로 충분.
