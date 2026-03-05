"use client";

import { useState } from "react";
import { DraftsHome } from "@/components/auto-draft/drafts-home";
import { DraftDetail } from "@/components/auto-draft/draft-detail";
import type { DocType } from "@/lib/auto-draft-types";
import type { SavedDraftSummary } from "@/lib/draft-api-service";

interface Selection {
    docType: DocType;
    savedDraft?: SavedDraftSummary;
    initialPatientId?: string;
}

interface AutoDraftPageProps {
    showPageTitle?: boolean;
    initialDocType?: DocType;
    initialPatientId?: string;
}

export function AutoDraftPage({
    showPageTitle = true,
    initialDocType,
    initialPatientId,
}: AutoDraftPageProps) {
    const [selection, setSelection] = useState<Selection | null>(() =>
        initialDocType ? { docType: initialDocType, initialPatientId } : null
    );

    if (selection) {
        return (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <DraftDetail
                    docType={selection.docType}
                    onBack={() => setSelection(null)}
                    initialSavedDraft={selection.savedDraft}
                    initialPatientId={selection.initialPatientId}
                />
            </div>
        );
    }

    return (
        <div className="min-h-0 flex-1 overflow-auto">
            <DraftsHome
                onSelectDocType={(docType) => setSelection({ docType })}
                onOpenRecentDraft={(saved) =>
                    setSelection({ docType: saved.docType as DocType, savedDraft: saved })
                }
                showPageTitle={showPageTitle}
            />
        </div>
    );
}
