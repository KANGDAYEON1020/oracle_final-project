"use client";

import React from "react"

import {
    AlertCircle,
    AlertTriangle,
    Info,
    ChevronDown,
    ChevronUp,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Issue, IssueSeverity } from "@/lib/auto-draft-types";

const SEVERITY_CONFIG: Record<
    IssueSeverity,
    { icon: React.ElementType; bg: string; text: string; border: string }
> = {
    error: {
        icon: AlertCircle,
        bg: "bg-destructive/10",
        text: "text-destructive",
        border: "border-destructive/20",
    },
    warning: {
        icon: AlertTriangle,
        bg: "bg-amber-50",
        text: "text-amber-700",
        border: "border-amber-200",
    },
    info: {
        icon: Info,
        bg: "bg-secondary",
        text: "text-muted-foreground",
        border: "border-border",
    },
};

interface ValidationBannerProps {
    issues: Issue[];
    onIssueClick: (issue: Issue) => void;
}

export function ValidationBanner({ issues, onIssueClick }: ValidationBannerProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    if (issues.length === 0) return null;

    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warningCount = issues.filter((i) => i.severity === "warning").length;
    const infoCount = issues.filter((i) => i.severity === "info").length;

    return (
        <div className="border-b border-border bg-card">
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex w-full items-center justify-between px-6 py-2.5"
            >
                <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-foreground">
                        Validation Issues
                    </span>
                    {errorCount > 0 && (
                        <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                            <AlertCircle className="h-3 w-3" />
                            {errorCount} error{errorCount > 1 ? "s" : ""}
                        </span>
                    )}
                    {warningCount > 0 && (
                        <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            <AlertTriangle className="h-3 w-3" />
                            {warningCount} warning{warningCount > 1 ? "s" : ""}
                        </span>
                    )}
                    {infoCount > 0 && (
                        <span className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            <Info className="h-3 w-3" />
                            {infoCount} info
                        </span>
                    )}
                </div>
                {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
            </button>

            {isExpanded && (
                <div className="border-t border-border px-6 py-3">
                    <div className="flex flex-col gap-1.5">
                        {issues.map((issue) => {
                            const config = SEVERITY_CONFIG[issue.severity];
                            const Icon = config.icon;
                            return (
                                <button
                                    type="button"
                                    key={issue.id}
                                    onClick={() => onIssueClick(issue)}
                                    className={cn(
                                        "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors hover:opacity-80",
                                        config.bg,
                                        config.border
                                    )}
                                >
                                    <Icon className={cn("h-3.5 w-3.5 shrink-0", config.text)} />
                                    <span className={cn("font-medium", config.text)}>
                                        {issue.message}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
