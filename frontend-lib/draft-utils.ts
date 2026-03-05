import type { Draft, Issue } from "./auto-draft-types";

export async function validateDraft(
  draft: Draft,
  options?: { reviewed?: boolean }
): Promise<Issue[]> {
  const issues: Issue[] = [];

  // 1. Check Recipient Name (referral only)
  if (draft.docType === "referral") {
    const recipientSection = draft.sections.find((s) => s.id === "recipient");
    if (recipientSection) {
      const orgNameField = recipientSection.fields.find(
        (f) => f.key === "recvOrgName"
      );
      if (orgNameField && !orgNameField.value?.trim()) {
        issues.push({
          id: "V001",
          severity: "error",
          message: "필수 필드 누락: 수신 기관명이 비어있습니다.",
          sectionId: "recipient",
          fieldKey: "recvOrgName",
        });
      }
    }
  }

  // 2. Check Dates — referralDate vs admissionDate from draft sections
  const headerSection = draft.sections.find((s) => s.id === "header");
  if (headerSection) {
    const referralDateField = headerSection.fields.find(
      (f) => f.key === "referralDate"
    );
    const admissionDateField = headerSection.fields.find(
      (f) => f.key === "admissionDate"
    );

    if (referralDateField?.value && admissionDateField?.value) {
      const refDate = new Date(referralDateField.value);
      const admDate = new Date(admissionDateField.value);

      if (!isNaN(refDate.getTime()) && !isNaN(admDate.getTime())) {
        const diffTime = refDate.getTime() - admDate.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          issues.push({
            id: "V002",
            severity: "error",
            message: `날짜 오류: 의뢰일이 입원일보다 ${Math.abs(diffDays)}일 빠릅니다.`,
            sectionId: "header",
            fieldKey: "referralDate",
          });
        } else if (diffDays > 365) {
          issues.push({
            id: "V002",
            severity: "warning",
            message: `날짜 확인: 입원 기간이 1년(${diffDays}일)을 초과했습니다.`,
            sectionId: "header",
            fieldKey: "referralDate",
          });
        }
      }
    }
  }

  return issues;
}

export async function exportDraft(
  draft: Draft,
  format: "pdf" | "cda"
): Promise<{ success: boolean; content?: string }> {
  if (format === "cda") {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <templateId root="2.16.840.1.113883.10.20.22.1.1"/>
  <id root="2.16.840.1.113883.19.5.99999.1" extension="${draft.docType}-${draft.patientId}"/>
  <code code="34133-9" displayName="${draft.docType}" codeSystem="2.16.840.1.113883.6.1"/>
  <title>${draft.docType.toUpperCase()} - Patient ${draft.patientId}</title>
  <effectiveTime value="${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}"/>
  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>
  <recordTarget>
    <patientRole>
      <id extension="${draft.patientId}"/>
    </patientRole>
  </recordTarget>
  <component>
    <structuredBody>
${draft.sections
        .map(
          (s) => `      <component>
        <section>
          <title>${s.title}</title>
          <text>${s.narrative || s.fields.map((f) => `${f.label}: ${f.value}`).join("; ")}</text>
        </section>
      </component>`
        )
        .join("\n")}
    </structuredBody>
  </component>
</ClinicalDocument>`;
    return { success: true, content: xml };
  }
  return { success: true };
}
