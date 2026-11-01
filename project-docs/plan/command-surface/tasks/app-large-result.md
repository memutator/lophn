# app-large-result

화면 operation의 결과를 control frame 한도(약 254 KiB)에 묶지 않고 shell 한도(8 MiB)까지 받는다. 바깥 명령은 지금 한도를 둔다.

- 단위: apps (wave 2)
- 선행: app-layers. 새 선언과 호출 대상 모양을 쓴다.
- 소유(이 task만 고친다):
  - `packages/core/apps/runtime/**`
  - `packages/core/apps/calls/**`
  - `packages/core/main/app-supervisor/**`
  - `packages/shell/main/app-frame/**`
  - `packages/protocol/apps/calls/**`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`의 "정한 것" 11, 12
  - architecture: `project-docs/architecture/app-call.md`("호출 입력과 응답은 supervisor control frame 하나씩", rewind apply의 bytes frame)
  - 본보기: rewind apply가 json 요청 뒤 같은 channel의 bytes frame과 `end`로 큰 본문을 보내는 길(`packages/core/apps/runtime/supervisor-link.ts`, `packages/core/apps/runtime/entrypoint/apply.ts`, `APPLY_BODY_MAX_BYTES`)
- 계약:
  - 쓰는 것: app-layers의 호출 대상(operation, command)

## 할 일

1. operation 호출의 응답(결과와 changeset)이 control frame 하나를 넘으면 apply의 반대 방향으로 bytes frame과 `end`로 받는다. 한도는 shell main의 `CALL_RESULT_MAX_BYTES`(8 MiB)와 같게 둔다. 그 값은 한 곳에서 정한다.
2. 바깥 명령의 결과 한도는 지금 `RESULT_MAX_BYTES` 그대로다.
3. 보내다 끊기거나 기한이 지나면 지금처럼 결과 모름(unknown)이다. write의 changeset이 빠지면 rewind를 막는 규칙도 그대로다.
4. `packages/core/main/daemon/wiring/apps.ts`를 고쳐야 하면 고치지 말고 등록할 것에 적는다.

## 끝남

- `npm run check:full`이 통과하고 `boot.sh`가 두 번 `exit 0`이다.
- 위험 test: "256 KiB를 넘는 operation 결과가 core를 지나 화면 쪽 호출자에게 그대로 온다. 같은 크기의 command 결과는 지금처럼 실패한다"
- 위험 test: "큰 결과를 받다 끊긴 write는 결과 모름으로 닫히고 changeset이 없어 rewind 범위를 막는다"(지금 같은 test가 있으면 그것을 넓힌다)

## 보고

- 바꾼 file, 통과한 check
- 등록할 것
- 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
