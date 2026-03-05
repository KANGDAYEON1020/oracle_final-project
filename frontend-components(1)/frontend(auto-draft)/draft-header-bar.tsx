"use client";

import { ArrowLeft, CheckCircle2, Download, FileCode, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { DOC_TYPE_LABELS, RANGE_LABELS, type DocType, type RangeOption, type Patient } from "@/lib/auto-draft-types";

interface DraftHeaderBarProps {
    docType: DocType;
    patientId: string;
    patients: Patient[];
    range: RangeOption;
    onPatientChange: (id: string) => void;
    onRangeChange: (range: RangeOption) => void;
    onGenerate: () => void;
    onValidate: () => void;
    onExportPdf: () => void;
    onExportCda: () => void;
    isGenerating: boolean;
    isValidating: boolean;
    hasDraft: boolean;
    disableGenerate?: boolean;
    onBack: () => void;
}

export function DraftHeaderBar({
    docType,
    patientId,
    patients,
    range,
    onPatientChange,
    onRangeChange,
    onGenerate,
    onValidate,
    onExportPdf,
    onExportCda,
    isGenerating,
    isValidating,
    hasDraft,
    disableGenerate,
    onBack,
}: DraftHeaderBarProps) {
    return (
        <div className="flex flex-col gap-3 border-b border-border bg-card px-6 py-4">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                    <ArrowLeft className="h-4 w-4" />
                    돌아가기
                </button>
                <span className="text-border">/</span>
                <h1 className="text-lg font-bold text-foreground">
                    {DOC_TYPE_LABELS[docType].ko}
                </h1>
                <span className="text-sm text-muted-foreground">
                    ({DOC_TYPE_LABELS[docType].en})
                </span>
            </div>

            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Select value={patientId} onValueChange={onPatientChange}>
                        <SelectTrigger className="w-[200px] bg-card">
                            <SelectValue placeholder="환자 선택" />
                        </SelectTrigger>
                        <SelectContent>
                            {patients.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                    {p.name} ({p.sex}/{p.age}) - {p.ward}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select
                        value={range}
                        onValueChange={(v) => onRangeChange(v as RangeOption)}
                    >
                        <SelectTrigger className="w-[160px] bg-card">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {(Object.keys(RANGE_LABELS) as RangeOption[]).map((r) => (
                                <SelectItem key={r} value={r}>
                                    {RANGE_LABELS[r]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Button
                        onClick={onGenerate}
                        disabled={isGenerating || disableGenerate}
                        className="gap-1.5"
                    >
                        {isGenerating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Sparkles className="h-4 w-4" />
                        )}
                        {isGenerating ? "생성 중..." : disableGenerate ? "생성 완료" : "AI 초안 생성"}
                    </Button>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onValidate}
                        disabled={!hasDraft || isValidating}
                        className="gap-1.5 bg-transparent"
                    >
                        {isValidating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <CheckCircle2 className="h-4 w-4" />
                        )}
                        Validate
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onExportPdf}
                        disabled={!hasDraft}
                        className="gap-1.5 bg-transparent"
                    >
                        <Download className="h-4 w-4" />
                        PDF
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onExportCda}
                        disabled={!hasDraft}
                        className="gap-1.5 bg-transparent"
                    >
                        <FileCode className="h-4 w-4" />
                        CDA XML
                    </Button>
                </div>
            </div>
        </div>
    );
}
