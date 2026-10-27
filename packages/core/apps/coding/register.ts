// coding session의 core 등록. writer Worker가 schema·command·port를 가져가고, core 조립이 memory route의
// handler를 붙인다(relay.ts). 메모리 값(감지 결과, 터미널 요청)은 writer Worker가 이 file을 import할 때
// 한 번 만든다.
import { CodingSessionLookup } from "../../../protocol/coding-agent/token.ts";
import { CodingTransport } from "../../../protocol/coding-agent/transport.ts";
import {
  harnessList,
  harnessReport,
} from "../../../protocol/coding-agent/harness-report.ts";
import { codingMessageSend } from "../../../protocol/coding-agent/message.ts";
import {
  codingTerminalExited,
  codingTerminalHook,
  codingTerminalResult,
} from "../../../protocol/coding-agent/terminal-requests.ts";
import { defineTxPort } from "../../storage/ledger/mod.ts";
import { codingSessionLookup } from "./lookup.ts";
import { createCodingMemory } from "./memory.ts";
import { codingSchemaSteps } from "./schema.ts";
import { createSignalCommand } from "./signal.ts";
import { createCodingTransport } from "./transport.ts";

const memory = createCodingMemory();

const codingDefinitions = {
  schemaSteps: codingSchemaSteps,
  commands: [createSignalCommand(memory)],
  // Router의 transport는 tx마다 그 tx의 표를 본다.
  ports: [
    defineTxPort(CodingTransport, (tx) =>
      createCodingTransport(memory, () => tx.sql),
    ),
    defineTxPort(CodingSessionLookup, (tx) => codingSessionLookup(tx.sql)),
  ],
  // handler는 core 조립(wiring)이 route 이름으로 붙인다.
  memoryRoutes: [
    codingMessageSend,
    harnessReport,
    harnessList,
    codingTerminalResult,
    codingTerminalExited,
    codingTerminalHook,
  ],
};

export function createCoreRegistration() {
  return codingDefinitions;
}
