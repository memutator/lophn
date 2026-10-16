# sandbox 조사: harness 여덟 (2026-10-15)

사람(원문 그대로): "codex, claude code 같은 애들도 sandbox 식으로 쓰나?" → "근데 sandbox가 거의 필수야? hermes, opencode는 어때" → "openclaw랑 omp도 찾아봐줘"

lophn agent에게 file·shell·web tool을 줄 때 경계를 둘지 보려고 모았다. 결론은 경계를 따로 두지 않는 것이다(`../specs/index.md` S4 "정한 것", `../specs/approval.md` 11장 6).

## 1. 한눈에

| harness | 경계 | 기본으로 묻나 | "항상"의 단위 | 파일 되돌리기 |
|---|---|---|---|---|
| Codex | OS sandbox, **기본 켬**(git 폴더) | 경계를 넘을 때만 | 명령 prefix 규칙, host | 없음. 문서가 git commit을 권한다 |
| Claude Code | OS sandbox, 기본 끔(`/sandbox`로 켬) | 규칙대로. 켜면 sandbox 안은 묻지 않음 | 명령 패턴 규칙, host | file tool로 바꾼 것만 |
| OpenCode | 없음 | 거의 안 물음(workspace 밖 경로와 반복 루프만, `.env` 읽기는 막음) | 명령 패턴(그 session 동안) | 확인 못함 |
| Hermes | container backend, 기본 끔(local) | 위험 명령 패턴만 | 명령 패턴 | shadow git checkpoint(기본 끔) |
| omp | 없음 | 안 물음(기본 mode `yolo`) | tool 이름(session 메모리) | 없음. rewind는 대화만 |
| OpenClaw | container(Docker·Podman), 기본 끔 | 안 물음(`security=full`, `ask=off`) | 실행 파일 경로, argv hash, cwd | 없음. rewind는 대화만, session마다 git worktree로 diff |
| pi | 없음("use a sandbox") | 안 물음 | 없음 | 없음 |
| Goose | 없음 | 안 물음(기본 auto) | tool별 permission | 확인 못함 |

## 2. Codex와 Claude Code

- 둘 다 sandbox 안의 명령은 묻지 않고, 경계를 넘을 때만 묻는다.
- OS: 둘 다 macOS는 Seatbelt, Linux는 bubblewrap. Windows는 Codex만 자체 sandbox가 있고, Claude Code는 native Windows에서 sandbox 없이 돈다(WSL2는 bubblewrap).
- 쓰기는 작업 폴더와 temp에만 된다. 그 안에서도 Claude Code는 자기 설정, shell rc, `.git`의 hooks·config를 막고, Codex는 `.git`을 읽기만 하게 둔다.
- 읽기는 둘 다 넓게 허용한다. Claude Code는 `~/.ssh`도 읽히고 `denyRead`로 따로 막는다.
- network는 기본으로 막고 host 단위로 연다. local·사설 주소로 가는 연결은 막는다.
- 경계 넘기: Codex는 좁게(`with_additional_permissions`)와 통째로(`require_escalated`) 둘 다 있다. Claude Code는 통째로(`dangerouslyDisableSandbox`)만 있고 strict mode로 끌 수 있다.
- 되돌리기: Claude Code checkpoint는 "Bash command changes not tracked". Codex 문서는 git commit을 권한다.

## 3. 나머지 여섯

- 경계가 없거나 기본으로 꺼져 있고, 기본으로 거의 묻지 않는다.
- 경계를 두는 쪽은 container다. Hermes는 docker 같은 backend를 두고 사람이 없는 gateway 배포에 권한다("This eliminates the need for dangerous command approval entirely"). OpenClaw는 Docker·Podman을 켜면 `--network none`, 읽기 전용 root, `cap-drop ALL`, host env를 넘기지 않음이 기본이다.
- Hermes 문서는 deny 규칙이 "not ... an OS capability sandbox"라고, omp 문서는 승인 pattern이 "not process or filesystem containment"라고 스스로 적는다.
- shell이 바꾼 파일을 되돌리는 것은 Hermes의 shadow git checkpoint 하나다. `write_file`·`patch` 전과 위험 패턴에 걸린 terminal 명령 전에, 폴더마다 turn에 한 번 뜬다. 기본은 꺼져 있다(`checkpoints.enabled: false`).
- 지침 파일 보호: Hermes는 `AGENTS.md`, `CLAUDE.md` 등 지침 파일 쓰기를 늘 묻는다. omp와 OpenClaw는 막는 코드가 없다.

## 4. 출처

- Claude Code: code.claude.com/docs/en/sandboxing, code.claude.com/docs/en/checkpointing
- Codex: learn.chatgpt.com/docs/sandboxing, learn.chatgpt.com/docs/agent-approvals-security, 결정 선택지는 `events-codex-gemini.md`
- OpenCode: opencode.ai/docs/permissions
- Hermes: `approval-hermes.md`, hermes-agent @ `decf192176`의 `website/docs/user-guide/security.md`, `website/docs/user-guide/profiles.md`("same filesystem access as your user account"), `tools/checkpoint_manager.py`, `agent/tool_executor.py`
- omp: `sandbox-omp.md`(oh-my-pi @ `c2cb79e`)
- OpenClaw: `sandbox-openclaw.md`(openclaw @ `e085c3fb`)
- pi, Goose: `agent-def-opencode-pi-gemini.md`, `agent-def-hermes-goose-cline.md`
