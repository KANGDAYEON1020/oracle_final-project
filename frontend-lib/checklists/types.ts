export type ChecklistType = "MDRO" | "GI_WATERBORNE" | "RESP_ISOLATION"
export type ChecklistMode = "suspected" | "confirmed"
export type PrecautionType = "standard" | "contact" | "droplet" | "airborne"
export type ChecklistItemType = "checkbox" | "multi_select" | "single_select" | "note" | "info"
export type ChecklistLevel = "L0" | "L1" | "L2"
export type ChecklistSectionId = "A" | "B" | "C" | "D"
export type ChecklistRoleTag = "NURSE_ACTION" | "ICP_ACTION"

export interface ChecklistOptionDef {
  value?: string
  id?: string
  label: string
}

export interface ChecklistUiMeta {
  helper_text?: string
  default_collapsed?: boolean
}

export interface ChecklistSource {
  publisher: string
  title: string
  year: number
  issued_at?: string
  ref_url?: string
}

export interface ChecklistItemDef {
  id: string
  label: string
  section_id: ChecklistSectionId
  level: ChecklistLevel
  item_type: ChecklistItemType
  description?: string
  required_in_modes?: ChecklistMode[]
  visible_in_modes?: ChecklistMode[]
  recommended_in_modes?: ChecklistMode[]
  tags?: string[]
  role_tags?: ChecklistRoleTag[]
  options?: ChecklistOptionDef[]
  placeholder?: string
  ui?: ChecklistUiMeta
}

export interface ChecklistLevelDef {
  id: ChecklistLevel
  title: string
  description?: string
  items: ChecklistItemDef[]
}

export interface ChecklistSectionDef {
  id: ChecklistSectionId
  title: string
  description?: string
  levels: ChecklistLevelDef[]
}

export interface ChecklistDefinition {
  checklist_type: ChecklistType
  mode: ChecklistMode
  title: string
  display_name_ko?: string
  subtitle?: string
  short_reason_line?: string
  precaution_type: PrecautionType
  precaution_combo?: PrecautionType[]
  source?: ChecklistSource
  source_label?: string
  sections: ChecklistSectionDef[]
}

export type ChecklistItemStateValue = boolean | string[] | string
export type ChecklistState = Record<string, ChecklistItemStateValue | undefined>

export interface SectionProgress {
  section_id: ChecklistSectionId
  checked: number
  total: number
  percent: number
}

export interface ChecklistProgress {
  checked: number
  total: number
  percent: number
  complete: boolean
  sections: SectionProgress[]
}
