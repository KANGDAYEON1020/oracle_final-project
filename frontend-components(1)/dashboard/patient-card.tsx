"use client"

import { cn } from "@/lib/utils"
import { formatAdmitDayLabel } from "@/lib/admit-day"
import Link from "next/link"
import { Sparkles, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { PatientCard as PatientCardType } from "@/lib/types"

const riskColors: Record<string, string> = {
  Critical: "border-l-destructive",
  Urgent: "border-l-warning",
  Watch: "border-l-primary",
  Low: "border-l-border",
}

const tagVariantStyles: Record<string, string> = {
  destructive:
    "border-destructive/20 bg-destructive/10 text-destructive",
  warning: "border-warning/20 bg-warning/10 text-warning",
  info: "border-primary/20 bg-primary/10 text-primary",
  default: "border-border bg-muted text-muted-foreground",
  success: "border-success/20 bg-success/10 text-success",
  purple: "border-purple-500/20 bg-purple-500/10 text-purple-600",
}

export function PatientCardComponent({
  patient,
  isFavorite,
  onToggleFavorite,
}: {
  patient: PatientCardType
  isFavorite?: boolean
  onToggleFavorite?: () => void
}) {
  const isLowRisk = patient.riskLevel === "Low"
  const dayLabel = formatAdmitDayLabel(patient.demoDayLabel || `HD ${patient.hdDay}`)

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md",
        "border-l-[3px]",
        riskColors[patient.riskLevel]
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-5 pt-5 pb-3">
        <div className="flex flex-col">
          <h3 className="text-base font-bold text-card-foreground">
            {patient.name}
          </h3>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {"ID: "}
            {patient.patientId} {"  \u2022  "}
            {patient.bed}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1">
          <span className="text-xs font-semibold text-card-foreground">
            {patient.age}
            {patient.sex}
          </span>
          <span className="text-muted-foreground">|</span>
          <span className="text-xs font-medium text-muted-foreground">
            {dayLabel}
          </span>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5 px-5 pb-3">
        {patient.tags.map((tag) => (
          <span
            key={tag.label}
            className={cn(
              "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold",
              tagVariantStyles[tag.variant]
            )}
          >
            {tag.label}
          </span>
        ))}
      </div>

      {/* Evidence snippet */}
      <div className="mx-5 mb-4 flex-1 rounded-lg bg-background p-3.5">
        {isLowRisk && !patient.evidenceSnippet ? (
          <p className="text-center text-xs italic text-muted-foreground">
            No acute infection risks detected by AI analysis.
          </p>
        ) : (
          <>
            <div className="mb-1.5 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-card-foreground">
                Evidence Snippet
              </span>
            </div>
            <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
              {patient.evidenceSnippet}
              {patient.evidenceHighlight && (
                <span className="font-semibold text-destructive">
                  {patient.evidenceHighlight}
                </span>
              )}
            </p>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        {patient.secondaryAction && (
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
            {patient.secondaryAction}
          </Button>
        )}
        {patient.primaryAction === "resolve" ? (
          <Button size="sm" className="text-xs">
            Resolve Gap
          </Button>
        ) : patient.primaryAction === "checklist" ? (
          <Button size="sm" className="text-xs">
            Start Transfer Checklist
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={onToggleFavorite}
            >
              <Star
                className={cn(
                  "h-4 w-4",
                  isFavorite ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
                )}
              />
            </Button>
            <Button variant="outline" size="sm" className="text-xs bg-transparent" asChild>
              <Link href={`/patients/${patient.id}`}>View Details</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
