# ec-fix-trust

eval driver가 Claude Code의 folder trust 화면을 보면 "Yes, I trust this folder"를 대신 고르고 `CodingTrace.trust_answered`에 남긴다. 첫 진짜 run에서 trial 폴더(앱 source, 자기 `.git`)마다 trust 화면이 떠 터미널이 2분 뒤 `no_session_start`로 끊겼다. 상위 폴더 trust는 이어지지 않았다.

- 단위: ec-fix-trust (wave 5)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/coding/driver/**`
- 읽을 것:
  - 이슈: `project-docs/issues/coding-agent.md`의 절 "Claude Code가 coding session마다 folder trust를 묻는다"(정한 것)
  - `tests/eval/coding/driver/driver.ts`(`watch`, `tailOf`, `startSeen`, `noSessionStartMs`), `focus.ts`(사람이 `--write`로 붙어 있으면 driver 입력이 기다린다), `host.ts`
  - `tests/eval/types.ts`의 `CodingTrace.trust_answered`(lead가 더했다. `false`로 시작한다)
  - 실제 화면(첫 run의 `tail`, 제어 문자를 뺀 글): `Accessing workspace: <cwd> ... Quick safety check: Is this a project you created or one you trust? ... ❯ 1. No, exit / 2. Yes, I trust this folder ... Enter to confirm · Esc to cancel`. 기본 선택은 "No, exit"다.
- 계약:
  - 쓰는 것: `CodingTrace`(고정). `trust_answered` 칸만 채운다.
  - 내놓는 것: 없음(driver 안의 동작).

## 할 일

1. session이 열린 뒤 `startSeen`(SessionStart hook)이 오기 전에, 화면 글(snapshot)에 "Yes, I trust this folder"가 보이면 그 선택지로 옮겨 Enter를 넣는다(번호 키 `2`나 아래 화살표 뒤 Enter. 실제 Claude Code 2.1.302가 받는 키를 쓴다). session마다 한 번만 한다. 넣은 뒤 `trust_answered = true`이고 log에 한 줄 찍는다.
2. 사람이 `--write`로 붙어 있으면 focus gate 규칙 그대로 기다린다(사람이 먼저 고를 수 있다).
3. 이 화면을 보는 동안의 시간도 `noSessionStartMs` 안이다. 답한 뒤에도 SessionStart가 안 오면 지금처럼 끊는다.
4. 화면 글에서 선택지를 찾는 부분은 순수 함수로 두고 test 하나를 둔다(아래).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "trust 화면 글이면 넣을 키를 내고, 다른 화면이면 아무것도 내지 않는다"(순수 함수, 위 실제 화면 글과 평범한 Claude Code 입력 화면 글 둘). driver가 엉뚱한 화면에 Enter를 넣으면 사람 권한 물음에 답해 버린다.
- 진짜 Claude Code는 띄우지 않는다. 확인은 lead가 진짜 run에서 한다.

## 보고

- 바꾼 file
- 통과한 check
- 정한 것(넣은 키와 이유)
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
