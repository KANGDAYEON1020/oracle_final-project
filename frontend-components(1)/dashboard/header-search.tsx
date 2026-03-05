"use client"

import type { ComponentProps } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type HeaderSearchProps = Omit<ComponentProps<typeof Input>, "type"> & {
  containerClassName?: string
}

export function HeaderSearch({ containerClassName, className, ...props }: HeaderSearchProps) {
  return (
    <div className={cn("relative w-72", containerClassName)}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        className={cn("h-9 pl-9", className)}
        {...props}
      />
    </div>
  )
}

