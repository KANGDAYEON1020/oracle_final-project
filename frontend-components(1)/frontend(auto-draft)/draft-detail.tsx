"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DraftHeaderBar } from "@/components/auto-draft/draft-header-bar";
import { DraftEditor } from "@/components/auto-draft/draft-editor";
import { EvidencePanel } from "@/components/auto-draft/evidence-panel";
import { ValidationBanner } from "@/components/auto-draft/validation-banner";
import { ExportModal } from "@/components/auto-draft/export-modal";
import {
    validateDraft,
    exportDraft,
} from "@/lib/draft-utils";
import {
    fetchDraftPatients,
    fetchPatientTrajectory,
    fetchSavedDraft,
    generateDraftFromAPI,
    saveDraftToDb,
    updateDraftStatus,
} from "@/lib/draft-api-service";
import type { SavedDraftSummary } from "@/lib/draft-api-service";
import { useDemoClock } from "@/lib/demo-clock-context";
import type {
    DocType,
    RangeOption,
    Section,
    Issue,
    EvidenceItem,
    Draft,
    Patient,
    TrajectoryAxis,
} from "@/lib/auto-draft-types";

interface DraftDetailProps {
    docType: DocType;
    onBack: () => void;
    initialSavedDraft?: SavedDraftSummary;
    initialPatientId?: string;
}

export function DraftDetail({ docType, onBack, initialSavedDraft, initialPatientId }: DraftDetailProps) {
    const { demoStep, demoShift } = useDemoClock();
    const [patients, setPatients] = useState<Patient[]>([]);
    const [patientId, setPatientId] = useState(initialPatientId ?? "");
    const [range, setRange] = useState<RangeOption>("7d");
    const [draft, setDraft] = useState<Draft | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [isReviewed, setIsReviewed] = useState(false);
    const [validationIssues, setValidationIssues] = useState<Issue[]>([]);
    const [highlightedSectionId, setHighlightedSectionId] = useState<string>();
    const [highlightedFieldKey, setHighlightedFieldKey] = useState<string>();
    const [isLoadingDraft, setIsLoadingDraft] = useState(false);

    // Track if AI generate should be disabled (validated/exported)
    const [disableGenerate, setDisableGenerate] = useState(false);
    const [trajectory, setTrajectory] = useState<TrajectoryAxis[]>([]);

    useEffect(() => {
        fetchDraftPatients({ demoStep, demoShift })
            .then((list) => {
                setPatients(list);
                if (list.length === 0) return;
                setPatientId((prev) => {
                    if (prev && list.some((patient) => patient.id === prev)) return prev;
                    if (initialPatientId && list.some((patient) => patient.id === initialPatientId)) {
                        return initialPatientId;
                    }
                    return list[0].id;
                });
            })
            .catch((err) => console.warn("Failed to load draft patients:", err));
    }, [initialPatientId, demoShift, demoStep]);

    const [exportModal, setExportModal] = useState<{
        open: boolean;
        format: "pdf" | "cda";
        xmlContent?: string;
    }>({ open: false, format: "pdf" });

    // Load saved draft from DB when opening a recent work item
    useEffect(() => {
        if (!initialSavedDraft) return;
        let cancelled = false;
        (async () => {
            setIsLoadingDraft(true);
            const loaded = await fetchSavedDraft(initialSavedDraft.id);
            if (cancelled) return;
            if (loaded) {
                const sectionsWithIncluded = loaded.sections.map((s: Section) => ({
                    ...s,
                    included: true,
                }));
                setDraft({ ...loaded, sections: sectionsWithIncluded });
                setValidationIssues(loaded.validationIssues || []);
                if (docType === "summary") {
                    fetchPatientTrajectory(loaded.patientId).then(setTrajectory);
                }

                if (initialSavedDraft.status === "validated") {
                    setDisableGenerate(true);
                    setIsReviewed(true);
                } else if (initialSavedDraft.status === "exported") {
                    setDisableGenerate(true);
                    setIsReviewed(true);
                    // Auto-open PDF preview for exported drafts
                    setTimeout(() => {
                        setExportModal({ open: true, format: "pdf" });
                    }, 300);
                }
            } else {
                toast.error("저장된 초안을 불러오지 못했습니다.");
            }
            setIsLoadingDraft(false);
        })();
        return () => { cancelled = true; };
    }, [initialSavedDraft]);

    const handleGenerate = useCallback(async () => {
        if (!patientId) {
            toast.error("생성할 환자를 먼저 선택해 주세요.");
            return;
        }

        setIsGenerating(true);
        setValidationIssues([]);
        setIsReviewed(false);
        setDisableGenerate(false);
        setHighlightedSectionId(undefined);
        setHighlightedFieldKey(undefined);
        try {
            const result = await generateDraftFromAPI(docType, patientId, range, {
                demoStep,
                demoShift,
            });
            const sectionsWithIncluded = result.sections.map((s: Section) => ({
                ...s,
                included: true,
            }));
            const resultWithIncluded = { ...result, sections: sectionsWithIncluded };

            // Save to Oracle DB via Express
            const currentPatientObj = patients.find((p) => p.id === patientId);
            const savedId = await saveDraftToDb(resultWithIncluded, currentPatientObj?.name);
            if (savedId) {
                resultWithIncluded.draftId = savedId;
            }

            setDraft(resultWithIncluded);
            if (docType === "summary") {
                fetchPatientTrajectory(patientId).then(setTrajectory);
            }
            toast.success("AI 초안이 생성되었습니다.");
        } catch (err) {
            const msg = err instanceof Error ? err.message : "초안 생성에 실패했습니다.";
            toast.error(msg);
        } finally {
            setIsGenerating(false);
        }
    }, [demoShift, demoStep, docType, patientId, patients, range]);

    const handleValidate = useCallback(async () => {
        if (!draft) return;
        setIsValidating(true);
        try {
            const issues = await validateDraft(draft, {
                reviewed: docType === "certificate",
            });
            setValidationIssues(issues);
            if (docType === "certificate") {
                setIsReviewed(true);
            }
            setDraft((prev) => (prev ? { ...prev, validationIssues: issues } : prev));

            // Update status in DB
            if (draft.draftId) {
                await updateDraftStatus(draft.draftId, "validated", {
                    validationIssues: issues,
                    sections: draft.sections,
                });
                setDisableGenerate(true);
            }

            if (docType === "certificate") {
                if (issues.length === 0) {
                    toast.success("검토(Validate) 완료: 이슈가 없습니다.");
                } else {
                    toast.warning(`검토(Validate) 완료: ${issues.length}개 이슈 확인`);
                }
            } else if (issues.length === 0) {
                toast.success("검증 완료: 이슈가 없습니다.");
            } else {
                toast.warning(`검증 완료: ${issues.length}개 이슈 발견`);
            }
        } catch {
            toast.error("검증에 실패했습니다.");
        } finally {
            setIsValidating(false);
        }
    }, [docType, draft]);

    const handleExportPdf = useCallback(async () => {
        if (!draft) return;
        try {
            await exportDraft(draft, "pdf");
            setExportModal({ open: true, format: "pdf" });

            // Update status in DB
            if (draft.draftId) {
                await updateDraftStatus(draft.draftId, "exported", {
                    sections: draft.sections,
                });
                setDisableGenerate(true);
            }

            toast.success("PDF가 준비되었습니다.");
        } catch {
            toast.error("PDF 내보내기에 실패했습니다.");
        }
    }, [draft]);

    const handleExportCda = useCallback(async () => {
        if (!draft) return;
        try {
            const result = await exportDraft(draft, "cda");
            setExportModal({ open: true, format: "cda", xmlContent: result.content });

            // Update status in DB
            if (draft.draftId) {
                await updateDraftStatus(draft.draftId, "exported", {
                    sections: draft.sections,
                });
                setDisableGenerate(true);
            }

            toast.success("CDA XML이 생성되었습니다.");
        } catch {
            toast.error("CDA XML 내보내기에 실패했습니다.");
        }
    }, [draft]);

    const handleSectionUpdate = useCallback(
        (sectionId: string, updates: Partial<Section>) => {
            setIsReviewed(false);
            setDraft((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    sections: prev.sections.map((s) =>
                        s.id === sectionId ? { ...s, ...updates } : s
                    ),
                };
            });
        },
        []
    );

    const handleRevert = useCallback((sectionId: string) => {
        setIsReviewed(false);
        setDraft((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                sections: prev.sections.map((s) => {
                    if (s.id !== sectionId) return s;
                    return {
                        ...s,
                        narrative: s.originalNarrative ?? s.narrative,
                        fields: s.originalFields
                            ? JSON.parse(JSON.stringify(s.originalFields))
                            : s.fields,
                        edited: false,
                    };
                }),
            };
        });
        toast.info("원본으로 복원되었습니다.");
    }, []);

    const handleToggleInclude = useCallback((sectionId: string) => {
        setIsReviewed(false);
        setDraft((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                sections: prev.sections.map((s) =>
                    s.id === sectionId ? { ...s, included: s.included === false } : s
                ),
            };
        });
    }, []);

    const handleToggleAll = useCallback((included: boolean) => {
        setIsReviewed(false);
        setDraft((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                sections: prev.sections.map((s) => ({ ...s, included })),
            };
        });
    }, []);

    const handleIssueClick = useCallback((issue: Issue) => {
        setHighlightedSectionId(issue.sectionId);
        setHighlightedFieldKey(issue.fieldKey);
        const el = document.getElementById(`section-${issue.sectionId}`);
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        setTimeout(() => {
            setHighlightedSectionId(undefined);
            setHighlightedFieldKey(undefined);
        }, 3000);
    }, []);

    const handleEvidenceClick = useCallback((_item: EvidenceItem) => {
        // opens modal inside EvidencePanel
    }, []);

    const currentPatient = patients.find((p) => p.id === patientId);

    return (
        <div className="flex h-full flex-col">
            <DraftHeaderBar
                docType={docType}
                patientId={patientId}
                patients={patients}
                range={range}
                onPatientChange={setPatientId}
                onRangeChange={setRange}
                onGenerate={handleGenerate}
                onValidate={handleValidate}
                onExportPdf={handleExportPdf}
                onExportCda={handleExportCda}
                isGenerating={isGenerating}
                isValidating={isValidating}
                hasDraft={draft !== null}
                disableGenerate={disableGenerate}
                onBack={onBack}
            />

            <ValidationBanner
                issues={validationIssues}
                onIssueClick={handleIssueClick}
            />

            <div className="flex flex-1 min-h-0 flex-col overflow-hidden xl:flex-row">
                {/* Left: Draft Editor */}
                <div className="min-h-0 flex-1 overflow-hidden border-b border-border xl:border-r xl:border-b-0">
                    <ScrollArea className="h-full">
                        <DraftEditor
                            sections={draft?.sections ?? []}
                            onSectionUpdate={handleSectionUpdate}
                            onRevert={handleRevert}
                            onToggleInclude={handleToggleInclude}
                            onToggleAll={handleToggleAll}
                            isLoading={isGenerating || isLoadingDraft}
                            highlightedSectionId={highlightedSectionId}
                            highlightedFieldKey={highlightedFieldKey}
                            docType={docType}
                            isReviewed={isReviewed}
                        />
                    </ScrollArea>
                </div>

                {/* Right: Evidence Panel */}
                <div className="h-[340px] shrink-0 overflow-hidden bg-card md:h-[380px] lg:h-[420px] xl:h-full xl:w-[380px]">
                    <EvidencePanel
                        evidence={draft?.evidence ?? []}
                        trajectory={docType === "summary" ? trajectory : undefined}
                        docType={docType}
                        onEvidenceClick={handleEvidenceClick}
                    />
                </div>
            </div>

            <ExportModal
                isOpen={exportModal.open}
                onClose={() => setExportModal({ open: false, format: "pdf" })}
                format={exportModal.format}
                xmlContent={exportModal.xmlContent}
                sections={draft?.sections}
                docType={docType}
                patientName={currentPatient?.name}
            />
        </div>
    );
}
