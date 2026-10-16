// role 명령이 사람의 메시지로 접수하는 prompt template.
// 사람이 입력창에서 직접 쓴 글처럼 접수되므로 사람이 말하는 투로 쓴다. `/이름` 뒤에 사람이
// 쓴 글(인자)은 접수할 때 이 글 뒤에 붙는다.

export const NEW_APP_PROMPT =
  "I want to start a new app in this project. Ask me what it should do and who it is for, one question at a time, then set it up with me.";

export const REPAIR_APP_PROMPT =
  "Something broke in one of my apps. Find out which app and what went wrong, look at what happened, and fix it. Tell me what you found before you change anything.";

export const CHECK_CONTRACTS_PROMPT =
  "Check every context in this project against its documents. List each place where a context and its documents disagree, and tell me what you would change.";

// 명령 뒤에 사람이 쓴 글이 있으면 빈 줄을 두고 prompt 뒤에 붙인다.

// skill 명령이 사람의 메시지로 접수하는 글이다. skill 본문은 담지 않는다: agent가 이름으로 읽는다
// (lophn-agent/extensions).
