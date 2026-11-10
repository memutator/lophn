import {
  AudioLines,
  File,
  FileText,
  Image,
  type LucideIcon,
  Type,
  Video,
} from "lucide-react";

import type { Modality } from "../../../protocol/lophn-agent/agent-values.ts";
import type { MODEL_MEDIA } from "../../../protocol/lophn-agent/resolved-model.ts";

// model이 받고 내는 media(MODEL_MEDIA 다섯)마다 하나. 화면이 lucide를 직접 들이지 않도록 이 묶음이 고른다.
export const modelIcons = {
  text: Type,
  image: Image,
  audio: AudioLines,
  video: Video,
  pdf: FileText,
} as const satisfies Record<(typeof MODEL_MEDIA)[number], LucideIcon>;

// agent가 받고 내는 내용 종류(text·image·file)마다 하나.
export const modalityIcons = {
  text: Type,
  image: Image,
  file: File,
} as const satisfies Record<Modality, LucideIcon>;
