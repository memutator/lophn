import type { SchemaStep } from "../../contracts/platform/mod.ts";

// domain-model lophn-agent/revert의 ledger 표 넷. messages·sessions·runs·tool_calls·events 뒤에
// 만든다. 구현은 agent-RW3a가 채우고(옛 표는 이 step을 제자리에서 고쳐 지운다), 시험이 읽는 열은
// 아래와 같다. 이 열 이름은 spec이고, 그 밖의 열·제약·trigger는 구현이 더해도 된다.
//
//   checkpoints(message pk, session, files_restorable 0/1, files_reason: limit_total / limit_file /
//                limit_count / record_failed)
//   rewind_files(tool_call, path, checkpoint, seq, before_exists 0/1, before_sha256, before_blob,
//                before_size, after_exists 0/1, after_sha256, moved_from, reverted_by;
//                pk (tool_call, path))
//   reverts(id pk, session, kind, choice, checkpoint, tool_call, boundary_seq, summary_call,
//           outcome, redo, preview_hash, result_seq)
//   revert_items(revert, ordinal, class, target, source json, plan, result, reason, app_revert json,
//                restored_sha256, redo_ref; pk (revert, ordinal))
//
// blocked revert는 revert_items 행이 없다. reverts.checkpoint는 사람 메시지 id를 가리킨다. correction 메시지로 하는 messages_only rewind는
// checkpoints 행이 없는 메시지를 고르므로 FK는 messages(id)다.
export const revertSchemaSteps: readonly SchemaStep[] = [];
