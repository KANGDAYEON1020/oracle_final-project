"use client";

import { useMemo } from "react";
import { RotateCcw, PenLine, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Section, DocType } from "@/lib/auto-draft-types";

interface DraftEditorProps {
    sections: Section[];
    onSectionUpdate: (sectionId: string, updates: Partial<Section>) => void;
    onRevert: (sectionId: string) => void;
    onToggleInclude: (sectionId: string) => void;
    onToggleAll: (included: boolean) => void;
    isLoading: boolean;
    highlightedSectionId?: string;
    highlightedFieldKey?: string;
    docType: DocType;
    isReviewed?: boolean;
}

export function DraftEditor({
    sections,
    onSectionUpdate,
    onRevert,
    onToggleInclude,
    onToggleAll,
    isLoading,
    highlightedSectionId,
    highlightedFieldKey,
    docType,
    isReviewed = false,
}: DraftEditorProps) {
    const { allChecked, isIndeterminate } = useMemo(() => {
        const included = sections.filter((s) => s.included !== false);
        const all = included.length === sections.length;
        const none = included.length === 0;
        return {
            allChecked: all,
            isIndeterminate: !all && !none,
        };
    }, [sections]);

    if (isLoading) {
        return (
            <div className="flex flex-col gap-4 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                    <div
                        key={`skel-${i}`}
                        className="rounded-lg border border-border bg-card p-4"
                    >
                        <Skeleton className="mb-3 h-5 w-48" />
                        <Skeleton className="mb-2 h-4 w-full" />
                        <Skeleton className="mb-2 h-4 w-3/4" />
                        <Skeleton className="h-20 w-full" />
                    </div>
                ))}
            </div>
        );
    }

    if (sections.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center">
                <PenLine className="mb-4 h-12 w-12 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                    환자를 선택하고 &quot;AI 초안 생성&quot; 버튼을 눌러 시작하세요.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3 p-4">
            {docType === "certificate" && (
                isReviewed ? (
                    <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 px-4 py-3">
                        <p className="text-sm font-semibold text-emerald-700">
                            Review completed via Validate.
                        </p>
                        <p className="mt-0.5 text-xs text-emerald-700/80">
                            검토가 완료되었습니다. 출력 후 서명 또는 날인을 진행하세요.
                        </p>
                    </div>
                ) : (
                    <div className="rounded-lg border-2 border-destructive/30 bg-destructive/5 px-4 py-3">
                        <p className="text-sm font-semibold text-destructive">
                            Auto-draft. Requires physician review.
                        </p>
                        <p className="mt-0.5 text-xs text-destructive/80">
                            본 문서는 AI가 생성한 초안이며, 의사의 검토 전에는 법적
                            효력이 없습니다.
                        </p>
                    </div>
                )
            )}

            {/* Select All header */}
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
                <Checkbox
                    checked={isIndeterminate ? "indeterminate" : allChecked}
                    onCheckedChange={(checked) => {
                        if (checked === "indeterminate") return;
                        onToggleAll(!!checked);
                    }}
                    aria-label="전체 선택"
                />
                <span className="text-sm font-medium text-foreground">
                    전체 선택
                </span>
                <span className="text-xs text-muted-foreground">
                    ({sections.filter((s) => s.included !== false).length}/{sections.length} 섹션 포함)
                </span>
            </div>

            {sections.map((section) => {
                const isIncluded = section.included !== false;
                const isHighlighted = section.id === highlightedSectionId;

                return (
                    <div
                        key={section.id}
                        id={`section-${section.id}`}
                        className={cn(
                            "rounded-lg border bg-card transition-all",
                            isHighlighted
                                ? "border-primary shadow-md ring-2 ring-primary/20"
                                : "border-border",
                            !isIncluded && "opacity-50"
                        )}
                    >
                        {/* Section header with checkbox */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                            <div className="flex items-center gap-3">
                                <Checkbox
                                    checked={isIncluded}
                                    onCheckedChange={() => onToggleInclude(section.id)}
                                    aria-label={`${section.title} 포함`}
                                />
                                <span className="text-sm font-semibold text-foreground">
                                    {section.title}
                                </span>
                                {section.edited && (
                                    <Badge
                                        variant="secondary"
                                        className="bg-primary/10 text-primary text-[10px] px-1.5 py-0"
                                    >
                                        Edited
                                    </Badge>
                                )}
                                {!isIncluded && (
                                    <Badge
                                        variant="outline"
                                        className="text-[10px] px-1.5 py-0 text-muted-foreground"
                                    >
                                        <Minus className="mr-0.5 h-2.5 w-2.5" />
                                        제외됨
                                    </Badge>
                                )}
                            </div>
                            {section.edited && isIncluded && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onRevert(section.id)}
                                    className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    <RotateCcw className="h-3 w-3" />
                                    원본 복원
                                </Button>
                            )}
                        </div>

                        {/* Section content - always visible */}
                        <div
                            className={cn(
                                "px-4 py-4",
                                !isIncluded && "pointer-events-none select-none"
                            )}
                        >
                            {section.fields.length > 0 && (
                                <div className="mb-4 grid grid-cols-2 gap-3">
                                    {(section.id === "header"
                                        ? [...section.fields].sort((a, b) => {
                                              const aIsPatient = a.key.startsWith("patient");
                                              const bIsPatient = b.key.startsWith("patient");
                                              if (aIsPatient === bIsPatient) return 0;
                                              return aIsPatient ? -1 : 1;
                                          })
                                        : section.fields
                                    ).map((field) => {
                                        const isFieldHighlighted =
                                            isHighlighted && field.key === highlightedFieldKey;
                                        return (
                                            <div
                                                key={field.key}
                                                className={cn(
                                                    "rounded-md p-2 transition-all",
                                                    field.type === "textarea" && "col-span-2",
                                                    isFieldHighlighted &&
                                                    "bg-primary/5 ring-1 ring-primary/30"
                                                )}
                                            >
                                                <Label className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                                                    {field.label}
                                                    {field.required && (
                                                        <span className="text-destructive">*</span>
                                                    )}
                                                </Label>
                                                {field.type === "textarea" ? (
                                                    <Textarea
                                                        value={field.value}
                                                        disabled={!isIncluded}
                                                        onChange={(e) => {
                                                            const newFields = section.fields.map((f) =>
                                                                f.key === field.key
                                                                    ? { ...f, value: e.target.value }
                                                                    : f
                                                            );
                                                            onSectionUpdate(section.id, {
                                                                fields: newFields,
                                                                edited: true,
                                                            });
                                                        }}
                                                        rows={3}
                                                        className="bg-background text-sm"
                                                    />
                                                ) : (
                                                    <Input
                                                        type={field.type === "date" ? "date" : "text"}
                                                        value={field.value}
                                                        disabled={!isIncluded}
                                                        onChange={(e) => {
                                                            const newFields = section.fields.map((f) =>
                                                                f.key === field.key
                                                                    ? { ...f, value: e.target.value }
                                                                    : f
                                                            );
                                                            onSectionUpdate(section.id, {
                                                                fields: newFields,
                                                                edited: true,
                                                            });
                                                        }}
                                                        className={cn(
                                                            "bg-background text-sm",
                                                            field.type === "code" && "font-mono"
                                                        )}
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {section.narrative !== undefined && section.narrative !== "" && (
                                <div>
                                    {section.fields.length > 0 && (
                                        <Label className="mb-1 text-xs text-muted-foreground">
                                            서술 (Narrative)
                                        </Label>
                                    )}
                                    <Textarea
                                        value={section.narrative}
                                        disabled={!isIncluded}
                                        onChange={(e) =>
                                            onSectionUpdate(section.id, {
                                                narrative: e.target.value,
                                                edited: true,
                                            })
                                        }
                                        rows={4}
                                        className="bg-background text-sm leading-relaxed"
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
