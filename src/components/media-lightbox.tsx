"use client"

import * as React from "react"
import {
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

export type MediaLightboxMedia = {
  src: string
  type: "image" | "video"
  /** Dialog 標題 + 下載檔名 base，如「鏡 3 圖像」 */
  title?: string
}

export type MediaLightboxProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  media: MediaLightboxMedia | null
}

const MIN_SCALE = 1
const MAX_SCALE = 8
const DOUBLE_CLICK_SCALE = 2.5
const STEP_FACTOR = 1.5

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function sanitizeFilename(title: string | undefined, fallback: string) {
  const base = (title ?? fallback).trim() || fallback
  return base.replace(/[\\/:*?"<>|]/g, "_")
}

function extensionFromBlob(blob: Blob, isVideo: boolean) {
  const type = blob.type
  if (type === "image/png") return "png"
  if (type === "image/jpeg") return "jpg"
  if (type === "image/webp") return "webp"
  if (type === "image/gif") return "gif"
  if (type === "video/mp4") return "mp4"
  if (type === "video/webm") return "webm"
  return isVideo ? "mp4" : "png"
}

async function downloadMedia(media: MediaLightboxMedia, setDownloading: (v: boolean) => void) {
  setDownloading(true)
  try {
    const res = await fetch(media.src)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const ext = extensionFromBlob(blob, media.type === "video")
    const filename = `${sanitizeFilename(media.title, media.type === "video" ? "影片" : "圖片")}.${ext}`
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch {
    window.open(media.src, "_blank")
    toast.error("直接下載失敗，已喺新分頁開啟，請手動另存")
  } finally {
    setDownloading(false)
  }
}

export function MediaLightbox({ open, onOpenChange, media }: MediaLightboxProps) {
  const stageRef = React.useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = React.useState(false)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [scale, setScale] = React.useState(1)

  // scale lives here (toolbar needs it) but ImageStage only resets via key= —
  // reset explicitly when the media changes or the dialog closes.
  React.useEffect(() => {
    setScale(MIN_SCALE)
  }, [media?.src])

  React.useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const handler = () => setIsFullscreen(document.fullscreenElement === el)
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [])

  const toggleFullscreen = async () => {
    const el = stageRef.current
    if (!el) return
    if (document.fullscreenElement === el) {
      await document.exitFullscreen()
    } else {
      await el.requestFullscreen()
    }
  }

  if (!media) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        // h-[92vh]（唔淨係 max-h）：stage 要有實高，<img> 嘅 max-h-full 先解析到——
        // 否則高圖（9:16 候選圖）會按 max-w-full 撐爆再被 overflow-hidden 裁頭裁腳。
        className="flex h-[92vh] w-[min(96vw,1200px)] max-w-[min(96vw,1200px)] sm:max-w-[min(96vw,1200px)] max-h-[92vh] flex-col gap-0 overflow-hidden p-0"
      >
        <div className="flex items-center gap-2 border-b px-4 py-2 pr-12">
          <DialogTitle className="flex-1 truncate text-sm font-medium">
            {media.title ?? (media.type === "video" ? "影片" : "圖片")}
          </DialogTitle>
          <div className="flex items-center gap-1">
            {media.type === "image" && (
              <ZoomToolbar scale={scale} onScaleChange={setScale} />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="下載"
              title="下載"
              disabled={downloading}
              onClick={() => void downloadMedia(media, setDownloading)}
            >
              {downloading ? <Loader2 className="animate-spin" /> : <Download />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={isFullscreen ? "退出全螢幕" : "全螢幕"}
              title={isFullscreen ? "退出全螢幕" : "全螢幕"}
              onClick={() => void toggleFullscreen()}
            >
              {isFullscreen ? <Minimize2 /> : <Maximize2 />}
            </Button>
          </div>
        </div>
        <div
          ref={stageRef}
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black"
        >
          {media.type === "image" ? (
            <ImageStage key={media.src} src={media.src} alt={media.title ?? "圖片"} scale={scale} onScaleChange={setScale} />
          ) : (
            <video
              key={media.src}
              src={media.src}
              controls
              preload="metadata"
              className="max-h-full max-w-full"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ZoomToolbar({
  scale,
  onScaleChange,
}: {
  scale: number
  onScaleChange: (updater: (prev: number) => number) => void
}) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="縮細"
        title="縮細"
        disabled={scale <= MIN_SCALE}
        onClick={() => onScaleChange((s) => clamp(s / STEP_FACTOR, MIN_SCALE, MAX_SCALE))}
      >
        <ZoomOut />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="放大"
        title="放大"
        disabled={scale >= MAX_SCALE}
        onClick={() => onScaleChange((s) => clamp(s * STEP_FACTOR, MIN_SCALE, MAX_SCALE))}
      >
        <ZoomIn />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="重設"
        title="重設"
        disabled={scale === MIN_SCALE}
        onClick={() => onScaleChange(() => MIN_SCALE)}
      >
        <RotateCcw />
      </Button>
    </>
  )
}

function ImageStage({
  src,
  alt,
  scale,
  onScaleChange,
}: {
  src: string
  alt: string
  scale: number
  onScaleChange: (updater: (prev: number) => number) => void
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [offset, setOffset] = React.useState({ x: 0, y: 0 })
  const [dragging, setDragging] = React.useState(false)
  const dragStart = React.useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 })
  const scaleRef = React.useRef(scale)
  const offsetRef = React.useRef(offset)
  scaleRef.current = scale
  offsetRef.current = offset

  const clampOffset = React.useCallback((s: number, o: { x: number; y: number }) => {
    const container = containerRef.current
    if (!container || s <= MIN_SCALE) return { x: 0, y: 0 }
    const rect = container.getBoundingClientRect()
    const maxX = (rect.width * (s - 1)) / 2
    const maxY = (rect.height * (s - 1)) / 2
    return { x: clamp(o.x, -maxX, maxX), y: clamp(o.y, -maxY, maxY) }
  }, [])

  const zoomTo = React.useCallback(
    (nextScale: number, centerX: number, centerY: number) => {
      const clamped = clamp(nextScale, MIN_SCALE, MAX_SCALE)
      const prevScale = scaleRef.current
      const prevOffset = offsetRef.current
      if (clamped === MIN_SCALE) {
        onScaleChange(() => MIN_SCALE)
        setOffset({ x: 0, y: 0 })
        return
      }
      // Zoom about (centerX, centerY) relative to container center.
      const ratio = clamped / prevScale
      const nextOffset = {
        x: centerX - (centerX - prevOffset.x) * ratio,
        y: centerY - (centerY - prevOffset.y) * ratio,
      }
      onScaleChange(() => clamped)
      setOffset(clampOffset(clamped, nextOffset))
    },
    [onScaleChange, clampOffset]
  )

  // Toolbar / keyboard change scale without touching offset — re-clamp so a
  // zoom-out never strands the image off-centre (clampOffset zeroes at scale 1).
  React.useEffect(() => {
    setOffset((o) => clampOffset(scale, o))
  }, [scale, clampOffset])

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const centerX = e.clientX - rect.left - rect.width / 2
      const centerY = e.clientY - rect.top - rect.height / 2
      const next = scaleRef.current * Math.exp(-e.deltaY * 0.0015)
      zoomTo(next, centerX, centerY)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomTo])

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") {
        onScaleChange((s) => clamp(s * STEP_FACTOR, MIN_SCALE, MAX_SCALE))
      } else if (e.key === "-") {
        onScaleChange((s) => clamp(s / STEP_FACTOR, MIN_SCALE, MAX_SCALE))
      } else if (e.key === "0") {
        onScaleChange(() => MIN_SCALE)
        setOffset({ x: 0, y: 0 })
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onScaleChange])

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const centerX = e.clientX - rect.left - rect.width / 2
    const centerY = e.clientY - rect.top - rect.height / 2
    if (scaleRef.current > MIN_SCALE) {
      onScaleChange(() => MIN_SCALE)
      setOffset({ x: 0, y: 0 })
    } else {
      zoomTo(DOUBLE_CLICK_SCALE, centerX, centerY)
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scaleRef.current <= MIN_SCALE) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragStart.current = { x: e.clientX, y: e.clientY, offsetX: offsetRef.current.x, offsetY: offsetRef.current.y }
    setDragging(true)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    setOffset(clampOffset(scaleRef.current, { x: dragStart.current.offsetX + dx, y: dragStart.current.offsetY + dy }))
  }

  const handlePointerUp = () => setDragging(false)

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex size-full items-center justify-center touch-none select-none overflow-hidden",
        scale > MIN_SCALE ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
      )}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/** biome-ignore lint: plain img is needed here for CSS transform pan/zoom of arbitrary remote/blob URLs */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="max-h-full max-w-full select-none object-contain"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "center",
        }}
      />
    </div>
  )
}

// v2: accept mediaId and refetch via GET /api/media/[id]/url on error
