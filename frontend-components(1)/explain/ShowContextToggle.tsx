"use client"

import { cn } from "@/lib/utils"
import { Eye, EyeOff } from "lucide-react"

interface ShowContextToggleProps {
  showContext: boolean
  onToggle: () => void
  className?: string
}

export function ShowContextToggle({ showContext, onToggle, className }: ShowContextToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors",
        showContext
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-border/80",
        className,
      )}
    >
      {showContext ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      <span>{showContext ? "맥락 이벤트 (켜짐)" : "맥락 이벤트 보기"}</span>
    </button>
  )
}
