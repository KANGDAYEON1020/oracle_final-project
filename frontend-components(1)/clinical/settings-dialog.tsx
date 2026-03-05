"use client"

import { useTheme } from "next-themes"
import { Moon, Sun, Monitor, Type } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { useSettings, type FontSize } from "@/lib/settings-context"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { theme, setTheme } = useTheme()
  const { fontSize, setFontSize, showTicker, setShowTicker } = useSettings()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-foreground">설정</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Theme Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-foreground">테마</Label>
            <RadioGroup
              value={theme}
              onValueChange={setTheme}
              className="grid grid-cols-3 gap-2"
            >
              <Label
                htmlFor="light"
                className="flex flex-col items-center gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
              >
                <RadioGroupItem value="light" id="light" className="sr-only" />
                <Sun className="h-5 w-5 text-muted-foreground" />
                <span className="text-xs text-foreground">라이트</span>
              </Label>
              <Label
                htmlFor="dark"
                className="flex flex-col items-center gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
              >
                <RadioGroupItem value="dark" id="dark" className="sr-only" />
                <Moon className="h-5 w-5 text-muted-foreground" />
                <span className="text-xs text-foreground">다크</span>
              </Label>
              <Label
                htmlFor="system"
                className="flex flex-col items-center gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
              >
                <RadioGroupItem value="system" id="system" className="sr-only" />
                <Monitor className="h-5 w-5 text-muted-foreground" />
                <span className="text-xs text-foreground">시스템</span>
              </Label>
            </RadioGroup>
          </div>

          {/* Font Size Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Type className="h-4 w-4" />
              글씨 크기
            </Label>
            <RadioGroup
              value={fontSize}
              onValueChange={(value) => setFontSize(value as FontSize)}
              className="grid grid-cols-4 gap-2"
            >
              <Label
                htmlFor="small"
                className="flex flex-col items-center gap-1 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
              >
                <RadioGroupItem value="small" id="small" className="sr-only" />
                <span className="text-xs text-foreground">가</span>
                <span className="text-[10px] text-muted-foreground">작게</span>
              </Label>
              <Label
                htmlFor="medium"
                className="flex flex-col items-center gap-1 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
              >
                <RadioGroupItem value="medium" id="medium" className="sr-only" />
                <span className="text-sm text-foreground">가</span>
                <span className="text-[10px] text-muted-foreground">보통</span>
              </Label>
              <Label
                htmlFor="large"
                className="flex flex-col items-center gap-1 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
              >
                <RadioGroupItem value="large" id="large" className="sr-only" />
                <span className="text-base text-foreground">가</span>
                <span className="text-[10px] text-muted-foreground">크게</span>
              </Label>
              <Label
                htmlFor="xlarge"
                className="flex flex-col items-center gap-1 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
              >
                <RadioGroupItem value="xlarge" id="xlarge" className="sr-only" />
                <span className="text-lg text-foreground">가</span>
                <span className="text-[10px] text-muted-foreground">매우 크게</span>
              </Label>
            </RadioGroup>
          </div>

          {/* Notification Settings */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Monitor className="h-4 w-4" />
                상단 알림 티커
              </Label>
              <Switch
                checked={showTicker}
                onCheckedChange={setShowTicker}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              헤더 하단에 중요 알림을 흐르는 자막으로 표시합니다.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
