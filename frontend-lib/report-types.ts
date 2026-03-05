// Report Types for INFECT-GUARD Reporting Layer

export type ReportPeriod = '7d' | '1M' | '3M' | '12M'
export type TrendBucket = 'day' | 'week' | 'month'

export interface OverviewSummaryData {
    // Snapshot metrics (NOT filtered by period)
    mdroUnderManagement: number
    openIsolationGapCases: number
    // Period metrics (filtered by period)
    monitoringEvents: number
    monitoringEventsDelta: number
    infectionTransfers: number
    transfersDelta: number
}

export interface EventCategory {
    type: 'Pneumonia' | 'GI' | 'UTI' | 'SSTI' | 'Others'
    typeKo: string
    count: number
    percentage: number
}

export interface EventsByTypeData {
    total: number
    categories: EventCategory[]
}

export interface TrendDataPoint {
    label: string
    total: number
    mdro: number
}

export interface TrendChartData {
    bucket: TrendBucket
    dataPoints: TrendDataPoint[]
}

export interface MdroOrganism {
    type: 'CRE' | 'VRE' | 'MRSA'
    typeKo: string
    // Snapshot
    underManagement: number
    ongoing: number
    openIsolationGap: number
    // Period
    newInPeriod: number
    delayEventsInPeriod: number
}

export interface MdroFocusData {
    organisms: MdroOrganism[]
}

export interface ActionSummaryData {
    bulletPoints: string[]
}

// Period-specific types
export interface WardComparisonData {
    wards: Array<{ name: string; floor: string; events: number; mdro: number }>
}

export interface QuarterlyDeepDiveData {
    avgLengthOfStay: number
    isolationComplianceRate: number
    topEventTypes: Array<{ type: string; typeKo: string; count: number }>
}

export interface AnnualBenchmarkData {
    internalTrend: Array<{ month: string; rate: number }>
    externalBenchmark?: number
}

// Combined report data
export interface ReportData {
    period: ReportPeriod
    generatedAt: string
    overview: OverviewSummaryData
    eventsByType: EventsByTypeData
    trend: TrendChartData
    mdroFocus: MdroFocusData
    actionSummary: ActionSummaryData
    // Period-specific
    wardComparison?: WardComparisonData
    quarterlyDeepDive?: QuarterlyDeepDiveData
    annualBenchmark?: AnnualBenchmarkData
}

// Utility
export function getPeriodLabel(period: ReportPeriod): string {
    const labels: Record<ReportPeriod, string> = {
        '7d': '7일',
        '1M': '1개월',
        '3M': '3개월',
        '12M': '연간'
    }
    return labels[period]
}

export function getTrendBucket(period: ReportPeriod): TrendBucket {
    if (period === '7d') return 'day'
    if (period === '12M') return 'month'
    return 'week'
}
