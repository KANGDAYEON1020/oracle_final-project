"use client"

import { useEffect, useMemo, useState } from "react"
import { Building2, Check, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export interface WardSwitcherOption {
  value: string
  label: string
  description?: string
}

interface WardSwitcherProps {
  options?: WardSwitcherOption[]
  value?: string
  defaultValue?: string
  onChange?: (next: string) => void
  className?: string
}

const DEFAULT_OPTIONS: WardSwitcherOption[] = [
  {
    value: "ALL",
    label: "전체 병동",
    description: "모든 환자",
  },
]

function normalizeOptions(input?: WardSwitcherOption[]): WardSwitcherOption[] {
  const source = Array.isArray(input) && input.length > 0 ? input : DEFAULT_OPTIONS
  const unique = new Map<string, WardSwitcherOption>()

  for (const option of source) {
    const value = String(option.value || "").trim()
    if (!value) continue
    if (unique.has(value)) continue
    unique.set(value, {
      value,
      label: option.label || value,
      description: option.description,
    })
  }

  if (!unique.has("ALL")) {
    unique.set("ALL", DEFAULT_OPTIONS[0])
  }

  return [unique.get("ALL")!, ...Array.from(unique.values()).filter((o) => o.value !== "ALL")]
}

export function WardSwitcher({ options, value, defaultValue, onChange, className }: WardSwitcherProps) {
  const resolvedOptions = useMemo(() => normalizeOptions(options), [options])

  const initialValue = useMemo(() => {
    const candidate = value ?? defaultValue
    if (!candidate) return resolvedOptions[0]?.value ?? "ALL"
    return resolvedOptions.some((option) => option.value === candidate)
      ? candidate
      : resolvedOptions[0]?.value ?? "ALL"
  }, [defaultValue, resolvedOptions, value])

  const [internalValue, setInternalValue] = useState<string>(initialValue)

  useEffect(() => {
    if (value !== undefined) return
    if (!resolvedOptions.some((option) => option.value === internalValue)) {
      setInternalValue(resolvedOptions[0]?.value ?? "ALL")
    }
  }, [internalValue, resolvedOptions, value])

  const selectedValue = value ?? internalValue
  const selectedOption =
    resolvedOptions.find((option) => option.value === selectedValue) ?? resolvedOptions[0]

  const handleSelect = (nextValue: string) => {
    if (value === undefined) {
      setInternalValue(nextValue)
    }
    onChange?.(nextValue)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-7 gap-1.5 rounded-full border-border/60 bg-background/40 px-2.5 text-xs font-medium text-foreground hover:bg-accent/40",
            className
          )}
        >
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="max-w-[160px] truncate">{selectedOption?.label ?? "전체 병동"}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">병동 선택</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {resolvedOptions.map((option) => {
          const active = option.value === selectedOption?.value
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => handleSelect(option.value)}
              className={cn(
                "flex cursor-pointer items-center justify-between py-2",
                active && "bg-primary/10"
              )}
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium">{option.label}</span>
                {option.description ? (
                  <span className="text-[10px] text-muted-foreground">{option.description}</span>
                ) : null}
              </div>
              {active ? <Check className="h-4 w-4 text-primary" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
