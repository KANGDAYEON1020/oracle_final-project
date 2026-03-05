"use client";

import React, { useEffect, useState } from "react"

import {
    FileText,
    ArrowRightLeft,
    ClipboardList,
    LogOut,
    ClipboardPlus,
    Award,
    Clock,
    ChevronRight,
    Loader2,
} from "lucide-react";
import { DOC_TYPE_LABELS, type DocType } from "@/lib/auto-draft-types";
import { fetchSavedDrafts, type SavedDraftSummary } from "@/lib/draft-api-service";
import { Badge } from "@/components/ui/badge";

const DOC_TYPE_CARDS: {
    type: DocType;
    icon: React.ElementType;
    description: string;
}[] = [
        {
            type: "referral",
            icon: ArrowRightLeft,
            description: "전원 시 수신 기관으로 보내는 의뢰서",
        },
        {
            type: "return",
            icon: FileText,
            description: "전원 후 원래 기관으로 보내는 회송서",
        },
        {
            type: "summary",
            icon: ClipboardList,
            description: "입원 기간 진료 기록 요약",
        },
        {
            type: "discharge",
            icon: LogOut,
            description: "퇴원 시 작성하는 요약 문서",
        },
        {
            type: "admission",
            icon: ClipboardPlus,
            description: "입원 시 작성하는 초기 기록",
        },
        {
            type: "certificate",
            icon: Award,
            description: "진단서 초안 (의사 검토 필요)",
        },
    ];

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    draft: { label: "초안", variant: "secondary" },
    validated: { label: "검증 완료", variant: "default" },
    exported: { label: "내보냄", variant: "outline" },
};

interface DraftsHomeProps {
    onSelectDocType: (docType: DocType) => void;
    onOpenRecentDraft: (saved: SavedDraftSummary) => void;
    showPageTitle?: boolean;
}

export function DraftsHome({ onSelectDocType, onOpenRecentDraft, showPageTitle = true }: DraftsHomeProps) {
    const [recentDrafts, setRecentDrafts] = useState<SavedDraftSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setIsLoading(true);
            const drafts = await fetchSavedDrafts();
            if (!cancelled) {
                setRecentDrafts(drafts);
                setIsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const formatDate = (dateStr: string) => {
        if (!dateStr) return "-";
        // Handle both ISO and simple date formats
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };

    return (
        <div className="mx-auto max-w-6xl px-6 py-8">
            {showPageTitle ? (
                <div className="mb-8">
                    <h1 className="text-2xl font-bold text-foreground">
                        문서 초안작성 (Autodraft)
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        AI 기반 임상 문서 초안 생성 - 문서 종류를 선택하여 시작하세요
                    </p>
                </div>
            ) : null}

            <section className="mb-10">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    문서 종류 선택
                </h2>
                <div className="grid grid-cols-3 gap-4">
                    {DOC_TYPE_CARDS.map(({ type, icon: Icon, description }) => (
                        <button
                            key={type}
                            type="button"
                            onClick={() => onSelectDocType(type)}
                            className="group flex flex-col rounded-lg border border-border bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-md"
                        >
                            <div className="mb-3 flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                                    <Icon className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-foreground">
                                        {DOC_TYPE_LABELS[type].ko}
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        {DOC_TYPE_LABELS[type].en}
                                    </p>
                                </div>
                            </div>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                                {description}
                            </p>
                            <div className="mt-auto flex items-center gap-1 pt-4 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                                시작하기 <ChevronRight className="h-3 w-3" />
                            </div>
                        </button>
                    ))}
                </div>
            </section>

            <section>
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    <Clock className="mr-1.5 inline h-4 w-4" />
                    최근 작업
                </h2>
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border bg-secondary/50">
                                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                                    문서 종류
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                                    환자
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                                    수정일
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                                    상태
                                </th>
                                <th className="px-4 py-3 text-right font-medium text-muted-foreground" />
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                                    </td>
                                </tr>
                            ) : recentDrafts.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                                        최근 작업이 없습니다.
                                    </td>
                                </tr>
                            ) : (
                                recentDrafts.map((d) => {
                                    const docType = d.docType as DocType;
                                    const st = STATUS_MAP[d.status] || STATUS_MAP.draft;
                                    const label = DOC_TYPE_LABELS[docType];
                                    return (
                                        <tr
                                            key={d.id}
                                            className="border-b border-border last:border-0 transition-colors hover:bg-secondary/30"
                                        >
                                            <td className="px-4 py-3 font-medium text-foreground">
                                                {label?.ko || d.docType}
                                            </td>
                                            <td className="px-4 py-3 text-foreground">
                                                {d.patientName || d.patientId}
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground">
                                                {formatDate(d.updatedAt)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge variant={st.variant}>{st.label}</Badge>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => onOpenRecentDraft(d)}
                                                    className="text-xs font-medium text-primary hover:underline"
                                                >
                                                    열기
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
