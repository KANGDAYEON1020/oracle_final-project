/**
 * useExplainStore - 환자 상세(Explain) 화면 전역 상태
 * 아키텍처 문서 § 4.2 상태 구조 + § 4.3 동기화 규칙 기준
 *
 * Zustand 미사용 환경이므로 React useReducer + Context 패턴으로 구현
 */
"use client"

import { createContext, useContext, useReducer, useCallback, useMemo } from "react"
import type { ReactNode } from "react"
import type {
  PatientExplainPayload,
  ExplainEvent,
  StripBin,
  RangeType,
  AxisType,
  SeverityLevel,
} from "@/lib/explain-types"
import type { DemoQueryParams } from "@/lib/demo-query"

// ── 필터 구조 ────────────────────────────────────────

export interface ExplainFilter {
  time_bin: string | null       // ISO-8601 bin_start
  axis: AxisType | null
  severity: SeverityLevel[]
  show_context: boolean
}

const DEFAULT_FILTER: ExplainFilter = {
  time_bin: null,
  axis: null,
  severity: [],
  show_context: true,
}

// ── 상태 구조 (§ 4.2) ─────────────────────────────

export interface ExplainState {
  // 서버 데이터
  payload: PatientExplainPayload | null
  loading: boolean
  error: string | null

  // UI 상태
  selectedEventId: string | null
  filter: ExplainFilter
  hoveredBin: string | null
  range: RangeType
}

// ── Action ────────────────────────────────────────

type Action =
  | { type: "LOAD_START"; range: RangeType }
  | { type: "LOAD_SUCCESS"; payload: PatientExplainPayload }
  | { type: "LOAD_ERROR"; error: string }
  | { type: "SELECT_EVENT"; eventId: string | null }
  | { type: "SET_FILTER_TIME_BIN"; bin: string | null }
  | { type: "SET_FILTER_AXIS"; axis: AxisType | null }
  | { type: "SET_FILTER_SEVERITY"; severity: SeverityLevel[] }
  | { type: "TOGGLE_SHOW_CONTEXT" }
  | { type: "SET_HOVERED_BIN"; bin: string | null }
  | { type: "RESET_FILTERS" }

// ── Reducer ───────────────────────────────────────

function reducer(state: ExplainState, action: Action): ExplainState {
  switch (action.type) {
    case "LOAD_START":
      return {
        ...state,
        loading: true,
        error: null,
        range: action.range,
        // range 변경 시 모든 UI 상태 초기화 (§ 4.3)
        selectedEventId: null,
        filter: DEFAULT_FILTER,
        hoveredBin: null,
      }

    case "LOAD_SUCCESS":
      return {
        ...state,
        loading: false,
        payload: action.payload,
        error: null,
      }

    case "LOAD_ERROR":
      return {
        ...state,
        loading: false,
        error: action.error,
      }

    case "SELECT_EVENT":
      return { ...state, selectedEventId: action.eventId }

    case "SET_FILTER_TIME_BIN":
      return { ...state, filter: { ...state.filter, time_bin: action.bin } }

    case "SET_FILTER_AXIS":
      return { ...state, filter: { ...state.filter, axis: action.axis } }

    case "SET_FILTER_SEVERITY":
      return { ...state, filter: { ...state.filter, severity: action.severity } }

    case "TOGGLE_SHOW_CONTEXT":
      return {
        ...state,
        filter: { ...state.filter, show_context: !state.filter.show_context },
      }

    case "SET_HOVERED_BIN":
      return { ...state, hoveredBin: action.bin }

    case "RESET_FILTERS":
      return { ...state, filter: DEFAULT_FILTER, selectedEventId: null }

    default:
      return state
  }
}

// ── 파생 값 계산 (§ 4.2 computed) ────────────────────

function deriveFilteredEvents(state: ExplainState): ExplainEvent[] {
  if (!state.payload) return []
  const { events, context_events } = state.payload
  const base: ExplainEvent[] = state.filter.show_context
    ? [...events, ...context_events]
    : [...events]

  let result = base

  // axis 필터
  if (state.filter.axis) {
    result = result.filter((e) => e.axis === state.filter.axis)
  }

  // time_bin 필터
  if (state.filter.time_bin) {
    result = result.filter((e) => e.time_bin === state.filter.time_bin)
  }

  // severity 필터
  if (state.filter.severity.length > 0) {
    result = result.filter((e) => state.filter.severity.includes(e.severity))
  }

  return result
}

// ── Context ───────────────────────────────────────

interface ExplainContextValue {
  state: ExplainState
  filteredEvents: ExplainEvent[]
  selectedEvent: ExplainEvent | null
  activeStrip: StripBin | null

  // 액션 디스패처
  loadPayload: (
    patientId: string,
    range?: RangeType,
    options?: boolean | (DemoQueryParams & { showContext?: boolean }),
  ) => Promise<void>
  selectEvent: (eventId: string | null) => void
  setFilterTimeBin: (bin: string | null) => void
  setFilterAxis: (axis: AxisType | null) => void
  setFilterSeverity: (severity: SeverityLevel[]) => void
  toggleShowContext: () => void
  setHoveredBin: (bin: string | null) => void
  resetFilters: () => void

  // AxisCard 클릭 핸들러 (§ 4.3)
  handleAxisCardClick: (axis: AxisType, topEventId: string | null) => void
  // StripBin 클릭 핸들러 (§ 4.3)
  handleStripBinClick: (bin: string) => void
}

const ExplainContext = createContext<ExplainContextValue | null>(null)

// ── Provider ──────────────────────────────────────

const INITIAL_STATE: ExplainState = {
  payload: null,
  loading: false,
  error: null,
  selectedEventId: null,
  filter: DEFAULT_FILTER,
  hoveredBin: null,
  range: "72h",
}

export function ExplainProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)

  // 파생 값
  const filteredEvents = useMemo(() => deriveFilteredEvents(state), [state])
  const selectedEvent = useMemo(
    () => (state.selectedEventId ? filteredEvents.find((e) => e.event_id === state.selectedEventId) ?? null : null),
    [filteredEvents, state.selectedEventId],
  )
  const activeStrip = useMemo(() => {
    if (!state.payload || !selectedEvent) return null
    return state.payload.trajectory_strip.find((b) => b.bin_start === selectedEvent.time_bin) ?? null
  }, [state.payload, selectedEvent])

  // payload 로딩
  const loadPayload = useCallback(
    async (
      patientId: string,
      range: RangeType = "72h",
      options?: boolean | (DemoQueryParams & { showContext?: boolean }),
    ) => {
      const showContext =
        typeof options === "boolean" ? options : options?.showContext ?? true
      const demo =
        typeof options === "object" && options !== null
          ? { demoStep: options.demoStep, demoShift: options.demoShift }
          : undefined

      dispatch({ type: "LOAD_START", range })
      try {
        const { fetchExplainPayload } = await import("@/lib/explain-api")
        const payload = await fetchExplainPayload(patientId, range, showContext, demo)
        dispatch({ type: "LOAD_SUCCESS", payload })

        // § 4.4 초기 로딩 시퀀스: 첫 issue_only 이벤트 자동 선택
        const firstEvent = payload.events.find(
          (e) => e.issue_only && ["high", "critical", "medium"].includes(e.severity),
        )
        if (firstEvent) {
          dispatch({ type: "SELECT_EVENT", eventId: firstEvent.event_id })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "데이터를 불러오는 중 오류가 발생했습니다."
        dispatch({ type: "LOAD_ERROR", error: msg })
      }
    },
    [],
  )

  // 이벤트 선택
  const selectEvent = useCallback((eventId: string | null) => {
    dispatch({ type: "SELECT_EVENT", eventId })
  }, [])

  // 필터 조작
  const setFilterTimeBin = useCallback((bin: string | null) => {
    dispatch({ type: "SET_FILTER_TIME_BIN", bin })
  }, [])

  const setFilterAxis = useCallback((axis: AxisType | null) => {
    dispatch({ type: "SET_FILTER_AXIS", axis })
  }, [])

  const setFilterSeverity = useCallback((severity: SeverityLevel[]) => {
    dispatch({ type: "SET_FILTER_SEVERITY", severity })
  }, [])

  const toggleShowContext = useCallback(() => {
    dispatch({ type: "TOGGLE_SHOW_CONTEXT" })
  }, [])

  const setHoveredBin = useCallback((bin: string | null) => {
    dispatch({ type: "SET_HOVERED_BIN", bin })
  }, [])

  const resetFilters = useCallback(() => {
    dispatch({ type: "RESET_FILTERS" })
  }, [])

  // AxisCard 클릭 (§ 4.3)
  const handleAxisCardClick = useCallback(
    (axis: AxisType, topEventId: string | null) => {
      dispatch({ type: "SET_FILTER_AXIS", axis })
      if (topEventId) dispatch({ type: "SELECT_EVENT", eventId: topEventId })
    },
    [],
  )

  // StripBin 클릭 (§ 4.3)
  const handleStripBinClick = useCallback(
    (bin: string) => {
      dispatch({ type: "SET_FILTER_TIME_BIN", bin })
      // 해당 bin의 첫 번째 이벤트 자동 선택
      if (state.payload) {
        const all = [...state.payload.events, ...state.payload.context_events]
        const first = all.find((e) => e.time_bin === bin)
        if (first) dispatch({ type: "SELECT_EVENT", eventId: first.event_id })
      }
    },
    [state.payload],
  )

  const value: ExplainContextValue = {
    state,
    filteredEvents,
    selectedEvent,
    activeStrip,
    loadPayload,
    selectEvent,
    setFilterTimeBin,
    setFilterAxis,
    setFilterSeverity,
    toggleShowContext,
    setHoveredBin,
    resetFilters,
    handleAxisCardClick,
    handleStripBinClick,
  }

  return <ExplainContext.Provider value={value}>{children}</ExplainContext.Provider>
}

// ── Hook ──────────────────────────────────────────

export function useExplainStore(): ExplainContextValue {
  const ctx = useContext(ExplainContext)
  if (!ctx) throw new Error("useExplainStore must be used within ExplainProvider")
  return ctx
}
