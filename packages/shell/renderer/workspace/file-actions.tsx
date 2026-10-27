// Explorer가 휴지통으로 보내기와 끌어 옮기기 전에 한 번 묻는 dialog. 실패하면 같은 dialog가 이유를 보이고
// 닫기만 남는다. 디스크와 열린 탭을 바꾸는 일은 부르는 쪽이 한다.
import { Button } from "@lophn/ui/primitives";
import { Dialog } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

interface FileConfirmProps {
  readonly title: string;
  /** 묻는 글, 또는 실패한 이유. */
  readonly text: string;
  /** 실패한 뒤에는 null이라 닫기만 남는다. */
  readonly confirm: { label: string; danger: boolean } | null;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

export function FileConfirm({
  title,
  text,
  confirm,
  onConfirm,
  onClose,
}: FileConfirmProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      actions={
        <>
          <Button onClick={onClose}>
            {confirm === null
              ? t("common.button.close")
              : t("common.button.cancel")}
          </Button>
          {confirm === null ? null : (
            <Button
              variant={confirm.danger ? "danger" : "primary"}
              onClick={onConfirm}
            >
              {confirm.label}
            </Button>
          )}
        </>
      }
    >
      {text}
    </Dialog>
  );
}
