import { GI_WATERBORNE_CHECKLIST, GI_WATERBORNE_CHECKLIST_DEFINITIONS } from "@/lib/checklists/datasets/gi_waterborne"
import { MDRO_CHECKLIST_DEFINITIONS } from "@/lib/checklists/datasets/mdro"
import {
  RESP_ISOLATION_CHECKLIST,
  RESP_ISOLATION_CHECKLIST_DEFINITIONS,
} from "@/lib/checklists/datasets/resp_isolation"
import type {
  ChecklistDefinition,
  ChecklistItemDef,
  ChecklistItemStateValue,
  ChecklistMode,
  ChecklistProgress,
  ChecklistState,
  ChecklistType,
  SectionProgress,
} from "@/lib/checklists/types"

export type {
  ChecklistDefinition,
  ChecklistItemDef,
  ChecklistItemStateValue,
  ChecklistItemType,
  ChecklistLevel,
  ChecklistMode,
  ChecklistProgress,
  ChecklistRoleTag,
  ChecklistSectionDef,
  ChecklistSectionId,
  ChecklistSource,
  ChecklistState,
  ChecklistType,
  ChecklistUiMeta,
  PrecautionType,
  SectionProgress,
} from "@/lib/checklists/types"

export { GI_WATERBORNE_CHECKLIST, RESP_ISOLATION_CHECKLIST }

export const CHECKLIST_REGISTRY: Record<ChecklistType, Record<ChecklistMode, ChecklistDefinition>> = {
  MDRO: {
    suspected: MDRO_CHECKLIST_DEFINITIONS.suspected,
    confirmed: MDRO_CHECKLIST_DEFINITIONS.confirmed,
  },
  GI_WATERBORNE: {
    suspected: GI_WATERBORNE_CHECKLIST_DEFINITIONS.suspected,
    confirmed: GI_WATERBORNE_CHECKLIST_DEFINITIONS.confirmed,
  },
  RESP_ISOLATION: {
    suspected: RESP_ISOLATION_CHECKLIST_DEFINITIONS.suspected,
    confirmed: RESP_ISOLATION_CHECKLIST_DEFINITIONS.confirmed,
  },
}

export function getChecklistDefinition(
  checklistType: ChecklistType,
  mode: ChecklistMode
): ChecklistDefinition {
  return CHECKLIST_REGISTRY[checklistType][mode]
}

export const CHECKLIST_TYPE_LABELS: Record<ChecklistType, string> = {
  MDRO: "MDRO",
  GI_WATERBORNE: "GI_WATERBORNE(수인성·식품매개/장관감염)",
  RESP_ISOLATION: "RESP_ISOLATION(호흡기 격리 필요 질병)",
}

export const CHECKLIST_TYPE_OPTIONS: Array<{ value: ChecklistType; label: string }> = [
  { value: "MDRO", label: CHECKLIST_TYPE_LABELS.MDRO },
  { value: "GI_WATERBORNE", label: CHECKLIST_TYPE_LABELS.GI_WATERBORNE },
  { value: "RESP_ISOLATION", label: CHECKLIST_TYPE_LABELS.RESP_ISOLATION },
]

export function flattenChecklistItems(definition: ChecklistDefinition): ChecklistItemDef[] {
  return definition.sections.flatMap((section) => section.levels.flatMap((level) => level.items))
}

export function isItemRequiredInMode(item: ChecklistItemDef, mode: ChecklistMode): boolean {
  return Boolean(item.required_in_modes?.includes(mode))
}

export function isItemVisibleInMode(item: ChecklistItemDef, mode: ChecklistMode): boolean {
  if (!item.visible_in_modes || item.visible_in_modes.length === 0) return true
  return item.visible_in_modes.includes(mode)
}

export function isItemVisibleToNurse(item: ChecklistItemDef): boolean {
  if (!item.role_tags || item.role_tags.length === 0) return true
  return item.role_tags.includes("NURSE_ACTION")
}

export function isItemRecommendedInMode(item: ChecklistItemDef, mode: ChecklistMode): boolean {
  return Boolean(item.recommended_in_modes?.includes(mode))
}

export function isCheckboxChecked(value: ChecklistItemStateValue | undefined): boolean {
  return value === true
}

function isCountableCheckbox(item: ChecklistItemDef, mode: ChecklistMode): boolean {
  return item.item_type === "checkbox" && isItemRequiredInMode(item, mode)
}

export function computeChecklistProgress(
  definition: ChecklistDefinition,
  state: ChecklistState
): ChecklistProgress {
  const countableItems = flattenChecklistItems(definition).filter((item) =>
    isCountableCheckbox(item, definition.mode)
  )
  const checked = countableItems.reduce((acc, item) => {
    return acc + (isCheckboxChecked(state[item.id]) ? 1 : 0)
  }, 0)
  const total = countableItems.length
  const percent = total > 0 ? Math.round((checked / total) * 100) : 0

  const sections: SectionProgress[] = definition.sections.map((section) => {
    const sectionItems = section.levels
      .flatMap((level) => level.items)
      .filter((item) => isCountableCheckbox(item, definition.mode))
    const sectionChecked = sectionItems.reduce((acc, item) => {
      return acc + (isCheckboxChecked(state[item.id]) ? 1 : 0)
    }, 0)
    const sectionTotal = sectionItems.length
    return {
      section_id: section.id,
      checked: sectionChecked,
      total: sectionTotal,
      percent: sectionTotal > 0 ? Math.round((sectionChecked / sectionTotal) * 100) : 0,
    }
  })

  return {
    checked,
    total,
    percent,
    complete: total > 0 && checked >= total,
    sections,
  }
}

export function formatPrecaution(definition: ChecklistDefinition): string {
  if (definition.precaution_combo && definition.precaution_combo.length > 0) {
    return definition.precaution_combo.join(" + ")
  }
  return definition.precaution_type
}

export function formatGapDuration(startIso: string, now: number = Date.now()): string {
  const start = new Date(startIso).getTime()
  if (Number.isNaN(start)) return "-"
  const diffMs = Math.max(0, now - start)
  const totalMinutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`
}
