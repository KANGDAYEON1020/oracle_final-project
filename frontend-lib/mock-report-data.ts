// Mock Data for INFECT-GUARD Reporting Layer
import type {
    ReportPeriod,
    OverviewSummaryData,
    EventsByTypeData,
    TrendChartData,
    MdroFocusData,
    ActionSummaryData,
    WardComparisonData,
    QuarterlyDeepDiveData,
    AnnualBenchmarkData,
    ReportData,
    getTrendBucket
} from './report-types'

// Overview Summary (shared across periods, but period metrics differ)
export function getMockOverviewSummary(period: ReportPeriod): OverviewSummaryData {
    // Use same base values as EventsByType for consistency
    const baseEvents: Record<ReportPeriod, number> = {
        '7d': 94,
        '1M': 380,
        '3M': 1100,
        '12M': 4500
    }
    const base = baseEvents[period]

    return {
        mdroUnderManagement: 12, // Snapshot - always same
        openIsolationGapCases: 1, // Snapshot - always same
        monitoringEvents: base,
        monitoringEventsDelta: period === '7d' ? 8 : period === '1M' ? 32 : period === '3M' ? 95 : 380,
        infectionTransfers: period === '7d' ? 3 : period === '1M' ? 12 : period === '3M' ? 35 : 145,
        transfersDelta: period === '7d' ? -1 : period === '1M' ? 2 : period === '3M' ? -5 : 12
    }
}

// Events by Type
export function getMockEventsByType(period: ReportPeriod): EventsByTypeData {
    const base = period === '7d' ? 94 : period === '1M' ? 380 : period === '3M' ? 1100 : 4500

    return {
        total: base,
        categories: [
            { type: 'Pneumonia', typeKo: '폐렴', count: Math.round(base * 0.36), percentage: 36.2 },
            { type: 'GI', typeKo: '소화기', count: Math.round(base * 0.23), percentage: 23.4 },
            { type: 'UTI', typeKo: '요로감염', count: Math.round(base * 0.19), percentage: 19.1 },
            { type: 'SSTI', typeKo: '피부연조직', count: Math.round(base * 0.13), percentage: 12.8 },
            { type: 'Others', typeKo: '기타', count: Math.round(base * 0.09), percentage: 8.5 }
        ]
    }
}

// Trend Chart Data
export function getMockTrendData(period: ReportPeriod): TrendChartData {
    if (period === '7d') {
        return {
            bucket: 'day',
            dataPoints: [
                { label: 'Mon', total: 12, mdro: 2 },
                { label: 'Tue', total: 15, mdro: 3 },
                { label: 'Wed', total: 11, mdro: 2 },
                { label: 'Thu', total: 18, mdro: 4 },
                { label: 'Fri', total: 14, mdro: 3 },
                { label: 'Sat', total: 10, mdro: 1 },
                { label: 'Sun', total: 14, mdro: 3 }
            ]
        }
    }

    if (period === '1M' || period === '3M') {
        const weeks = period === '1M' ? 4 : 12
        return {
            bucket: 'week',
            dataPoints: Array.from({ length: weeks }, (_, i) => ({
                label: `W${i + 1}`,
                total: Math.round(80 + Math.random() * 40),
                mdro: Math.round(15 + Math.random() * 10)
            }))
        }
    }

    // 12M
    return {
        bucket: 'month',
        dataPoints: [
            { label: 'Mar', total: 320, mdro: 45 },
            { label: 'Apr', total: 350, mdro: 52 },
            { label: 'May', total: 380, mdro: 48 },
            { label: 'Jun', total: 340, mdro: 40 },
            { label: 'Jul', total: 390, mdro: 55 },
            { label: 'Aug', total: 420, mdro: 60 },
            { label: 'Sep', total: 380, mdro: 50 },
            { label: 'Oct', total: 400, mdro: 58 },
            { label: 'Nov', total: 370, mdro: 48 },
            { label: 'Dec', total: 410, mdro: 62 },
            { label: 'Jan', total: 390, mdro: 55 },
            { label: 'Feb', total: 380, mdro: 52 }
        ]
    }
}

// MDRO Focus Panel
export function getMockMdroFocus(period: ReportPeriod): MdroFocusData {
    const m = period === '7d' ? 1 : period === '1M' ? 4 : period === '3M' ? 12 : 52

    return {
        organisms: [
            {
                type: 'CRE',
                typeKo: '카바페넴내성장내세균',
                underManagement: 3,
                ongoing: 2,
                openIsolationGap: 0,
                newInPeriod: Math.round(2 * m * 0.3),
                delayEventsInPeriod: Math.round(1 * m * 0.2)
            },
            {
                type: 'VRE',
                typeKo: '반코마이신내성장알균',
                underManagement: 5,
                ongoing: 4,
                openIsolationGap: 1,
                newInPeriod: Math.round(3 * m * 0.3),
                delayEventsInPeriod: Math.round(2 * m * 0.2)
            },
            {
                type: 'MRSA',
                typeKo: '메티실린내성황색포도알균',
                underManagement: 4,
                ongoing: 3,
                openIsolationGap: 0,
                newInPeriod: Math.round(2 * m * 0.4),
                delayEventsInPeriod: Math.round(1 * m * 0.15)
            }
        ]
    }
}

// Action Summary
export function getMockActionSummary(period: ReportPeriod): ActionSummaryData {
    const bullets: Record<ReportPeriod, string[]> = {
        '7d': [
            '격리 미조치 1건 (5F-501 VRE)',
            'UTI 모니터링 이벤트 전주 대비 +40% 증가',
            '클러스터 의심 신호 없음'
        ],
        '1M': [
            '격리 미조치 1건 현재 진행 중',
            '폐렴 관련 이벤트 전월 대비 +15% 증가',
            '3F 병동 GI 감염 이벤트 집중 발생 (12건)'
        ],
        '3M': [
            '분기 내 격리 지연 평균 2.3일',
            'MDRO 신규 발생 전분기 대비 -8% 감소',
            '2F 폐렴 이벤트 지속 상승 추세'
        ],
        '12M': [
            '연간 MDRO 관리 환자 총 48명',
            '격리 조치 평균 소요 시간 1.8일',
            '동절기(12-2월) 폐렴 이벤트 +35% 집중'
        ]
    }
    return { bulletPoints: bullets[period] }
}

// Period-specific mock data
export function getMockWardComparison(): WardComparisonData {
    return {
        wards: [
            { name: '일반병동 A', floor: '2F', events: 156, mdro: 18 },
            { name: '일반병동 B', floor: '3F', events: 142, mdro: 22 },
            { name: '격리병동', floor: '5F', events: 82, mdro: 45 }
        ]
    }
}

export function getMockQuarterlyDeepDive(): QuarterlyDeepDiveData {
    return {
        avgLengthOfStay: 8.5,
        isolationComplianceRate: 94.2,
        topEventTypes: [
            { type: 'Pneumonia', typeKo: '폐렴', count: 396 },
            { type: 'GI', typeKo: '소화기', count: 253 },
            { type: 'UTI', typeKo: '요로감염', count: 209 }
        ]
    }
}

export function getMockAnnualBenchmark(): AnnualBenchmarkData {
    return {
        internalTrend: [
            { month: 'Mar', rate: 2.1 },
            { month: 'Jun', rate: 2.3 },
            { month: 'Sep', rate: 2.0 },
            { month: 'Dec', rate: 2.4 },
            { month: 'Feb', rate: 2.2 }
        ],
        externalBenchmark: 2.5 // Placeholder
    }
}

// Combined report data generator
export function getMockReportData(period: ReportPeriod): ReportData {
    const data: ReportData = {
        period,
        generatedAt: new Date().toISOString(),
        overview: getMockOverviewSummary(period),
        eventsByType: getMockEventsByType(period),
        trend: getMockTrendData(period),
        mdroFocus: getMockMdroFocus(period),
        actionSummary: getMockActionSummary(period)
    }

    // Period-specific
    if (period === '1M') {
        data.wardComparison = getMockWardComparison()
    }
    if (period === '3M') {
        data.quarterlyDeepDive = getMockQuarterlyDeepDive()
    }
    if (period === '12M') {
        data.annualBenchmark = getMockAnnualBenchmark()
    }

    return data
}
