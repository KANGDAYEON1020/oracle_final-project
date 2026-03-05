"use client"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus, LucideIcon } from "lucide-react"

interface KpiCardProps {
  title: string
  titleKo: string
  value: number | string
  trend: "up" | "down" | "flat"
  trendValue: string
  icon: LucideIcon
  onClick?: () => void
}

export function KpiCard({
  title,
  titleKo,
  value,
  trend,
  trendValue,
  icon: Icon,
  onClick,
}: KpiCardProps) {
  const TrendIcon =
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus

  return (
    <Card
      className={cn(
        "cursor-pointer gap-0 border border-border bg-card py-0 transition-all hover:-translate-y-0.5 hover:shadow-md",
        onClick && "hover:border-primary/30"
      )}
      onClick={onClick}
    >
      <CardContent className="flex items-start justify-between p-3 md:p-3.5 xl:p-4">
        <div className="flex flex-col gap-0.5">
          <p className="line-clamp-1 text-[11px] font-semibold text-foreground md:text-xs xl:font-medium xl:text-muted-foreground">
            {titleKo}
          </p>
          <p className="hidden text-[10px] text-muted-foreground/70 xl:block">{title}</p>
          <p className="mt-0.5 text-2xl font-bold tracking-tight text-foreground md:mt-1 md:text-[28px] xl:text-3xl">
            {value}
          </p>
          <div
            className={cn(
              "mt-0.5 flex items-center gap-1 text-[11px] font-medium md:text-xs",
              trend === "up" && "text-destructive",
              trend === "down" && "text-emerald-700 dark:text-emerald-300",
              trend === "flat" && "text-muted-foreground"
            )}
          >
            <TrendIcon className="h-3 w-3" />
            <span className="xl:hidden">{trendValue}</span>
            <span className="hidden xl:inline">{trendValue} vs. previous period</span>
          </div>
        </div>
        <div className="hidden h-10 w-10 items-center justify-center rounded-xl bg-primary/8 xl:flex">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </CardContent>
    </Card>
  )
}
