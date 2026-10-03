---
type: guide
concerns: [lophn-agent, coding-agent]
---
# agent 관련 조사

agent와 관련된 부분은 문서만 보고 구현하면 디테일이 크게 떨어진다. 그래서 계획과 구현 전에 반드시 오픈소스 코드를 여러 측면에서 조사한다.

## 규칙

- **대상**: `lophn-agent/` 아래 모든 concern(harness, provider, model, prompt 조립, compaction, tool, tool 판정, safety, usage, extensions의 MCP·skill, conversation, questions, handoff, revert, observability, evaluation, presets, instructions)과 `coding-agent/` 아래 모든 concern.
- **주제마다 최소 3개 프로젝트**를 본다. 같은 문제를 서로 다르게 푼 쪽을 고른다.
- **코드를 읽는다.** README나 마케팅 글이 아니라 실제 소스에서 확인한다: 파일 경로, 타입과 필드, 기본값, 실패 처리. 공식 문서가 "못 한다"고 인정하는 한계도 적는다.
- **확인한 것과 추측을 구별한다.** 코드에서 본 것만 사실로 적는다.
- 조사 결과는 `docs/research/<주제>.md`(type `research`)에 남긴다. 구현 작업은 그 문서를 `조사:` 줄로 가리킨다.
- 계획을 쓸 때 lophn-agent 팀과 coding-agent 팀은 주제마다 조사 작업을 구현 작업보다 앞에 둔다.

## 조사 결과 문서의 모양

```markdown
---
type: research
concerns: [lophn-agent/harness/prompt-assemble]
---
# prompt 조립과 compaction

## 질문
무엇을 알아야 구현할 수 있나. 세 줄 안쪽.

## 프로젝트별
### <프로젝트> (revision)
- 무엇을 어떻게 하나. 근거: 파일 경로, 함수, 타입
- 기본값과 한계

## 비교
표 하나.

## lophn에 가져올 것과 버릴 것
requirements와 맞지 않으면 무엇이 다른지 적고, 바꿀 필요가 있으면 open-issues에 올린다.
```

## 참고 주소

lophn agent harness를 볼 때 쓰는 프로젝트다. 최근 30일 안에 push가 있는 agent harness 가운데 GitHub 스타 상위 10개에서 agent 제작 플랫폼(AutoGPT, Dify)을 뺐다. 스타와 마지막 push는 2026-09-29 기준이다.

| 프로젝트 | 주소 | 블로그 | 무엇인가 | 스타 | 마지막 push |
|---|---|---|---|---|---|
| OpenClaw | <https://github.com/openclaw/openclaw> | <https://openclaw.ai/blog> | 자기 머신에 상주하며 메신저로 일하는 개인 agent | 39.1만 | 2026-09-29 |
| Hermes Agent | <https://github.com/NousResearch/hermes-agent> | <https://nousresearch.com/blog> | 세션을 넘어 기억하고 스스로 skill을 만드는 상주형 개인 agent | 25.0만 | 2026-09-29 |
| OpenCode | <https://github.com/anomalyco/opencode> | 없음 (<https://opencode.ai/changelog>) | 오픈소스 터미널 coding agent | 21.1만 | 2026-09-29 |
| Claude Code | <https://github.com/anthropics/claude-code> | <https://www.anthropic.com/engineering> | Anthropic의 터미널 coding agent | 14.9만 | 2026-09-29 |
| LangChain | <https://github.com/langchain-ai/langchain> | <https://www.langchain.com/blog> | LLM 앱과 agent를 만드는 기반 프레임워크 | 14.7만 | 2026-09-29 |
| Codex | <https://github.com/openai/codex> | <https://openai.com/news/engineering/>, <https://developers.openai.com/blog> | OpenAI의 터미널 coding agent | 12.7만 | 2026-09-29 |
| Pi | <https://github.com/earendil-works/pi> | <https://earendil.com/posts/>, <https://mariozechner.at/posts/> | 통합 LLM API, agent 루프, TUI, coding agent CLI를 담은 툴킷 | 11.0만 | 2026-09-29 |
| Gemini CLI | <https://github.com/google-gemini/gemini-cli> | <https://developers.googleblog.com/en/search/?query=Gemini+CLI> | Google의 터미널 agent. 개인 사용자용은 Antigravity CLI로 넘어갔다 | 10.7만 | 2026-09-29 |

coding agent interface를 볼 때만 쓰는 프로젝트다. 여러 coding agent harness를 감지하고, 연동하고, 띄우고, 상태를 보는 쪽이다. lophn agent harness 조사에는 쓰지 않는다.

| 프로젝트 | 주소 | 무엇인가 | 볼 것 |
|---|---|---|---|
| Orca | <https://github.com/stablyai/orca> | 여러 coding agent를 worktree에서 나란히 돌리는 ADE, coordinator skill | harness 감지, skill·hook 설치, 터미널 launch·resume, 상태 감지, coordinator |
| Paseo | <https://github.com/getpaseo/paseo> | coding agent를 띄우고 관리하는 daemon | provider manifest, 감지 probe, runtime MCP, session·permission 중계 |

coding agent interface 주제는 Orca와 Paseo에 위 harness 가운데 그 주제에 맞는 것 하나 이상을 더해 3개 이상을 본다(예: 설치 자리는 Claude Code, Codex, OpenCode의 설정 형식).
