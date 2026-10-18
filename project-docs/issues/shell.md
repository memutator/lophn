# shell

데스크톱 앱(packages/shell)의 화면과 그 source. architecture 문서는 아직 없다.

## 데스크톱이 CLI의 `--json` 결과를 `data` 칸에서 찾아 harness 감지가 늘 실패한다

```yaml
kind: bug
modules: [packages/shell/main, packages/coding-agent]
```

지금:
- `packages/shell/main/desktop/coding-connection.ts`의 `childCliRunner`는 `lophn ... --json`의 stdout을 `{ data?, error? }`로 읽고 성공이면 `body.data`를 돌려준다.
- CLI는 성공하면 data를 감싸지 않고 `JSON.stringify(data)` 한 줄을 쓴다(`packages/coding-agent/cli/output.ts`의 `result`). 실패만 `{ error }`로 감싼다.
- 그래서 성공한 `harness detect`의 결과가 늘 `undefined`이고, `run`은 "Detection gave an unknown result."로 모든 harness를 unknown으로 둔다. `harness install`의 결과도 같은 길로 읽는다.

영향: 데스크톱 앱에서 coding agent 감지와 hook·skill 설치가 결과를 읽지 못한다. 감지된 harness가 없으면 App Engineer가 ticket을 coding agent에게 맡기지 못한다.

고치려면: `childCliRunner`가 성공 출력을 그대로 data로 받는다(`body?.error`가 없으면 `body` 전체가 data)(작음). 이 runner에 CLI 출력 꼴 하나로 test를 둔다. 추천.
