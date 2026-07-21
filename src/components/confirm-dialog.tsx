"use client"

import * as React from "react"
import { Loader2Icon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export type ConfirmDialogProps = {
  /** 控制 dialog 開關（受控） */
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  /** 確認按鈕文字，預設「確認」 */
  confirmLabel?: string
  /** 取消按鈕文字，預設「取消」 */
  cancelLabel?: string
  /** 危險操作（例如會產生費用/不可逆）時用 destructive 樣式 */
  destructive?: boolean
  /** 可以係 async — dialog 會喺 resolve 之後自動關閉並顯示 loading 狀態 */
  onConfirm: () => void | Promise<void>
}

/**
 * 通用確認對話框，基於 shadcn AlertDialog。
 *
 * 用法：
 * ```tsx
 * const [open, setOpen] = useState(false)
 * <ConfirmDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   title="重新生成分鏡？"
 *   description="已生成嘅圖像/視頻會被捨棄，已花費嘅成本唔會退返。"
 *   destructive
 *   confirmLabel="重新生成"
 *   onConfirm={async () => { await regenerate() }}
 * />
 * ```
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "確認",
  cancelLabel = "取消",
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [isConfirming, setIsConfirming] = React.useState(false)

  const handleConfirm = async (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault()
    try {
      setIsConfirming(true)
      await onConfirm()
      onOpenChange(false)
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription asChild={typeof description !== "string"}>
              {typeof description === "string" ? description : <div>{description}</div>}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isConfirming}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isConfirming}
            aria-busy={isConfirming}
            className={
              destructive
                ? "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40"
                : undefined
            }
          >
            {isConfirming ? (
              <>
                <Loader2Icon className="size-4 animate-spin" />
                處理中…
              </>
            ) : (
              confirmLabel
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
