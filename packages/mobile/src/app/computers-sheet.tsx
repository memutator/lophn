// Every paired computer, how it is reached and what waits on it; picking one moves the whole frame to it
// (tools/wireframes/drafts/phone/shell.tsx Computers).
import { t } from "@lophn/i18n";
import {
  Badge,
  Divider,
  Dot,
  Icon,
  Row,
  Sheet,
  Text,
  useTheme,
} from "@lophn/ui-native";
import { Check, type LucideIcon, Monitor, Plus } from "lucide-react-native";
import { View } from "react-native";
import { useComputers } from "../data/mod.ts";
import { stateWithPathOf } from "./computer-state.ts";

function Device({ icon, plain }: { icon: LucideIcon; plain?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: plain ? "transparent" : theme.color.surface.muted,
      }}
    >
      <Icon icon={icon} />
    </View>
  );
}

export function ComputersSheet({
  open,
  onClose,
  onPick,
  onPair,
}: {
  open: boolean;
  onClose: () => void;
  /** After the store selected it. */
  onPick: (key: string) => void;
  onPair: () => void;
}) {
  const { computers, current, select } = useComputers();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("mobile.computer.heading.computers")}
    >
      {computers.map((computer) => {
        const state = stateWithPathOf(computer);
        return (
          <Row
            key={computer.key}
            lead={<Device icon={Monitor} />}
            title={computer.name}
            strong
            sub={
              <>
                <Dot tone={state.tone} />
                <Text variant="small">{state.text}</Text>
              </>
            }
            end={
              computer.key === current ? (
                <Icon icon={Check} />
              ) : computer.waiting > 0 ? (
                <Badge count={computer.waiting} />
              ) : undefined
            }
            onPress={() => {
              onClose();
              if (computer.key === current) return;
              select(computer.key);
              onPick(computer.key);
            }}
          />
        );
      })}
      <Divider spacing={8} />
      <Row
        lead={<Device icon={Plus} plain />}
        title={t("mobile.computer.button.pair-another")}
        onPress={() => {
          onClose();
          onPair();
        }}
      />
    </Sheet>
  );
}
