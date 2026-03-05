import type {
  ChecklistDefinition,
  ChecklistItemDef,
  ChecklistItemType,
  ChecklistLevel,
  ChecklistMode,
  ChecklistRoleTag,
  ChecklistSectionDef,
  ChecklistSectionId,
  ChecklistSource,
  ChecklistUiMeta,
  PrecautionType,
} from "@/lib/checklists/types"

interface ChecklistSchemaSectionLevel {
  level: 0 | 1 | 2
  title_ko: string
  description_ko?: string
}

interface ChecklistSchemaSection {
  id: ChecklistSectionId
  title_ko: string
  description_ko?: string
  levels?: ChecklistSchemaSectionLevel[]
}

interface ChecklistSchemaItem {
  id: string
  label: string
  item_type: ChecklistItemType
  section_id: ChecklistSectionId
  level?: 0 | 1 | 2
  required_in_modes?: ChecklistMode[]
  visible_in_modes?: ChecklistMode[]
  tags: ChecklistRoleTag[]
  options?: Array<{ value: string; label: string }>
  ui?: ChecklistUiMeta
}

interface ChecklistSchemaDefinition {
  checklist_type: "GI_WATERBORNE"
  display_name_ko: string
  default_precaution: PrecautionType
  source: ChecklistSource
  source_label: string
  sections: ChecklistSchemaSection[]
  items: ChecklistSchemaItem[]
}

function toChecklistLevel(level?: 0 | 1 | 2): ChecklistLevel {
  if (level === 1) return "L1"
  if (level === 2) return "L2"
  return "L0"
}

function resolveCategoryTags(item: ChecklistSchemaItem): string[] {
  if (item.id.includes("_ALT_")) return ["alternative"]
  if (item.id === "GI_A2_ALT_MEASURES") return ["alternative"]
  if (item.section_id === "C" || item.section_id === "D" || item.item_type === "note") return ["admin"]
  return ["isolation"]
}

function isSchemaItemVisibleInMode(item: ChecklistSchemaItem, mode: ChecklistMode): boolean {
  if (!item.visible_in_modes || item.visible_in_modes.length === 0) return true
  return item.visible_in_modes.includes(mode)
}

function toChecklistDefinition(
  schema: ChecklistSchemaDefinition,
  mode: ChecklistMode
): ChecklistDefinition {
  const modeLabel = mode === "confirmed" ? "확진" : "의심"
  const modeSubtitle = mode === "confirmed" ? "지침" : "권고/선제"
  const modeReason = mode === "confirmed" ? "required" : "recommended"
  const levelOrder: ChecklistLevel[] = ["L0", "L1", "L2"]

  const sections: ChecklistSectionDef[] = schema.sections
    .map((section) => {
      const visibleItems = schema.items.filter(
        (item) => item.section_id === section.id && isSchemaItemVisibleInMode(item, mode)
      )
      const sectionLevelLabels = new Map<ChecklistLevel, ChecklistSchemaSectionLevel>()
      for (const level of section.levels ?? []) {
        sectionLevelLabels.set(toChecklistLevel(level.level), level)
      }
      const itemLevels = new Set<ChecklistLevel>(visibleItems.map((item) => toChecklistLevel(item.level)))
      const levels = levelOrder
        .filter((levelId) => sectionLevelLabels.has(levelId) || itemLevels.has(levelId))
        .map((levelId) => {
          const levelMeta = sectionLevelLabels.get(levelId)
          const levelItems = visibleItems
            .filter((item) => toChecklistLevel(item.level) === levelId)
            .map<ChecklistItemDef>((item) => {
              const requiredInModes = item.required_in_modes
              const isRequiredInSuspected = Boolean(requiredInModes?.includes("suspected"))
              const recommendedInModes: ChecklistMode[] | undefined =
                (levelId === "L1" || levelId === "L2") && !isRequiredInSuspected
                  ? ["suspected"]
                  : undefined
              return {
                id: item.id,
                label: item.label,
                section_id: item.section_id,
                level: levelId,
                item_type: item.item_type,
                description: item.ui?.helper_text,
                required_in_modes: requiredInModes,
                visible_in_modes: item.visible_in_modes,
                recommended_in_modes: recommendedInModes,
                tags: resolveCategoryTags(item),
                role_tags: item.tags,
                options: item.options?.map((option) => ({
                  value: option.value,
                  id: option.value,
                  label: option.label,
                })),
                ui: item.ui,
                placeholder: item.item_type === "note" ? "메모를 입력하세요" : undefined,
              }
            })
          return {
            id: levelId,
            title: levelMeta?.title_ko ?? `Level ${levelId.slice(1)}`,
            description: levelMeta?.description_ko,
            items: levelItems,
          }
        })
        .filter((level) => level.items.length > 0)
      return {
        id: section.id,
        title: section.title_ko,
        description: section.description_ko,
        levels,
      }
    })
    .filter((section) => section.levels.length > 0)

  return {
    checklist_type: schema.checklist_type,
    mode,
    title: `${schema.display_name_ko} (${modeLabel})`,
    display_name_ko: schema.display_name_ko,
    subtitle: `${modeSubtitle} 감염관리 체크리스트`,
    short_reason_line: `${schema.display_name_ko} - ${schema.default_precaution} precautions ${modeReason}`,
    precaution_type: schema.default_precaution,
    source: schema.source,
    source_label: schema.source_label,
    sections,
  }
}

export const GI_WATERBORNE_CHECKLIST: ChecklistSchemaDefinition = {
  checklist_type: "GI_WATERBORNE",
  display_name_ko: "수인성·식품매개(장관감염) 격리 체크리스트",
  default_precaution: "contact",
  source: {
    publisher: "질병관리청(KDCA)",
    title: "2026년도 수인성 및 식품매개감염병 관리지침",
    year: 2026,
    issued_at: "2026-01-02",
  },
  source_label: "질병관리청(KDCA) 『2026년도 수인성 및 식품매개감염병 관리지침』(2026-01-02)",
  sections: [
    {
      id: "A",
      title_ko: "A. 격리 및 접촉주의",
      description_ko: "설사/구토/황달 등 장관감염 의심 또는 확진 시, 병원 내 전파를 줄이기 위한 즉시 행동",
      levels: [
        { level: 0, title_ko: "Level 0. 표준주의 강화(공통)" },
        { level: 1, title_ko: "Level 1. 증상 기반 Contact 강화(간호 실행/확인)" },
        { level: 2, title_ko: "Level 2. 사건/자원/운영(대체조치·보고·참고)" },
      ],
    },
    {
      id: "B",
      title_ko: "B. 격리 해제 및 추적검사",
      description_ko: "확진(confirmed)에서만 필수 항목이 활성화되도록 설계(기관 프로토콜 우선)",
    },
    {
      id: "C",
      title_ko: "C. 행정/보고 및 커뮤니케이션",
      description_ko: "감염관리실 공유, 노출 최소화를 위한 부서 사전 공유 등",
    },
    {
      id: "D",
      title_ko: "D. 표현/안전 원칙",
      description_ko: "체크리스트는 처방/치료 지시가 아니라 감염관리 절차 확인 및 기록",
    },
  ],
  items: [
    {
      id: "GI_A0_RISK_GROUP_CHECK",
      label: "전파위험군 여부를 확인했다(급식/접객업, 의료·요양·보육·학교, 위생관리 어려움 등)",
      item_type: "multi_select",
      section_id: "A",
      level: 0,
      required_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
      options: [
        { value: "FOOD_SERVICE", label: "집단급식/식품접객업 종사자" },
        { value: "INSTITUTION", label: "의료/요양/보육/학교 등 직원·학생" },
        { value: "HYGIENE_DIFFICULT", label: "개인위생 관리 어려움(영유아/고령/중증 등)" },
        { value: "NONE", label: "해당 없음" },
        { value: "UNKNOWN", label: "확인 불가/미상" },
      ],
      ui: { helper_text: "전파위험군은 격리 해제/복귀 기준이 더 엄격할 수 있습니다." },
    },
    {
      id: "GI_A0_INIT_CONTACT_PRECAUTION",
      label: "증상 기반으로 접촉주의(Contact) 운영을 시작했다(병실/침상/동선 포함)",
      item_type: "checkbox",
      section_id: "A",
      level: 0,
      required_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_A0_HAND_HYGIENE_SOAP_WATER",
      label: "배설물/기저귀/오염물 처리 전후 손위생을 비누+물로 수행했다",
      item_type: "checkbox",
      section_id: "A",
      level: 0,
      required_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_A0_LIMIT_PATIENT_MOVEMENT",
      label: "환자 이동을 최소화했다(필요 검사/처치만) 및 이동 시 사전 안내했다",
      item_type: "checkbox",
      section_id: "A",
      level: 0,
      required_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_A0_PATIENT_DEDICATED_EQUIPMENT",
      label: "환자 전용 물품을 사용했거나, 공용 사용 후 즉시 소독을 확인했다",
      item_type: "checkbox",
      section_id: "A",
      level: 0,
      required_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_A1_SIGNAGE_CONTACT",
      label: "접촉주의 표식/안내를 적용(또는 적용 여부를 확인)했다",
      item_type: "checkbox",
      section_id: "A",
      level: 1,
      required_in_modes: ["confirmed"],
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
      ui: { helper_text: "의심 단계에서는 권고(필수 아님). 확진 단계에서는 필수로 운영 가능." },
    },
    {
      id: "GI_A1_PPE_GOWN_GLOVES",
      label: "환자 처치/기저귀 교체/오염물 처리/환경 정리 시 장갑+가운 착용을 준수했다",
      item_type: "checkbox",
      section_id: "A",
      level: 1,
      required_in_modes: ["confirmed"],
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_A1_CLEAN_HIGH_TOUCH_DAILY_CONFIRM",
      label: "고접촉 표면 소독을 최소 1일 1회 이상 수행(또는 수행 요청/확인)했다",
      item_type: "checkbox",
      section_id: "A",
      level: 1,
      required_in_modes: ["confirmed"],
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
      ui: { helper_text: "침상난간/문손잡이/호출벨/테이블/변기 레버 등" },
    },
    {
      id: "GI_A1_CLEAN_AFTER_SOIL_EVENT_CONFIRM",
      label: "설사/구토 등 오염 발생 시 즉시 소독을 수행(또는 요청/확인)했다",
      item_type: "checkbox",
      section_id: "A",
      level: 1,
      required_in_modes: ["confirmed"],
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_A1_REMOVE_SOIL_BEFORE_DISINFECT",
      label: "소독 전 유기물(오염물) 제거 후 소독하도록 수행(또는 요청/확인)했다",
      item_type: "checkbox",
      section_id: "A",
      level: 1,
      required_in_modes: ["confirmed"],
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_A1_LINEN_SEPARATE",
      label: "구토물/대변 등으로 오염된 린넨/의류를 오염세탁물로 분리 처리했다",
      item_type: "checkbox",
      section_id: "A",
      level: 1,
      required_in_modes: ["confirmed"],
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_A1_PATIENT_GUARDIAN_EDU",
      label: "환자/보호자에게 병실 이탈 제한, 손위생, 음식 조리 금지/방문 제한을 교육했다",
      item_type: "checkbox",
      section_id: "A",
      level: 1,
      required_in_modes: ["confirmed"],
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_A2_ROOM_TOILET_PREFERRED",
      label: "가능하면 화장실 포함 1인실(또는 전용 화장실 접근)로 배치했다(불가 시 대체조치 기록)",
      item_type: "checkbox",
      section_id: "A",
      level: 2,
      required_in_modes: ["confirmed"],
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_A2_ALT_MEASURES",
      label: "격리실/전용 화장실 불가 시 대체조치를 선택/기록했다",
      item_type: "multi_select",
      section_id: "A",
      level: 2,
      required_in_modes: ["confirmed"],
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
      options: [
        { value: "COHORT", label: "코호트(동일 증상/동일 원인 의심 환자끼리) 검토" },
        { value: "COMMODE", label: "전용 변기(Commode) 사용" },
        { value: "BARRIER", label: "물리적 차단(커튼/구획)" },
        { value: "FLOW_SEPARATION", label: "동선 분리/이동 최소화" },
        { value: "DEDICATED_ITEMS", label: "전용 물품 사용 강화" },
      ],
      ui: { helper_text: "대체조치는 선택/해제 시 자동 로그로 남기세요." },
    },
    {
      id: "GI_A2_NOTIFY_ICP",
      label: "감염관리실(ICP)에 의심/확진 발생 사실을 공유했다",
      item_type: "checkbox",
      section_id: "A",
      level: 2,
      required_in_modes: ["confirmed"],
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_A2_INFO_DISINFECT_SPEC",
      label: "참고(소독 프로토콜): 염소계 소독제 농도/접촉시간/희석·혼합 금지/24시간 내 사용 등은 기관 프로토콜 및 감염관리실 지침을 따른다",
      item_type: "info",
      section_id: "A",
      level: 2,
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["ICP_ACTION"],
      ui: { default_collapsed: true },
    },
    {
      id: "GI_B_CONFIRM_RELEASE_PROTOCOL_CHECK",
      label: "격리 해제/복귀 기준은 ‘기관 프로토콜 + 감염관리실 확인’에 따라 적용했다",
      item_type: "checkbox",
      section_id: "B",
      required_in_modes: ["confirmed"],
      visible_in_modes: ["confirmed"],
      tags: ["NURSE_ACTION"],
      ui: { helper_text: "질환별(콜레라/장티푸스/이질/EHEC/A형간염 등) 기준이 다를 수 있습니다." },
    },
    {
      id: "GI_B_RISK_GROUP_CLEARANCE_CONFIRM",
      label: "전파위험군인 경우, 추적검사(배양/PCR 등) 및 음성 확인 필요 여부를 감염관리실과 확인했다",
      item_type: "checkbox",
      section_id: "B",
      required_in_modes: ["confirmed"],
      visible_in_modes: ["confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_B_SAMPLE_COLLECTION_ORDERED",
      label: "의사 오더에 따라 검체 채취(대변/직장도말 등)를 지체 없이 수행했다",
      item_type: "checkbox",
      section_id: "B",
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
      ui: { helper_text: "의심 단계에서도 검체 오더가 있으면 수행합니다." },
    },
    {
      id: "GI_B_INFO_DISEASE_SPECIFIC_RELEASE",
      label: "참고(질환별): 전파위험군 음성 확인 횟수/간격은 질환별로 상이할 수 있으므로 지침/기관 프로토콜을 따른다",
      item_type: "info",
      section_id: "B",
      visible_in_modes: ["confirmed"],
      tags: ["ICP_ACTION"],
      ui: { default_collapsed: true },
    },
    {
      id: "GI_C_NOTIFY_TRANSPORT_LAB",
      label: "검사/이송(영상·내시경 등) 필요 시, 관련 부서에 ‘격리 필요한 의심/확진 환자’임을 사전 공유했다",
      item_type: "checkbox",
      section_id: "C",
      required_in_modes: ["confirmed"],
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_C_REPORTING_CHECK",
      label: "법정감염병 신고/행정 절차는 감염관리실(또는 기관 프로토콜)에 따라 확인했다",
      item_type: "checkbox",
      section_id: "C",
      required_in_modes: ["confirmed"],
      visible_in_modes: ["confirmed"],
      tags: ["NURSE_ACTION"],
      ui: { helper_text: "등급/신고 요건은 연도·질환별로 달라질 수 있어 기관 확인이 안전합니다." },
    },
    {
      id: "GI_D_NO_TREATMENT_ORDER",
      label: "본 체크리스트는 처방/치료 지시가 아닌 ‘감염관리 절차 확인 및 기록’임을 이해했다",
      item_type: "checkbox",
      section_id: "D",
      required_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_D_WORDING_RULES",
      label: "의심 단계에서는 ‘가능성/의심’으로 표기하고, ‘확진’은 검사 근거가 있을 때만 사용한다",
      item_type: "checkbox",
      section_id: "D",
      required_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
    },
    {
      id: "GI_D_SOURCE_FOOTER",
      label: "출처: 질병관리청(KDCA) 『2026년도 수인성 및 식품매개감염병 관리지침』",
      item_type: "info",
      section_id: "D",
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["ICP_ACTION"],
      ui: { default_collapsed: false },
    },
    {
      id: "GI_NOTE_MEMO",
      label: "메모(추가 조치/요청/특이사항)",
      item_type: "note",
      section_id: "D",
      visible_in_modes: ["suspected", "confirmed"],
      tags: ["NURSE_ACTION"],
      ui: { helper_text: "예: 전용 변기 준비 완료, 환경팀 소독 요청(시간), 감염관리실 공유 완료 등" },
    },
  ],
}

export const GI_WATERBORNE_CHECKLIST_DEFINITIONS = {
  suspected: toChecklistDefinition(GI_WATERBORNE_CHECKLIST, "suspected"),
  confirmed: toChecklistDefinition(GI_WATERBORNE_CHECKLIST, "confirmed"),
} as const
