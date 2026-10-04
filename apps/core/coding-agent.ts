import {
  connectionAuthFromSnapshot,
  connectionAuthFromTx,
  connectionAuthPort,
  connectionSchemaSteps,
  createConnectionCommands,
  createConnectionReads,
} from "../../packages/coding-agent/mod.ts";

// owner definitions만 내보낸다. App 존재 lookup(apps)과 확인 창 소비는 core 조립이 준다.
// 인증은 매 요청 auth port로 principal의 state·scope·digest를 읽는다.
const commands = createConnectionCommands();
const reads = createConnectionReads();

export const codingAgentConnectionDefinitions = {
  schema: connectionSchemaSteps,
  commands: [commands.create, commands.revoke],
  reads: [reads.list, reads.show],
  ports: {
    auth: {
      key: connectionAuthPort,
      fromTx: connectionAuthFromTx,
      fromSnapshot: connectionAuthFromSnapshot,
    },
  },
};
