"use client";

import { X, Copy, Check, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Section, DocType } from "@/lib/auto-draft-types";
import { DOC_TYPE_LABELS } from "@/lib/auto-draft-types";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    format: "pdf" | "cda";
    xmlContent?: string;
    sections?: Section[];
    docType?: DocType;
    patientName?: string;
}

export function ExportModal({
    isOpen,
    onClose,
    format,
    xmlContent,
    sections,
    docType,
    patientName,
}: ExportModalProps) {
    const [copied, setCopied] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);

    useEffect(() => {
        const cleanup = () => {
            if (document?.body?.dataset?.printing === "pdf-preview") {
                delete document.body.dataset.printing;
            }
        };

        window.addEventListener("afterprint", cleanup);
        return () => window.removeEventListener("afterprint", cleanup);
    }, []);

    if (!isOpen) return null;

    const headerSection = sections?.find((s) => s.id === "header");
    const recipientSection = sections?.find((s) => s.id === "recipient");

    const getHeaderValue = (keys: string[]) => {
        if (!headerSection) return "";
        for (const key of keys) {
            const field = headerSection.fields.find((f) => f.key === key);
            if (field?.value?.trim()) return field.value;
        }
        return "";
    };

    const getRecipientValue = (keys: string[]) => {
        if (!recipientSection) return "";
        for (const key of keys) {
            const field = recipientSection.fields.find((f) => f.key === key);
            if (field?.value?.trim()) return field.value;
        }
        return "";
    };

    const patientNameValue =
        patientName || getHeaderValue(["patientName"]) || "";
    const patientFields =
        headerSection?.fields.filter(
            (f) => f.key.startsWith("patient") && f.key !== "patientName"
        ) ?? [];
    const nonPatientHeaderFields =
        headerSection?.fields.filter((f) => !f.key.startsWith("patient")) ?? [];

    const issueDate =
        getHeaderValue(["issueDate", "referralDate", "date"]) ||
        new Date().toISOString().slice(0, 10);
    const physicianNameValue =
        getHeaderValue(["physicianName", "provider"]) || "";
    const physicianLicenseValue =
        getHeaderValue(["physicianLicense", "licenseNumber", "licenseNo"]) || "-";
    const institutionNameValue =
        getHeaderValue(["hospitalName", "orgName"]) ||
        getRecipientValue(["recvOrgName"]) ||
        "-";



    const handleCopy = async () => {
        if (xmlContent) {
            await navigator.clipboard.writeText(xmlContent);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handlePrint = () => {
        setIsPrinting(true);
        const originalTitle = document.title;

        // Format timestamp: YYYYMMDD_HHmmss
        const now = new Date();
        const timestamp = now.getFullYear().toString() +
            (now.getMonth() + 1).toString().padStart(2, '0') +
            now.getDate().toString().padStart(2, '0') + "_" +
            now.getHours().toString().padStart(2, '0') +
            now.getMinutes().toString().padStart(2, '0') +
            now.getSeconds().toString().padStart(2, '0');

        // Set temporary title for print/download filename
        document.title = `진료의뢰서_${timestamp}`;

        // Give React a tick to render the portal content before printing
        // Increased timeout to ensure styles are applied and layout is recalculated
        setTimeout(() => {
            window.print();
            // Restore original title
            document.title = originalTitle;
            setIsPrinting(false);
        }, 500);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
            <div className="relative flex h-[85vh] w-full max-w-3xl min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                <div className="flex items-center justify-between border-b border-border px-6 py-4">
                    <h2 className="text-sm font-semibold text-foreground">
                        {format === "pdf" ? "PDF 미리보기" : "CDA XML 내보내기"}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <ScrollArea className="min-h-0 flex-1">
                    {format === "pdf" ? (
                        sections && docType ? (
                            <div className="p-8">
                                <ReferralLetterTemplate
                                    sections={sections}
                                    docType={docType}
                                    patientName={patientName}
                                />
                            </div>
                        ) : (
                            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                                미리보기 데이터가 없습니다.
                            </div>
                        )
                    ) : (
                        <div className="p-6">
                            <pre className="overflow-x-auto rounded-lg bg-foreground/5 p-4 text-xs leading-relaxed text-foreground font-mono">
                                {xmlContent}
                            </pre>
                        </div>
                    )}
                </ScrollArea>

                <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3">
                    {format === "cda" && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCopy}
                            className="gap-1.5 bg-transparent"
                        >
                            {copied ? (
                                <Check className="h-3.5 w-3.5" />
                            ) : (
                                <Copy className="h-3.5 w-3.5" />
                            )}
                            {copied ? "복사됨" : "복사"}
                        </Button>
                    )}
                    {format === "pdf" && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handlePrint}
                            className="gap-1.5"
                        >
                            <Printer className="h-3.5 w-3.5" />
                            인쇄
                        </Button>
                    )}
                    <Button size="sm" onClick={onClose}>
                        닫기
                    </Button>
                </div>
            </div>

            {/* Hidden React Portal for printing - renders only when needed or keeps hidden but in DOM */}
            {
                isPrinting &&
                sections &&
                docType &&
                createPortal(
                    <div className="print-only-portal">
                        <ReferralLetterTemplate
                            sections={sections}
                            docType={docType}
                            patientName={patientName}
                            isPrintMode
                        />
                    </div>,
                    document.body
                )
            }

            <style jsx global>{`
                @media print {
                    /* Hide everything by default */
                    body > * {
                        display: none !important;
                    }
                    
                    /* Show only the portal content */
                    body > .print-only-portal {
                        display: block !important;
                        position: relative !important; /* Changed from absolute to flow naturally */
                        width: 100% !important;
                        height: auto !important;
                        z-index: 9999;
                        background: white !important;
                        print-color-adjust: exact !important;
                        -webkit-print-color-adjust: exact !important;
                    }
                    
                    /* Reset portal children styles for print */
                    .print-only-portal * {
                        visibility: visible !important;
                    }

                    /* Ensure page breaks work */
                    html, body {
                        height: auto !important;
                        overflow: visible !important;
                        background: white !important;
                    }
                    
                    @page {
                        size: auto;
                        margin: 10mm;
                    }
                }
                
                @media screen {
                    .print-only-portal {
                        display: none;
                    }
                }
            `}</style>
        </div >
    );
}

function ReferralLetterTemplate({
    sections,
    docType,
    patientName,
    isPrintMode = false,
}: {
    sections: Section[];
    docType: DocType;
    patientName?: string;
    isPrintMode?: boolean;
}) {
    const headerSection = sections.find((s) => s.id === "header");
    const recipientSection = sections.find((s) => s.id === "recipient");

    const getHeaderValue = (keys: string[]) => {
        if (!headerSection) return "";
        for (const key of keys) {
            const field = headerSection.fields.find((f) => f.key === key);
            if (field?.value?.trim()) return field.value;
        }
        return "";
    };

    const getRecipientValue = (keys: string[]) => {
        if (!recipientSection) return "";
        for (const key of keys) {
            const field = recipientSection.fields.find((f) => f.key === key);
            if (field?.value?.trim()) return field.value;
        }
        return "";
    };

    const patientNameValue =
        patientName || getHeaderValue(["patientName"]) || "";
    const patientFields =
        headerSection?.fields.filter(
            (f) => f.key.startsWith("patient") && f.key !== "patientName"
        ) ?? [];
    const nonPatientHeaderFields =
        headerSection?.fields.filter((f) => !f.key.startsWith("patient")) ?? [];

    const issueDate =
        getHeaderValue(["issueDate", "referralDate", "date"]) ||
        new Date().toISOString().slice(0, 10);
    const physicianNameValue =
        getHeaderValue(["physicianName", "provider"]) || "";
    const physicianLicenseValue =
        getHeaderValue(["physicianLicense", "licenseNumber", "licenseNo"]) || "-";
    const institutionNameValue =
        getHeaderValue(["hospitalName", "orgName"]) ||
        getRecipientValue(["recvOrgName"]) ||
        "-";

    return (
        <div
            className={cn(
                "mx-auto flex flex-col rounded-lg bg-card p-8",
                isPrintMode ? "w-full border-none shadow-none" : "max-w-[600px] border border-border shadow-sm"
            )}
        >
            <div className="mb-6 border-b border-border pb-4 text-center">
                <h1 className="text-lg font-bold text-foreground">
                    {DOC_TYPE_LABELS[docType].ko}
                </h1>
                <p className="text-xs text-muted-foreground">
                    {DOC_TYPE_LABELS[docType].en}
                </p>
                {patientName && (
                    <p className="mt-2 text-sm text-foreground">
                        환자: {patientName}
                    </p>
                )}
            </div>

            {/* Patient info should appear at the top of the filled area */}
            {(patientFields.length > 0 || patientNameValue) && (
                <div className="mb-6">
                    <h3 className="mb-2 text-xs font-bold uppercase text-foreground">
                        환자 정보 (Patient)
                    </h3>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                        {patientNameValue && (
                            <div className="grid grid-cols-[80px_1fr] gap-2 text-xs text-foreground">
                                <span className="font-medium text-muted-foreground whitespace-nowrap">
                                    성명
                                </span>
                                <span>{patientNameValue}</span>
                            </div>
                        )}
                        {patientFields.map((f) => (
                            <div
                                key={f.key}
                                className="grid grid-cols-[80px_1fr] gap-2 text-xs text-foreground"
                            >
                                <span className="font-medium text-muted-foreground whitespace-nowrap">
                                    {f.label}
                                </span>
                                <span>{f.value || "-"}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex-1">
                {sections
                    .filter((s) => s.id !== "header")
                    .map((section) => (
                        <div key={section.id} className="mb-4 break-inside-avoid">
                            <h3 className="mb-1 text-xs font-bold uppercase text-foreground">
                                {section.title}
                            </h3>
                            {section.fields.length > 0 && (
                                <div className="mb-2 grid gap-x-8 gap-y-1 grid-cols-1">
                                    {section.fields.map((f) => (
                                        <div
                                            key={f.key}
                                            className="grid grid-cols-[80px_1fr] gap-2 text-xs text-foreground"
                                        >
                                            <span className="font-medium text-muted-foreground whitespace-nowrap">
                                                {f.label}
                                            </span>
                                            <span>{f.value || "-"}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {section.narrative && (
                                <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                                    {section.narrative}
                                </p>
                            )}
                        </div>
                    ))}
            </div>

            {/* Issuance info should appear at the very bottom */}
            <div className="mt-auto pt-6 text-xs text-foreground border-t border-border break-inside-avoid">
                <div className="grid grid-cols-1 gap-y-1">
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                        <span className="font-medium text-muted-foreground whitespace-nowrap">
                            발급일
                        </span>
                        <span>{issueDate}</span>
                    </div>
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                        <span className="font-medium text-muted-foreground whitespace-nowrap">
                            의료기관
                        </span>
                        <span>{institutionNameValue}</span>
                    </div>
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                        <span className="font-medium text-muted-foreground whitespace-nowrap">
                            담당의사
                        </span>
                        <span>{physicianNameValue || "-"}</span>
                    </div>
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                        <span className="font-medium text-muted-foreground whitespace-nowrap">
                            담당의사 면허번호
                        </span>
                        <span>{physicianLicenseValue}</span>
                    </div>
                    {nonPatientHeaderFields.length > 0 && (
                        <div className="mt-2 text-[11px] text-muted-foreground">
                            {nonPatientHeaderFields
                                .filter(
                                    (f) =>
                                        ![
                                            "issueDate",
                                            "referralDate",
                                            "date",
                                            "physicianName",
                                            "provider",
                                            "physicianLicense",
                                            "licenseNumber",
                                            "licenseNo",
                                            "hospitalName",
                                            "orgName",
                                        ].includes(f.key)
                                )
                                .map((f) => `${f.label}: ${f.value || "-"}`)
                                .join(" · ")}
                        </div>
                    )}
                    <div className="mt-6 flex justify-end">
                        <div className="text-right">
                            <div className="mb-2">
                                성명:{" "}
                                <span className="inline-block w-40 border-b border-border align-middle" />{" "}
                                (서명 또는 인)
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-8 text-center">
                    <p className="text-[10px] text-muted-foreground">
                        Generated by INFECT-GUARD Autodraft System
                    </p>
                </div>
            </div>
        </div>
    );
}
