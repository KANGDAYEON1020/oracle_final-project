export type DemoShift = "Day" | "Evening" | "Night"

export interface DemoQueryParams {
  demoStep?: number | null
  demoShift?: DemoShift | null | string
}

function normalizeDemoStep(value: unknown): number | null {
  const num = Number(value)
  if (!Number.isInteger(num) || num < 1) return null
  return num
}

function normalizeDemoShift(value: unknown): DemoShift | null {
  const shift = String(value ?? "").trim()
  if (shift === "Day" || shift === "Evening" || shift === "Night") return shift
  return null
}

export function appendDemoParams(params: URLSearchParams, demo?: DemoQueryParams): void {
  const step = normalizeDemoStep(demo?.demoStep)
  const shift = normalizeDemoShift(demo?.demoShift)
  if (step != null) params.set("demoStep", String(step))
  if (shift) params.set("demoShift", shift)
}

export function buildPathWithQuery(path: string, params: URLSearchParams): string {
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

export function readDemoQueryFromStorage(): DemoQueryParams {
  if (typeof window === "undefined") return {}

  const stepRaw = window.localStorage.getItem("look-demo-step")
  const shiftRaw = window.localStorage.getItem("look-demo-shift")

  return {
    demoStep: normalizeDemoStep(stepRaw),
    demoShift: normalizeDemoShift(shiftRaw),
  }
}
