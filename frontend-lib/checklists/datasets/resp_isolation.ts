import type {
  ChecklistDefinition,
  ChecklistItemDef,
  ChecklistLevel,
  ChecklistMode,
  ChecklistRoleTag,
  ChecklistSectionId,
} from "@/lib/checklists/types"

type RespMode = "suspected" | "confirmed"

type RespSectionItem = {
  item_id: string
  level: 0 | 1 | 2
  tag: ChecklistRoleTag
  label_ko: string
  default_required_by_mode: Record<RespMode, boolean>
}

type RespSection = {
  section_id: ChecklistSectionId
  title_ko: string
  items: RespSectionItem[]
}

type RespPathogen = {
  key: string
  name_ko: string
  precautions: string[]
  isolation_note?: string
  citations: string[]
  conditional_add_on?: Array<{
    when: string
    add: string[]
    note: string
  }>
}

export const RESP_ISOLATION_CHECKLIST = {
  checklist_id: "RESP_ISOLATION_V1",
  checklist_name_ko: "호흡기 감염병 격리 체크리스트(간호사용)",
  source_label: "2026년도 호흡기감염병 관리지침",
  scope_note:
    "본 체크리스트는 치료/오더 지시가 아니라, 전파 예방을 위한 격리·주의·운영 확인 항목입니다.",
  modes: ["suspected", "confirmed"],
  pathogens: [
    {
      key: "meningococcal_disease",
      name_ko: "수막구균 감염증",
      precautions: ["standard", "droplet"],
      isolation_note: "항생제 치료 시작 후 24시간까지 비말격리",
      citations: ["GUIDE_2026_RESP_P48", "GUIDE_2026_RESP_TABLE19"],
    },
    {
      key: "scarlet_fever",
      name_ko: "성홍열",
      precautions: ["standard", "droplet"],
      isolation_note: "적절한 항생제 치료 시작 후 24시간까지 비말격리",
      citations: ["GUIDE_2026_RESP_TABLE19"],
    },
    {
      key: "adenovirus",
      name_ko: "아데노바이러스 감염증",
      precautions: ["standard", "droplet", "contact"],
      citations: ["GUIDE_2026_RESP_TABLE19"],
    },
    {
      key: "bocavirus",
      name_ko: "사람보카바이러스 감염증",
      precautions: ["standard", "contact"],
      citations: ["GUIDE_2026_RESP_TABLE19"],
    },
    {
      key: "parainfluenza",
      name_ko: "파라인플루엔자 바이러스 감염증",
      precautions: ["standard", "droplet"],
      conditional_add_on: [
        { when: "infant_or_pediatric", add: ["contact"], note: "영유아 호흡기감염병인 경우 접촉주의 추가" },
      ],
      citations: ["GUIDE_2026_RESP_TABLE19"],
    },
    {
      key: "rsv",
      name_ko: "호흡기세포융합바이러스(RSV) 감염증",
      precautions: ["standard"],
      conditional_add_on: [
        { when: "infant_or_immunocompromised", add: ["contact"], note: "영유아 및 면역저하자에서 접촉주의 추가" },
      ],
      citations: ["GUIDE_2026_RESP_TABLE19"],
    },
    {
      key: "rhinovirus",
      name_ko: "리노바이러스 감염증",
      precautions: ["standard", "contact", "droplet"],
      citations: ["GUIDE_2026_RESP_TABLE19"],
    },
    {
      key: "hmpv",
      name_ko: "사람메타뉴모바이러스 감염증",
      precautions: ["standard", "droplet"],
      citations: ["GUIDE_2026_RESP_TABLE19"],
    },
    {
      key: "human_coronavirus",
      name_ko: "사람 코로나바이러스 감염증",
      precautions: ["standard"],
      conditional_add_on: [
        { when: "transmission_risk_high", add: ["contact"], note: "전파예방을 위해 접촉주의를 추가할 수 있음" },
      ],
      citations: ["GUIDE_2026_RESP_TABLE19"],
    },
    {
      key: "mycoplasma_pneumoniae",
      name_ko: "마이코플라스마 폐렴균 감염증",
      precautions: ["standard", "droplet"],
      citations: ["GUIDE_2026_RESP_TABLE19"],
    },
    {
      key: "chlamydia_pneumoniae",
      name_ko: "클라미디아 폐렴균 감염증",
      precautions: ["standard"],
      conditional_add_on: [
        {
          when: "outbreak_or_nosocomial",
          add: ["droplet"],
          note: "유행/원내 전파 시 비말주의 포함한 향상된 주의 가능",
        },
      ],
      citations: ["GUIDE_2026_RESP_P68"],
    },
  ],
  ui_sections: [
    {
      section_id: "A",
      title_ko: "격리 및 주의",
      items: [
        {
          item_id: "A_L0_01",
          level: 0,
          tag: "NURSE_ACTION",
          label_ko: "기침예절/마스크 착용 안내(환자/보호자)",
          default_required_by_mode: { suspected: true, confirmed: true },
        },
        {
          item_id: "A_L0_02",
          level: 0,
          tag: "NURSE_ACTION",
          label_ko: "환자 이동 최소화, 이동 시 환자 마스크",
          default_required_by_mode: { suspected: true, confirmed: true },
        },
        {
          item_id: "A_L1_01",
          level: 1,
          tag: "NURSE_ACTION",
          label_ko: "비말주의 적용(1인실/코호트, 의료진 마스크)",
          default_required_by_mode: { suspected: false, confirmed: true },
        },
        {
          item_id: "A_L1_02",
          level: 1,
          tag: "NURSE_ACTION",
          label_ko: "접촉주의 적용(1인실/코호트, 가운+장갑)",
          default_required_by_mode: { suspected: false, confirmed: true },
        },
        {
          item_id: "A_L2_01",
          level: 2,
          tag: "NURSE_ACTION",
          label_ko: "1인실 불가 시 대체조치(코호트/물리적 차단/거리두기)",
          default_required_by_mode: { suspected: false, confirmed: false },
        },
      ],
    },
    {
      section_id: "B",
      title_ko: "검사/이송/커뮤니케이션",
      items: [
        {
          item_id: "B_01",
          level: 0,
          tag: "NURSE_ACTION",
          label_ko: "검사/이송 전 ‘격리 필요’ 사전 공유(검사실/이송요원)",
          default_required_by_mode: { suspected: true, confirmed: true },
        },
        {
          item_id: "B_02",
          level: 1,
          tag: "NURSE_ACTION",
          label_ko: "수막구균/성홍열: 항생제 시작 시간 확인 → 24시간 비말격리 유지",
          default_required_by_mode: { suspected: false, confirmed: true },
        },
      ],
    },
    {
      section_id: "C",
      title_ko: "환경/물품/손위생",
      items: [
        {
          item_id: "C_01",
          level: 0,
          tag: "NURSE_ACTION",
          label_ko: "손위생/기침예절 교육 및 안내(보호자 포함)",
          default_required_by_mode: { suspected: true, confirmed: true },
        },
        {
          item_id: "C_02",
          level: 1,
          tag: "NURSE_ACTION",
          label_ko: "자주 접촉 표면 청소·소독 강화(기관 SOP)",
          default_required_by_mode: { suspected: false, confirmed: true },
        },
      ],
    },
    {
      section_id: "D",
      title_ko: "행정/교육(인수인계 포함)",
      items: [
        {
          item_id: "D_01",
          level: 0,
          tag: "NURSE_ACTION",
          label_ko: "교대/인수인계 시 격리 상태(주의 종류/대체조치) 공유",
          default_required_by_mode: { suspected: true, confirmed: true },
        },
      ],
    },
  ],
} as const

function levelToId(level: 0 | 1 | 2): ChecklistLevel {
  if (level === 1) return "L1"
  if (level === 2) return "L2"
  return "L0"
}

function toRequiredModes(item: RespSectionItem): ChecklistMode[] | undefined {
  const required: ChecklistMode[] = []
  if (item.default_required_by_mode.suspected) required.push("suspected")
  if (item.default_required_by_mode.confirmed) required.push("confirmed")
  return required.length > 0 ? required : undefined
}

function toRecommendedModes(item: RespSectionItem): ChecklistMode[] | undefined {
  if (item.level === 0) return undefined
  return item.default_required_by_mode.suspected ? undefined : ["suspected"]
}

function toCategoryTag(sectionId: ChecklistSectionId, label: string): string[] {
  if (label.includes("대체조치")) return ["alternative"]
  if (sectionId === "D") return ["admin"]
  return ["isolation"]
}

function toModeDefinition(mode: ChecklistMode): ChecklistDefinition {
  const itemsWithPathogenSelector: RespSection[] = RESP_ISOLATION_CHECKLIST.ui_sections.map((section) => {
    const normalizedItems: RespSectionItem[] = section.items.map((item) => ({
      item_id: item.item_id,
      level: item.level,
      tag: item.tag,
      label_ko: item.label_ko,
      default_required_by_mode: {
        suspected: item.default_required_by_mode.suspected,
        confirmed: item.default_required_by_mode.confirmed,
      },
    }))
    if (section.section_id !== "A") {
      return {
        section_id: section.section_id,
        title_ko: section.title_ko,
        items: normalizedItems,
      }
    }
    return {
      section_id: section.section_id,
      title_ko: section.title_ko,
      items: [
        {
          item_id: "RESP_PATHOGEN_SELECT",
          level: 0,
          tag: "NURSE_ACTION",
          label_ko: "의심/확진 병원체 프로파일 선택(해당 시)",
          default_required_by_mode: { suspected: false, confirmed: false },
        },
        ...normalizedItems,
      ],
    }
  })

  const sections = itemsWithPathogenSelector.map((section) => {
    const levels: ChecklistLevel[] = ["L0", "L1", "L2"]
    return {
      id: section.section_id,
      title: `${section.section_id}. ${section.title_ko}`,
      levels: levels
        .map((levelId) => {
          const levelItems = section.items
            .filter((item) => levelToId(item.level) === levelId)
            .map<ChecklistItemDef>((item) => {
              if (item.item_id === "RESP_PATHOGEN_SELECT") {
                return {
                  id: item.item_id,
                  label: item.label_ko,
                  section_id: section.section_id,
                  level: "L0",
                  item_type: "single_select",
                  tags: ["isolation"],
                  role_tags: ["NURSE_ACTION"],
                  options: RESP_ISOLATION_CHECKLIST.pathogens.map((pathogen) => ({
                    id: pathogen.key,
                    value: pathogen.key,
                    label: pathogen.name_ko,
                  })),
                  description: "병원체별 격리주의 조합은 기관 프로토콜을 우선 적용합니다.",
                }
              }
              return {
                id: item.item_id,
                label: item.label_ko,
                section_id: section.section_id,
                level: levelToId(item.level),
                item_type: "checkbox",
                required_in_modes: toRequiredModes(item),
                recommended_in_modes: toRecommendedModes(item),
                tags: toCategoryTag(section.section_id, item.label_ko),
                role_tags: [item.tag],
              }
            })
          return {
            id: levelId,
            title: `Level ${levelId.slice(1)}`,
            items: levelItems,
          }
        })
        .filter((level) => level.items.length > 0),
    }
  })

  return {
    checklist_type: "RESP_ISOLATION",
    mode,
    title: `${RESP_ISOLATION_CHECKLIST.checklist_name_ko} (${mode === "confirmed" ? "확진" : "의심"})`,
    display_name_ko: RESP_ISOLATION_CHECKLIST.checklist_name_ko,
    subtitle: mode === "confirmed" ? "확진 지침 기반 운영" : "의심 단계 선제 격리 운영",
    short_reason_line:
      mode === "confirmed"
        ? "RESP confirmed - Droplet 기본, 병원체/상황에 따라 Contact 추가"
        : "RESP suspected - Level 1/2는 추천 중심(강제 체크 없음)",
    precaution_type: "droplet",
    source_label: `출처: ${RESP_ISOLATION_CHECKLIST.source_label}`,
    sections,
  }
}

export const RESP_ISOLATION_CHECKLIST_DEFINITIONS = {
  suspected: toModeDefinition("suspected"),
  confirmed: toModeDefinition("confirmed"),
} as const
