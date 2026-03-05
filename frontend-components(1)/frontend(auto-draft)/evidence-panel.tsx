"use client";

import React from "react"

import { useState } from "react";
import {
    FileText,
    FlaskConical,
    Stethoscope,
    ImageIcon,
    Bug,
    TrendingUp,
    TrendingDown,
    Minus,
    ExternalLink,
    X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { EvidenceItem, TrajectoryAxis, DocType } from "@/lib/auto-draft-types";

const SOURCE_ICONS: Record<string, React.ElementType> = {
    nursing: FileText,
    doctor: Stethoscope,
    lab: FlaskConical,
    imaging: ImageIcon,
    micro: Bug,
};

const SOURCE_COLORS: Record<string, string> = {
    nursing: "bg-blue-100 text-blue-700",
    doctor: "bg-emerald-100 text-emerald-700",
    lab: "bg-amber-100 text-amber-700",
    imaging: "bg-indigo-100 text-indigo-700",
    micro: "bg-red-100 text-red-700",
};

const TREND_CONFIG: Record<
    string,
    { icon: React.ElementType; color: string; label: string }
> = {
    improving: {
        icon: TrendingDown,
        color: "text-emerald-600",
        label: "호전",
    },
    stable: { icon: Minus, color: "text-muted-foreground", label: "안정" },
    worsening: { icon: TrendingUp, color: "text-destructive", label: "악화" },
};

interface EvidencePanelProps {
    evidence: EvidenceItem[];
    trajectory?: TrajectoryAxis[];
    docType: DocType;
    onEvidenceClick: (item: EvidenceItem) => void;
}

export function EvidencePanel({
    evidence,
    trajectory,
    docType,
    onEvidenceClick,
}: EvidencePanelProps) {
    const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(
        null
    );

    return (
        <div className="flex h-full flex-col">
            {docType === "summary" && trajectory && trajectory.length > 0 && (
                <div className="border-b border-border p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Trajectory Summary
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                        {trajectory.map((axis) => {
                            const trend = TREND_CONFIG[axis.trend];
                            const TrendIcon = trend.icon;
                            return (
                                <div
                                    key={axis.axis}
                                    className="rounded-md border border-border bg-background p-2.5"
                                >
                                    <div className="mb-1 flex items-center justify-between">
                                        <span className="text-xs font-medium text-foreground">
                                            {axis.label}
                                        </span>
                                        <div className={cn("flex items-center gap-1", trend.color)}>
                                            <TrendIcon className="h-3 w-3" />
                                            <span className="text-[10px] font-semibold">
                                                {trend.label}
                                            </span>
                                        </div>
                                    </div>
                                    <ul className="space-y-0.5">
                                        {axis.supportingFacts.slice(0, 2).map((fact, i) => (
                                            <li
                                                key={`${axis.axis}-${i}`}
                                                className="text-[10px] text-muted-foreground leading-snug"
                                            >
                                                {fact}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Evidence ({evidence.length})
                </h3>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
                <ScrollArea className="h-full">
                    <div className="flex flex-col gap-2 p-4">
                        {evidence.map((item) => {
                            const Icon = SOURCE_ICONS[item.sourceType] || ImageIcon;
                            const colorClass = SOURCE_COLORS[item.sourceType] || "bg-secondary text-secondary-foreground";
                            return (
                                <button
                                    type="button"
                                    key={item.id}
                                    onClick={() => {
                                        setSelectedEvidence(item);
                                        onEvidenceClick(item);
                                    }}
                                    className={cn(
                                        "flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all hover:border-primary/30 hover:shadow-sm",
                                        selectedEvidence?.id === item.id
                                            ? "border-primary/40 bg-primary/5"
                                            : "border-border bg-card"
                                    )}
                                >
                                    <div className="flex w-full items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className={cn(
                                                    "flex h-6 w-6 items-center justify-center rounded",
                                                    colorClass
                                                )}
                                            >
                                                <Icon className="h-3 w-3" />
                                            </div>
                                            <span className="text-xs font-medium text-foreground">
                                                {item.docName}
                                            </span>
                                        </div>
                                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                    </div>
                                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                        {item.quote}
                                    </p>
                                    <div className="flex w-full items-center justify-between">
                                        <span className="text-[10px] text-muted-foreground">
                                            {item.timestamp}
                                        </span>
                                        <Badge
                                            variant="secondary"
                                            className="text-[10px] px-1.5 py-0"
                                        >
                                            {Math.round(item.confidence * 100)}%
                                        </Badge>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </ScrollArea>
            </div>

            {selectedEvidence && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
                    <div className="relative w-full max-w-2xl rounded-xl border border-border bg-card shadow-xl">
                        <div className="flex items-center justify-between border-b border-border px-6 py-4">
                            <div>
                                <h3 className="text-sm font-semibold text-foreground">
                                    {selectedEvidence.docName}
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                    {selectedEvidence.timestamp}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedEvidence(null)}
                                className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="px-6 py-4">
                            <p className="text-sm leading-relaxed text-foreground">
                                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
                                eiusmod tempor incididunt ut labore et dolore magna aliqua.{" "}
                                <mark className="rounded bg-primary/20 px-0.5 text-foreground">
                                    {selectedEvidence.quote}
                                </mark>{" "}
                                Ut enim ad minim veniam, quis nostrud exercitation ullamco
                                laboris nisi ut aliquip ex ea commodo consequat.
                            </p>
                        </div>
                        <div className="flex justify-end border-t border-border px-6 py-3">
                            <Badge variant="secondary" className="text-xs">
                                Confidence: {Math.round(selectedEvidence.confidence * 100)}%
                            </Badge>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
