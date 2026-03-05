"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

const STORAGE_STEP_KEY = "look-demo-step"
const STORAGE_SHIFT_KEY = "look-demo-shift"

export const DEMO_MIN_STEP = 1
export const DEMO_MAX_STEP = 16
export const DEMO_SHIFTS = ["Day", "Evening", "Night"] as const

export type DemoShift = (typeof DEMO_SHIFTS)[number]

interface DemoClockContextValue {
  demoStep: number
  demoShift: DemoShift
  minStep: number
  maxStep: number
  isHydrated: boolean
  setDemoStep: (step: number) => void
  setDemoShift: (shift: DemoShift) => void
  nextStep: () => void
  prevStep: () => void
  resetDemoClock: () => void
}

const DemoClockContext = createContext<DemoClockContextValue | undefined>(undefined)

function clampDemoStep(step: number): number {
  if (!Number.isFinite(step)) return DEMO_MIN_STEP
  return Math.max(DEMO_MIN_STEP, Math.min(DEMO_MAX_STEP, Math.trunc(step)))
}

function normalizeDemoShift(value: string | null | undefined): DemoShift {
  if (value === "Day" || value === "Evening" || value === "Night") return value
  return "Day"
}

export function DemoClockProvider({ children }: { children: ReactNode }) {
  const [demoStep, setDemoStepState] = useState<number>(DEMO_MIN_STEP)
  const [demoShift, setDemoShiftState] = useState<DemoShift>("Day")
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    const storedStep = Number.parseInt(localStorage.getItem(STORAGE_STEP_KEY) ?? "", 10)
    const storedShift = localStorage.getItem(STORAGE_SHIFT_KEY)

    if (Number.isFinite(storedStep)) {
      setDemoStepState(clampDemoStep(storedStep))
    }
    setDemoShiftState(normalizeDemoShift(storedShift))
    setIsHydrated(true)
  }, [])

  useEffect(() => {
    if (!isHydrated) return
    localStorage.setItem(STORAGE_STEP_KEY, String(demoStep))
  }, [demoStep, isHydrated])

  useEffect(() => {
    if (!isHydrated) return
    localStorage.setItem(STORAGE_SHIFT_KEY, demoShift)
  }, [demoShift, isHydrated])

  const setDemoStep = useCallback((step: number) => {
    setDemoStepState(clampDemoStep(step))
  }, [])

  const setDemoShift = useCallback((shift: DemoShift) => {
    setDemoShiftState(normalizeDemoShift(shift))
  }, [])

  const nextStep = useCallback(() => {
    setDemoStepState((prev) => clampDemoStep(prev + 1))
  }, [])

  const prevStep = useCallback(() => {
    setDemoStepState((prev) => clampDemoStep(prev - 1))
  }, [])

  const resetDemoClock = useCallback(() => {
    setDemoStepState(DEMO_MIN_STEP)
    setDemoShiftState("Day")
  }, [])

  const value = useMemo<DemoClockContextValue>(
    () => ({
      demoStep,
      demoShift,
      minStep: DEMO_MIN_STEP,
      maxStep: DEMO_MAX_STEP,
      isHydrated,
      setDemoStep,
      setDemoShift,
      nextStep,
      prevStep,
      resetDemoClock,
    }),
    [demoShift, demoStep, isHydrated, nextStep, prevStep, resetDemoClock, setDemoShift, setDemoStep],
  )

  return <DemoClockContext.Provider value={value}>{children}</DemoClockContext.Provider>
}

export function useDemoClock() {
  const context = useContext(DemoClockContext)
  if (context === undefined) {
    throw new Error("useDemoClock must be used within a DemoClockProvider")
  }
  return context
}
