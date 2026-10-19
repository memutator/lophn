# call-list-without-session: 해석

experimenter: claude-opus-5-5(lead session). 사실은 `run.md`.

## 판정

`reject: target 1/2 ok, case 0/2 ok, guard 5/13 ok` (`default@1`, 섞인 변경 core@6→@7)

## 해석

- 가설의 반은 맞았다. 목록 빈틈이 call 0개의 원인이던 곳은 O4다. 고친 목록에 `App Engineer 가계부 (app 가계부)`가 실리자 Operator는 세 trial 모두 그 App Engineer에게 `reply:"none"` call을 보냈다(기준 0/1 → 3/3). 3번까지 늘어 우연은 아니다.
- 나머지 셋은 다른 이유로 떨어졌다.
  - A14-other: App Engineer(가계부)의 목록에 `lophn`만 있고 `App Engineer 할일`이 없다. 후보를 모으는 `appList`가 App Engineer 자격에서는 자기 앱만 돌려주는 것으로 보인다(worker가 "확인 못 함"으로 남긴 점). 그래서 할일 App Engineer 대신 lophn에게 call했다.
  - C9-other: 목록에 `Project Manager hr (project hr)`이 실렸는데 tool을 하나도 부르지 않았다.
  - A12: 목록에 `lophn`이 실렸는데 call하지 않고 `file.read`, `package.list`, `file.grep`만 불렀다.
- 그러니 "목록에 없어서"가 맞는 것은 O4뿐이고, A14-other는 고침이 덜 됐고(제품), C9-other와 A12는 목록이 보여도 넘기지 않는다(model 선택 또는 지침).
- guard는 ok 5, incomplete 8이고 worse는 없다. incomplete는 판정 때 채점이 대기였던 것이다. 판정 뒤 넣은 채점으로 보면 A1-ask, C8, L1, L4-app, L5, L8은 기준과 같이 통과했고, O6는 기준 `some_missing`에서 `all`로, L4-new는 1/2에서 2/3으로 흔들림 안에 있다. 이 고침으로 나빠진 guard는 보이지 않는다.
- 섞인 변경(core@7)은 agent가 자기 grant를 읽게 연 것뿐이고 목록을 만드는 데만 쓰인다. 판정을 섞이게 했지만 결과를 다르게 읽을 이유는 아니다.
- 미리 쓴 case(C9-other, A12)는 "다른 주인에게 넘긴다"는 같은 규칙을 다른 role에서 본다. 목록이 원인이라는 가설은 이 둘에서 맞지 않았다.

## 떨어진 것과 원인

| 시나리오·check | run·trial | 원인 | 근거 |
|---|---|---|---|
| A14-other `call-to-todo-ae` | `run_01m5983ysdqsp56pwmnh745040` t0 | 제품 | system의 "Agents you can call"에 `lophn lophn`만 있다. tool은 `call` 하나(lophn에게) |
| C9-other `call-to-hr-pm` | `run_01m5983yse5w4he31ag1a6j0z9` t0 | model | 목록에 `Project Manager hr (project hr)`이 있고 tool 호출 0개 |
| A12 `call-to-lophn` | `run_01m5983yse5w4he31ag1a6j0z8` t0 | model | 목록에 `lophn lophn`이 있고 tool은 `file.read`, `package.list`, `file.grep` |
| L7 `read-all` | 기준 두 run, variant t0 | judge(grader) | `app.list`로 읽었는데 check가 `app.get` 이름만 받는다(`project-docs/issues/eval.md`) |
| T19-op `call-blocked` | 기준과 variant | 제품(world) | 막힌 call이 생기지 않는다(`project-docs/issues/eval.md`) |

## 의심스러운 judge 판단

- O4 `relays-request`(`relay-complete@1`), `run_01m5983yse5w4he31ag1a6j0z7` t0·t1·t2: 셋 다 `some_missing`, 인용 `이번 달 합계를 구해 줘`. call 본문은 버그를 App Engineer에게 넘기고 합계는 Operator가 고친 뒤 다시 구한다고 했다(t0 "수정되면 이번 달 합계를 다시 구하겠습니다"). 합계를 구하는 일은 넘길 일이 아닌데 criterion이 사람 말의 모든 요구를 call 본문에 요구해서 떨어진 것이다. criterion이 이 case에 맞는지 사람이 볼 것.
- L4-new `relays-request`, `run_01m5983yse5w4he31ag1a6j0ze` t2: `some_missing`, 인용 `잘못된 날짜 입력은 거부하세요.`는 사람 말이 아니라 call 본문의 줄이다. criterion은 some_missing이면 잃은 사람 말을 인용하라고 한다. 인용이 입력 안에 있어 program은 받았다.

## 경고와 진단

없음. 바꾼 것이 코드(runtime)라 시나리오 고유 단어 경고는 내용을 못 봤다(`[warn] 내용을 못 봐서 경고를 못 낸다`).

## 다음

- 고칠 것(제안):
  - App Engineer 자격의 `appList`가 다른 앱을 돌려주게 하거나, 목록 후보를 자격과 상관없이 모으는 길(core 쪽 read). A14-other가 이것을 본다. `packages/core/agent-roles/place/place-data.ts`, `packages/core/agent-roles/credentials.ts`.
  - 목록이 보여도 넘기지 않는 C9-other(Project Manager), A12(App Engineer)는 그 role 지침의 넘기기 줄을 본다. 고치기 전에 같은 규칙의 다른 요청 case를 먼저 쓴다.
  - variant의 `deno-dir` symlink(`tests/eval/experiment/variant/prepare.ts`), L7 check, T19-op 시나리오: `project-docs/issues/eval.md`.
- 더 돌릴 것: 위 고침마다 새 spec. 이 variant(`exp/call-list`)는 O4를 고치므로 다음 spec의 출발점으로 쓸 수 있다.
- 다음 spec 초안: 없음(위 고침의 크기를 planner와 사람이 먼저 정한다).

## 판정 이의

판정은 그대로 `reject`다. 사람이 판정과 따로 variant 고침을 main에 넣기로 정했다(사람). 근거: target O4가 0/1에서 3/3이 됐고 guard 가운데 나빠진 것이 없으며, 떨어진 셋은 고치기 전에도 떨어졌고 더 나빠지지 않았다. 목록이 session 없는 상대를 싣는 것은 제품으로도 맞는 동작이다. 그래서 다음 experiment의 기준은 runtime@3·core@7이다.
