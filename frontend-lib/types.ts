export interface VitalSign {
  timestamp: string
  heartRate: number
  bloodPressureSystolic: number
  bloodPressureDiastolic: number
  oxygenSaturation: number
  temperature: number
  respiratoryRate: number
}

export interface LabResult {
  id: string
  category: string
  name: string
  value: string
  unit: string
  normalRange: string
  status: "normal" | "high" | "low" | "critical"
  date: string
}

export interface ImagingResult {
  id: string
  type: string
  date: string
  findings: string
  impression: string
  status: "normal" | "abnormal"
  // NLP-extracted data
  nlpTags?: NLPTag[]
  evidenceSnippet?: string
  highlightedText?: string
}

// NLP Feature Types
export type NLPTagType = "negation" | "uncertainty" | "trajectory" | "plan"
export type TrajectoryType = "worsening" | "improving" | "stable"

export interface NLPTag {
  type: NLPTagType
  label: string
  evidence: string // Source text snippet
  trajectory?: TrajectoryType
}

export interface DocumentComparison {
  prevDate: string
  currentDate: string
  prevText: string
  currentText: string
  trajectory: TrajectoryType
  keyChanges: string[]
  evidenceHighlights: { prev: string[]; current: string[] }
}

export interface TimelineEvent {
  id: string
  date: string
  type: "imaging" | "lab" | "note" | "culture"
  title: string
  summary: string
  nlpChips: { type: NLPTagType; label: string; evidence: string }[]
}

export interface KeywordTrend {
  keyword: string
  today: number
  yesterday: number
  change: number
}

export interface LLMSummary {
  overview: string
  notableChanges: string[]
  caveats: string
  generatedAt: string
}

// v2.0 Clinical Trajectory Types - Numeric 4-Axis Model
export type NumericAxisType = "respiratory" | "infection" | "clinicalAction" | "organDysfunction"
export type ChangeDirection = "up" | "down" | "stable"

// Individual data point with source document reference
export interface TrajectoryDataPoint {
  day: string
  value: number
  sourceDoc?: {
    type: "lab" | "nursing" | "cxr" | "order"
    id: string
    title: string
    date: string
  }
}

// Clinical Action breakdown for clinicalAction axis
export interface ClinicalActionBreakdown {
  notify: number
  prn: number
  monitoringChange: number
  newOrder: number
}

// New numeric trajectory axis
export interface NumericTrajectoryAxis {
  axis: NumericAxisType
  label: string
  unit: string
  currentValue: number
  prevValue: number
  change: ChangeDirection
  // For display
  displayValue: string
  // Supplementary data for hover/tooltip
  supplementary?: { label: string; value: string }[]
  // Last 5-7 values with source documents
  trendData: TrajectoryDataPoint[]
  // Status indicator color
  status: "normal" | "warning" | "critical"
  // Clinical Action breakdown (only for clinicalAction axis)
  actionBreakdown?: ClinicalActionBreakdown
  // Related NLP tags for conditional display (e.g., organDysfunction)
  relatedTags?: string[]
}

export interface NumericTrajectory {
  axes: NumericTrajectoryAxis[]
  // Respiratory Load Index (internal calculation)
  rli?: number
}

// SHAP-based Sepsis Explanation
export interface SHAPFactor {
  factor: string
  value: number // positive = risk increase, negative = risk decrease
  rawValue?: string // actual measurement value
  sourceDoc?: string
  changeDay?: string // e.g., "D3", "D5" - when the change occurred
}

export interface SepsisExplanation {
  riskScore: number // 0-1
  factors: SHAPFactor[]
  generatedAt: string
}

export interface PatientSepsisTrendPoint {
  time: string
  risk: number
  predictedAt?: string | null
}

export interface PatientSepsisSignal {
  signal: string
  score: number
  rawValue?: string | null
}

export interface PatientSepsisResponse {
  patientId: string
  admissionId: number
  source: "db" | "flask" | "none"
  riskScore: number | null
  riskLevel: string | null
  riskLevelUi: "HIGH" | "WARNING" | "LOW" | null
  predictedAt: string | null
  trend24h: PatientSepsisTrendPoint[]
  signals: PatientSepsisSignal[]
  recommendations: string[]
}

export interface PatientStatusSummaryResponse {
  patientId: string
  admissionId: number
  summary: string
  source: "openai" | "fallback"
  model: string
  generatedAt: string
  demoStep: number | null
  demoShift: "Day" | "Evening" | "Night" | null
  cached: boolean
}

// Ward-level SHAP summary
export interface WardSHAPSummary {
  avgRiskScore: number
  factors: { factor: string; avgValue: number; patientCount: number }[]
}

export interface Sepsis6Item {
  id: string
  label: string
  completed: boolean
  time?: string
}

// Legacy type alias for backward compatibility
export type AxisType = NumericAxisType
export interface TrajectoryAxis extends NumericTrajectoryAxis { }
export type WeeklyAxisType = "respiratory" | "infection" | "imaging" | "culture"
export interface WeeklyTrajectoryAxis {
  axis: WeeklyAxisType
  label: string
  currentValue: string
  prevValue: string
  change: ChangeDirection
  detail: string
  trendData: TrajectoryDataPoint[]
}
export interface WeeklyTrajectory {
  o2Change: ChangeDirection
  cxrChange: ChangeDirection
  cultureStatus: "positive" | "negative" | "pending"
  summary: string
  axes: WeeklyTrajectoryAxis[]
}

export interface CultureResult {
  id: string
  specimen: string
  date: string
  organism: string
  result: "positive" | "negative" | "pending"
  sensitivity?: string[]
}

export interface PSIData {
  age: number
  sex: "M" | "F"
  nursingHomeResident: boolean
  neoplasticDisease: boolean
  liverDisease: boolean
  chfHistory: boolean
  cerebrovascularDisease: boolean
  renalDisease: boolean
  alteredMentalStatus: boolean
  respiratoryRateHigh: boolean
  systolicBPLow: boolean
  temperatureAbnormal: boolean
  pulseHigh: boolean
  pHLow: boolean
  bunHigh: boolean
  sodiumLow: boolean
  glucoseHigh: boolean
  hematocritLow: boolean
  pO2Low: boolean
  pleuralEffusion: boolean
}

export interface ChecklistItem {
  id: string
  category: string
  label: string
  checked: boolean
  critical?: boolean
}

export interface PlaybookAction {
  id: string
  title: string
  description: string
  status: "pending" | "in-progress" | "completed"
  priority: "low" | "medium" | "high"
}

// =========================================================
// v2.0 Enhanced Timeline Event Types
// =========================================================

// Nursing Record - Time-flow observation log
export interface NursingRecordData {
  subjectiveComplaint?: string // 주관적 호소
  vitalSigns: {
    spO2: number
    o2Device?: string // NC, mask, HFNC, etc.
    o2Flow?: string // 2L, 4L, etc.
    temp: number
    hr?: number
    bp?: string
    rr?: number
  }
  interventions: {
    o2Escalation?: string // e.g., "2L→4L"
    nebulizer?: boolean
    suction?: boolean
    medication?: string[]
  }
  notify?: { count: number; reason?: string }
  newOrders?: string[]
}

// Doctor Note - Clinical judgment anchor
export interface DoctorNoteData {
  diagnosis: string[] // 진단명
  statusSummary: string // 상태 요약
  plan: string[] // 계획
  comparisonToPrev?: string // 이전 대비 판단
}

// CXR Report - Imaging snapshot
export interface CXRReportData {
  location: string // 부위 (RLL, LLL, bilateral, etc.)
  type: string // 유형 (consolidation, GGO, infiltration)
  extent: string // 범위 (focal, multifocal, diffuse)
  severity: "mild" | "moderate" | "severe"
  comparison?: string // 비교문구 (vs. prior, new, unchanged)
}

// Culture Result - Time-delayed confirmation event
export interface CultureResultData {
  specimen: string // 검체
  collectionTime: string // 채취 시점
  resultTime?: string // 결과 시점
  status: "pending" | "positive" | "negative"
  organism?: string // 균 동정
  resistance?: string[] // 내성 (MRSA, VRE, ESBL, etc.)
}

// Lab Result - Infection activity continuous indicator
export interface LabResultData {
  wbc: { value: number; status: "normal" | "high" | "low" }
  crp: { value: number; status: "normal" | "high" | "critical" }
  temp: { value: number; status: "normal" | "high" }
  // Optional but recommended
  lactate?: { value: number; status: "normal" | "high" | "critical" }
  creatinine?: { value: number; status: "normal" | "high" }
  platelet?: { value: number; status: "normal" | "low" | "critical" }
}

// Enhanced Timeline Event with structured data
export interface EnhancedTimelineEvent extends TimelineEvent {
  // Structured data based on type
  nursingData?: NursingRecordData
  doctorData?: DoctorNoteData
  cxrData?: CXRReportData
  cultureData?: CultureResultData
  labData?: LabResultData
}

// =========================================================
// Referral Note Auto-draft Types
// =========================================================
export interface ReferralNote {
  patientSummary: {
    age: number
    gender: "M" | "F"
    primaryDiagnosis: string
    admissionDate: string
    currentDay: number
  }
  trajectorySnapshot: {
    respiratory: { status: "normal" | "warning" | "critical"; summary: string }
    infection: { status: "normal" | "warning" | "critical"; summary: string }
    clinicalAction: { status: "normal" | "warning" | "critical"; summary: string }
    severity: { status: "normal" | "warning" | "critical"; summary: string }
  }
  recentResults: {
    labs: { date: string; key: string; value: string; status: string }[]
    imaging: { date: string; type: string; finding: string }[]
    culture: { date: string; specimen: string; result: string }[]
  }
  currentTreatment: {
    antibiotics: string[]
    oxygenTherapy?: string
    fluids?: string
    interventions?: string[]
  }
  transferReason: string[] // 근거 나열
  requestItems: string[] // 요청사항
  generatedAt: string
}

// =========================================================
// Guideline RAG for Confirmed Diagnosis
// =========================================================
export type GuidelineCategory = "checkNow" | "contraindication" | "transferCriteria"

export interface GuidelineItem {
  id: string
  category: GuidelineCategory
  text: string
  checked?: boolean
  critical?: boolean
  source?: string // 가이드라인 출처
}

export interface DiagnosisGuideline {
  diagnosis: string
  confirmedAt: string
  checkNow: GuidelineItem[] // 지금 꼭 확인할 5개
  contraindications: GuidelineItem[] // 금기/주의
  transferCriteria: GuidelineItem[] // 전원 고려 조건
}

// =========================================================
// MDRO Bed Assignment Types (Section 3.2)
// =========================================================
export type IsolationType = "contact" | "droplet" | "airborne" | "standard"
export type MDROType = "MRSA" | "VRE" | "CRE" | "ESBL" | "CPE" | "Acinetobacter" | "other"

export interface IsolationBed {
  id: string
  roomNumber: string
  bedNumber: string
  ward: string
  isolationType: IsolationType
  isOccupied: boolean
  currentPatient?: {
    id: string
    name: string
    mdroType?: MDROType
    gender: "M" | "F"
  }
  features: {
    negativePressure: boolean
    anteroom: boolean
    privateRoom: boolean
  }
}

export interface MDROBedRecommendation {
  bed: IsolationBed
  score: number // 0-100
  matchReasons: string[]
  warnings?: string[]
  cohortCompatible: boolean
}

export interface MDROBedAssignment {
  patientId: string
  patientName: string
  requiredIsolation: IsolationType
  mdroType?: MDROType
  gender: "M" | "F"
  recommendations: MDROBedRecommendation[]
  unavailableReasons: string[]
  generatedAt: string
}

// =========================================================
// Cluster / Outbreak Detection Types (Section 3.2)
// =========================================================
export interface ClusterAlert {
  id: string
  ward: string
  detectedAt: string
  type: "suspected" | "confirmed"
  mdroType?: MDROType
  patientCount: number
  patients: { id: string; name: string; roomNumber: string }[]
  commonFactors: string[]
  riskLevel: "low" | "medium" | "high"
  status: "active" | "monitoring" | "resolved"
}

// =========================================================
// Alert Fusion Types (Section 5.2.3)
// =========================================================
export type AlertPriority = "critical" | "high" | "medium" | "low" | "info"
export type AlertCategory = "mdro" | "respiratory" | "sepsis" | "cluster" | "isolation" | "lab" | "imaging"

export interface FusedAlert {
  id: string
  priority: AlertPriority
  category: AlertCategory
  title: string
  evidenceSnippet: string
  sourceDocuments: { type: string; date: string; summary: string }[]
  actionRequired?: string
  createdAt: string
}

// =========================================================
// Severity Engine Types (Section 3.5)
// =========================================================
export type SeverityLevel = "low" | "medium" | "high" | "critical"

export interface SeverityAssessment {
  level: SeverityLevel
  score: number // 0-100
  contributingFactors: {
    factor: string
    value: string
    impact: "positive" | "negative" | "neutral"
    weight: number
  }[]
  recommendedActions: {
    action: string
    priority: "immediate" | "urgent" | "routine"
    completed?: boolean
  }[]
  escalationTriggers: string[]
  generatedAt: string
}

// =========================================================
// Explain Panel Types (Sepsis-oriented clinical trajectory)
// =========================================================

// 3-axis Clinical Trajectory summary (5-7 day)
export type ExplainAxisId = "respiratory" | "infection" | "intervention"

export interface ExplainAxisEvent {
  text: string       // Fact-based, "observed/recorded" tone only
  timestamp?: string  // e.g. "24h", "48h", "D3"
}

export interface ExplainAxis {
  id: ExplainAxisId
  label: string
  summary: string       // One-line status summary
  events: ExplainAxisEvent[]
}

// Sepsis signal direction (no scores, no percentages)
export type SepsisSignalDirection = "rising" | "stable" | "declining"

export interface SepsisSignalSummary {
  direction: SepsisSignalDirection
  contributingFactors: string[]  // Top 3, text sentences only
}

// Early Response Checklist (confirmation/check only, not recommendation)
export interface EarlyResponseItem {
  id: string
  label: string
  checked: boolean
}

// Collapsible trend graph data point
export interface ExplainTrendPoint {
  day: string
  respiratory: number
  infection: number
  intervention: number
}

export interface ExplainData {
  axes: ExplainAxis[]
  sepsisSignal: SepsisSignalSummary
  earlyResponseChecklist: EarlyResponseItem[]
  trendGraph: ExplainTrendPoint[]
}

export type InfectionType = "MDRO" | "GI_WATERBORNE" | "RESP_ISOLATION"
export type TrajectoryRiskSeverity = "critical" | "high" | "medium" | "low" | "info"

export interface TrajectoryRiskPoint {
  dNumber: number
  shift: "Day" | "Evening" | "Night" | null
  severity: TrajectoryRiskSeverity
  score: number
  eventAt: string | null
}

export interface TrajectoryRiskSummary {
  maxSeverity: TrajectoryRiskSeverity
  latestSeverity: TrajectoryRiskSeverity
  eventCount: number
  lastEventAt: string | null
  riskTrend?: TrajectoryRiskPoint[]
  latestEventLabel?: string | null
  topIssueLabels?: string[]
}

export interface PatientDashboardSummary {
  highRiskPatientCount: number
  criticalPatientCount: number
  highRiskDelta: number
  criticalEventsCount: number
  criticalEventsRecent2h: number
  mdroUpdatedCount: number
  mdroBreakdown: {
    cre: number
    vre: number
    mrsa: number
    other: number
  }
  pendingResultsCount: number
  transferIcuCandidateCount: number
  transferClassification: {
    icu: number
    transfer: number
  }
}

export interface PatientDashboardSummaryResponse {
  meta: {
    patientCount: number
    admissionCount: number
    demoStep: number | null
    demoShift: "Day" | "Evening" | "Night" | null
    referenceNow: string | null
  }
  data: PatientDashboardSummary
}

export interface Patient {
  id: string
  name: string
  age: number
  gender: "M" | "F"
  roomNumber: string
  ward: string
  floor: string // New: floor level (1F, 2F, 3F, 5F)
  attendingDoctor: string // New: attending physician name
  attendingNurse?: string // New: attending nurse name
  admissionDate: string
  simAdmitDate?: string | null
  currentHd?: number | null
  demoStep?: number
  demoShift?: "Day" | "Evening" | "Night" | null
  demoDate?: string | null
  demoD?: number | null
  demoDayLabel?: string | null
  diagnosis: string
  primaryDisease: string // New: main disease for display
  status: "stable" | "warning" | "critical" | "transferred"
  statusAtDemo?: "stable" | "warning" | "critical" | "transferred"
  riskLevelAtDemo?: "Critical" | "High" | "Moderate" | "Stable" | "Low"
  currentHdAtDemo?: number | null
  admittedAtDemo?: string | null
  hasCareGapSignal?: boolean
  hasPendingLabSignal?: boolean
  riskScore: number
  vitals: VitalSign[]
  labResults: LabResult[]
  imagingResults: ImagingResult[]
  cultureResults: CultureResult[]
  psiData: PSIData
  aiSummary: string
  checklist: ChecklistItem[]
  playbook: PlaybookAction[]
  // Additional fields for dashboard
  statusSummary?: string
  lastUpdated?: string
  lastUpdatedTimestamp?: string // New: ISO timestamp for precise time
  lactate?: number
  qsofa?: number
  curb65?: number
  // NLP Features
  nlpAlertTags?: NLPTag[]
  evidenceSnippet?: string
  documentComparison?: DocumentComparison
  timeline?: TimelineEvent[]
  // v2.0 Trajectory Features
  weeklyTrajectory?: WeeklyTrajectory
  numericTrajectory?: NumericTrajectory
  sepsisExplanation?: SepsisExplanation
  sepsis6?: Sepsis6Item[]
  // v2.0 Enhanced Timeline
  enhancedTimeline?: EnhancedTimelineEvent[]
  // v2.0 Referral & Guideline
  referralNote?: ReferralNote
  diagnosisGuideline?: DiagnosisGuideline
  confirmedDiagnosis?: string // 확진된 진단명
  // MDRO & Isolation
  mdroStatus?: {
    isMDRO: boolean
    mdroType?: MDROType
    isolationType?: IsolationType
    isolationStarted?: string
    isolationRequired: boolean
    isolationImplemented: boolean
    confirmedAt?: string | null
    confirmedHd?: number | null
    confirmedDNumber?: number | null
    confirmedShift?: "Day" | "Evening" | "Night" | null
  }
  infection_type?: InfectionType
  // Cluster Detection
  clusterSuspected?: boolean
  clusterId?: string
  // Fused Alerts
  fusedAlerts?: FusedAlert[]
  // Trajectory Risk (from trajectory_events.severity aggregation)
  trajectoryRisk?: TrajectoryRiskSummary | null
  // Severity Engine
  severityAssessment?: SeverityAssessment
  // Explain Panel (Sepsis trajectory summary)
  explainData?: ExplainData
}

// =========================================================
// Watch Dashboard Card Types
// =========================================================
export type RiskLevel = "Critical" | "Urgent" | "Watch" | "Low"

export interface PatientTag {
  label: string
  variant: "destructive" | "warning" | "info" | "default" | "success" | "purple"
}

export interface PatientCard {
  id: string
  name: string
  age: number
  sex: "M" | "F"
  patientId: string
  bed: string
  hdDay: number
  demoDayLabel?: string
  demoShift?: "Day" | "Evening" | "Night"
  riskLevel: RiskLevel
  tags: PatientTag[]
  evidenceSnippet: string
  evidenceHighlight?: string
  primaryAction: "view" | "resolve" | "checklist"
  secondaryAction?: string
}

// =========================================================
// National Infection Status Types
// =========================================================
export interface InfectionSeries {
  date: string
  value: number
}

export interface InfectionRegionRow {
  region_code: string
  region_name: string
  value: number
  rank: number
  delta: number | null
}

export interface InfectionKpis {
  total_cases: number
  latest_day_cases: number
  delta_rate: number | null
}

export interface InfectionSummaryResponse {
  meta: {
    last_updated_at: string
    data_source: string
    cache_hit: boolean
  }
  kpis: InfectionKpis
  series: InfectionSeries[]
  table: InfectionRegionRow[]
  map_data: InfectionRegionRow[]
  diseases: string[]
}

// 감염병 목록 (전수감시 API 지원 항목)
export const DISEASE_LIST = [
  "전체",
  "백일해",
  "홍역",
  "수두",
  "유행성이하선염",
  "성홍열",
  "장출혈성대장균감염증",
  "A형간염",
  "세균성이질",
  "쯔쯔가무시증",
  "중증열성혈소판감소증후군(SFTS)",
]
