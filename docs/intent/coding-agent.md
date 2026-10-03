---
type: intent
concerns: [coding-agent]
---
# coding-agent

## 왜
코드는 내가 쓰던 coding agent가 짠다. lophn은 내가 중간에서 설명을 옮기고 결과를 확인하는 일을 없앤다.

## 무엇을 약속하나

- **[I1]** Claude Code, Codex 같은 내가 쓰던 coding agent를 그대로 쓰고, lophn이 설치된 것을 찾아 연결한다.
- **[I2]** ticket에서 [Start]를 누르면 고른 coding agent가 터미널 탭에서 그 일을 시작한다.
- **[I3]** 내가 설명을 옮기지 않아도 coding agent에게 할 일과 근거(수리라면 그때의 증거)가 넘어간다.
- **[I4]** coding agent가 무엇을 하고 있는지 보이고, 맡긴 일이 버려지지 않는다.

## 하지 않는 것
- coding agent 자체나 코드 생성 loop를 만들지 않는다.
- coding agent에게 승인, 권한 변경, secret 값을 주지 않는다.

## 잘되고 있다는 신호
- 익숙한 도구에서 lophn의 일을 바로 시작한다.
- 고친 결과를 원래 문제나 ticket에서 찾고, 내게 다시 설명을 요구하는 일이 줄어든다.
