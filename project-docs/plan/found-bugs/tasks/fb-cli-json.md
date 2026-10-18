# fb-cli-json

데스크톱의 `childCliRunner`가 `lophn ... --json`의 성공 출력을 `data` 칸에서 찾는다. CLI는 성공하면 data를 감싸지 않고 그대로 찍으므로 결과가 늘 `undefined`가 되고, harness 감지가 "Detection gave an unknown result."로 끝난다. 성공 출력을 그대로 data로 받게 고친다.

- 단위: fb-cli-json (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/coding-connection.ts`
  - `packages/shell/main/desktop/coding-connection_test.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/shell.md`의 "데스크톱이 CLI의 `--json` 결과를 `data` 칸에서 찾아 harness 감지가 늘 실패한다"
  - CLI 출력: `packages/coding-agent/cli/output.ts`의 `result`(성공은 `JSON.stringify(data)` 한 줄)와 `failure`(`{ error: { code, message, details? } }`)
  - architecture: `project-docs/architecture/coding-agent.md`("제품 감지는 shell main이 CLI를 exec해서 한다", "skill과 hook은 … 사람에게 묻는다")
- 계약:
  - 쓰는 것: `childCliRunner(options)`의 `exec?: ExecFile`(test가 주입한다), `CliRun`
  - 내놓는 것: 바뀌는 계약 없음. `CliRun`의 꼴은 그대로다

## 할 일

1. `childCliRunner`에서 stdout을 JSON으로 읽은 뒤:
   - 값이 `{ error: { code, message } }` 꼴(문자열 `code`와 `message`가 있는 `error` 하나)이면 지금처럼 실패로 돌려준다.
   - 아니면 그 값 전체를 `data`로 성공을 돌려준다.
   - `CliRun` 위 주석(`` `lophn <args> --json`의 `data` ``)을 실제 꼴에 맞게 고친다.
2. `coding-connection_test.ts`를 만든다. `exec`를 가짜로 넣는다.
   - stdout이 `[{"id":"claude"}]`면 `{ ok: true, data: [...] }`다.
   - stdout이 `{"error":{"code":"invalid_input","message":"x"}}`면 `{ ok: false, message: "x" }`다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "`lophn --json`의 성공 출력은 그대로 data가 되고 `{error}` 출력은 실패가 된다." 이것이 틀리면 데스크톱에서 harness 감지와 설치가 늘 실패해 App Engineer가 coding agent에게 맡기지 못한다.
- 손 확인: 데스크톱 개발 실행(`deno task dev`)의 Settings에서 harness 감지가 unknown이 아니라 설치된 harness를 보이는지 본다. 못 보면 보고에 적는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
