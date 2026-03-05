"use client"

import { Bell, Search } from "lucide-react"
import { Input } from "@/components/ui/input"

export function TopBar() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
      {/* Left: Title + status */}
      <div className="flex flex-col">
        <h1 className="text-lg font-bold text-foreground">
          Ward 71W Overview
        </h1>
        <p className="text-xs text-muted-foreground">
          Last updated: Just now{" "}
          <span className="font-medium text-primary">
            {"• "}Live Feed
          </span>
        </p>
      </div>

      {/* Right: Search + bell */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search patient ID or name..."
            className="h-9 w-64 rounded-lg border-border bg-background pl-9 text-sm placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
        </button>
      </div>
    </header>
  )
}
