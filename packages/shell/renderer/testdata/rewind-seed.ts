// rewind-core.ts가 실제 core에 심는 session의 id. 실제 core 테스트와 core를 띄우는 쪽이 같은 값을 본다. 이 파일은
// 아무것도 import하지 않는다(renderer bundle에도 들어간다).

export const REWIND_PROJECT = "prj_01k6qs0000000000000000000r";
export const REWIND_SESSION = "ses_01k6qs0000000000000000000r";
export const REWIND_FIRST = "msg_01k6qs0000000000000000001r";
export const REWIND_SECOND = "msg_01k6qs0000000000000000002r";
export const REWIND_FIRST_TEXT = "Draft the weekly notes.";
export const REWIND_SECOND_TEXT = "Now make them shorter.";
/** 심은 rewind가 쓰는 revert id. */
export const REWIND_REVERT = "rvt_01k6qs0000000000000000000r";
