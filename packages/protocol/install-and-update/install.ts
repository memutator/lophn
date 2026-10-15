import { z } from "zod";

// 설치·update는 HTTP route가 없다. shell이 보여 줄 상태 값만 둔다.
// 같은 데이터 폴더의 writer는 하나다.
export const INSTANCE_STATES = ["absent", "running", "conflict"] as const;

export const instanceStateSchema = z.enum(INSTANCE_STATES);

export type InstanceState = z.infer<typeof instanceStateSchema>;
