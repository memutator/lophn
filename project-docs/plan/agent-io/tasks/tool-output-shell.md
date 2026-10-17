# tool-output-shell

`shell.run`의 출력을 stream마다 24 KiB 근처(앞 12 KiB + 뒤 12 KiB)로 줄이고, 줄인 자리를 글로 표시한다. description의 "1 MiB per stream"을 맞춘다. process group(`setsid`) 방식은 그대로 둔다.

- 단위: tool-output (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/shell/run.ts`
  - `packages/core/lophn-agent/tools/shell/run_test.ts`(새로 만든다)
  - `packages/core/lophn-agent/tools/bundles/shell.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/agent-definition.md`의 "shell 출력이 stream마다 1 MiB라 model에 2 MiB까지 간다"(추천: 24 KiB 근처, 앞/뒤, `limitText` 재사용, description 맞추기, `setsid`는 남긴다)
  - architecture: `project-docs/architecture/agent-definition.md`("shell은 환경 변수 허용 목록만 넘긴다", "file tool은 place 폴더 안에 가둔다. 읽기·쓰기·shell은 Gate를 거치지 않는다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 본보기: `tools/result.ts`의 `limitText`(UTF-8·줄 경계에서만 자르고 24 KiB와 300줄 중 먼저 닿는 곳), `tools/bundles/skill.ts`(`limitText`와 `omitted_bytes`를 쓰는 모양)
  - test: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `tools/result.ts`의 `limitText(text, "head" | "tail")`, `TEXT_MAX_BYTES`(24 KiB)
  - 내놓는 것: `runShell`의 결과 `content` 칸 이름은 그대로(`exit_code`, `timed_out`, `stdout`, `stderr`, `stdout_truncated`, `stderr_truncated`). 칸을 읽는 곳은 `run.ts` 하나뿐임을 확인했다(`grep -rn "stdout_truncated" packages`). stream마다 출력이 한도를 넘으면 그 `*_truncated`가 true이고 `complete`가 false다.

## 지킬 것(계획 README "지켜야 할 것")

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- protocol을 바꾸면 쓰는 쪽(shell, coding agent CLI)을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- secret 값은 보호 메모리와 전송 직전 attach 밖으로 나가지 않는다(log, event, ledger, model 입력 금지).

## 할 일

근거: 이슈 "shell 출력이 stream마다 1 MiB라…". 지금 `collect`가 stdout·stderr를 각각 1 MiB까지 `content`에 그대로 실어 한 번에 2 MiB가 context로 간다. 다른 tool은 `result.ts`의 24 KiB 상한을 거치는데 shell만 안 거친다.

정한 것(코드를 보고 정했다. 바꾸려면 보고에 적는다):
- `limitText`는 앞 또는 뒤 한쪽만 남기고(`head` | `tail`) 상한(24 KiB·300줄)이 상수라 인자로 못 바꾼다. 그래서 "앞뒤"는 호출하는 쪽이 조립한다: 앞 12 KiB와 뒤 12 KiB를 따로 모아 앞 조각은 `limitText(…, "head")`, 뒤 조각은 `limitText(…, "tail")`로 거친 뒤 그 사이에 생략 표시를 끼운다. 합이 24 KiB 근처다. `limitText` 쪽(`result.ts`, 이 task 소유가 아니다)은 고치지 않는다.
- 뒤쪽이 가장 쓸모 있다(오류는 끝에 나온다). 그러므로 지금처럼 "앞 1 MiB를 모으고 나머지를 버리기"로 두면 안 된다. `collect`는 메모리를 키우지 않고 앞 12 KiB와 굴러가는 뒤 12 KiB, 전체 byte 수만 쥔다.
- process group 방식(`LAUNCH`, `killGroup`, `DRAIN_GRACE_MS`, 시간 초과)은 이유가 따로(시간 초과 때 자식까지 죽이기)라서 손대지 않는다.

1. `tools/shell/run.ts`: `OUTPUT_MAX_BYTES`를 `HEAD_BYTES = 12 * 1024`, `TAIL_BYTES = 12 * 1024`로 바꾼다. `collect(stream)`는 chunk마다 전체 byte 수를 세고, 앞 `HEAD_BYTES`를 채우고, 뒤 `TAIL_BYTES`만 굴려 쥔다. 전체가 `HEAD_BYTES + TAIL_BYTES` 이하면 둘을 이은 원문 그대로, 넘으면 `앞 + "\n[… N bytes omitted; redirect output to a file and read it with file.read …]\n" + 뒤`다(N = 전체 − 앞 − 뒤). `Collected`는 `{ text, truncated }` 모양을 지킨다.
2. 자른 자리가 멀티바이트 문자 한가운데면 디코딩이 교체 문자(U+FFFD)를 남긴다. `limitText`의 `cutBytes`처럼 자른 쪽 끝의 교체 문자를 버린다. 앞 조각은 끝, 뒤 조각은 앞을 본다.
3. 앞 조각과 뒤 조각을 각각 `limitText`(head, tail)에 한 번씩 거쳐 300줄 상한도 지킨다(조각이 12 KiB라 byte 상한은 닿지 않고 줄 상한만 일한다). `limitText`가 `complete: false`를 내면 `truncated`를 true로 한다.
4. `collect`를 `export`하고(test가 `ReadableStream`을 직접 먹인다. subprocess를 띄우지 않는다), 나머지(`runShell`의 흐름, `summary`, `complete` 계산)는 그대로 둔다.
5. `tools/bundles/shell.ts`의 `description`에서 "Output is capped at 1 MiB per stream."을 새 동작에 맞춘다. 예: "Output is capped at about 24 KiB per stream: the first and last 12 KiB are kept and the middle is omitted." 문장은 영어 고정 문장이다. 이 줄이 바뀌면 tool 정의 hash가 바뀌어 열린 session에 notice가 나가는 것은 정상이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "shell 출력은 stream마다 상한을 넘지 않고 앞뒤가 남으며 가운데 생략이 표시된다". `run_test.ts`에 하나. `collect`에 합성 `ReadableStream`(한도보다 큰 출력을 여러 chunk로)을 먹여 표로 본다: (a) 한도 이하면 원문 그대로이고 `truncated`가 false, (b) 큰 출력이면 byte 길이가 한도 + 생략 표시 안이고 첫 줄과 마지막 줄이 남고 `truncated`가 true, (c) 멀티바이트 문자가 자르는 자리에 걸려도 U+FFFD가 없다. 새 subprocess·서버 test는 쓰지 않는다(`runShell`은 부르지 않는다).
- 남지 않음: `grep -rn "1 MiB per stream\|OUTPUT_MAX_BYTES" packages tools`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 위에서 정한 것을 바꿨으면 이유와 함께
- 넘길 줄
- 계약 바꾸기 요청: `limitText`를 앞뒤 모두 남기게 하려면 `tools/result.ts`를 고쳐야 한다. 그렇게 하자고 하면 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
