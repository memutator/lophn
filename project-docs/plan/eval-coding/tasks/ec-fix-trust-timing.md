# ec-fix-trust-timing

driver가 folder trust 화면에 너무 일찍 키를 넣어, 화면이 다시 그려지며 선택이 "No, exit"로 돌아간 뒤 Enter가 들어가 Claude Code가 끝난다. calendar-mvp 진짜 run에서 session 셋이 모두 열린 지 1.1초 만에 `exit 1`로 끝났다. 화면 기록(`tail`, 제어 문자를 뺀 글): `❯No,exit|Yes,Itrustthisfolder|...| No, exit❯Yes, I trust this folder|||❯No, exit Yes, I trust this folder|||`. 아래 화살표로 Yes에 갔다가, 다시 그려진 화면에서 No로 돌아갔다.

- 단위: ec-fix-trust-timing (wave 6)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/coding/driver/**`
- 읽을 것: `tests/eval/coding/driver/driver.ts`(`answerTrust`, `tailOf`), `trust.ts`, `trust_test.ts`
- 계약: `CodingTrace`(고정).

## 할 일

1. trust 화면이 보인 뒤 화면 출력이 잠시(예: 1초) 멈춘 다음에 키를 넣는다. 결정적인 조건으로 한다(출력이 그 시간 동안 늘지 않았나).
2. 아래 화살표를 넣은 뒤, 가장 최근에 그려진 선택 줄에서 커서(`❯`)가 "Yes, I trust this folder"에 있는지 화면으로 확인하고 그때만 Enter를 넣는다. 아니면 다시 기다렸다 같은 확인을 한다(제한 시간 안에서). "No, exit"에 커서가 있을 때는 절대 Enter를 넣지 않는다.
3. "가장 최근 선택 줄에서 커서가 어디인가"를 순수 함수로 두고 test 하나를 둔다(위 실제 화면 글: 마지막 그림은 No). driver가 No에서 Enter를 넣으면 Claude Code가 끝난다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 위 순수 함수 test.
- 진짜 Claude Code는 띄우지 않는다. lead가 진짜 run으로 확인한다.

## 보고

- 바꾼 file, 통과한 check
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
