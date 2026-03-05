import type { PSIData } from "./types"

export interface PSIResult {
  score: number
  riskClass: "I" | "II" | "III" | "IV" | "V"
  mortality: string
  recommendation: string
  disposition: string
}

export function calculatePSI(data: PSIData): PSIResult {
  let score = 0

  // Demographics
  score += data.age
  if (data.sex === "F") {
    score -= 10
  }
  if (data.nursingHomeResident) {
    score += 10
  }

  // Comorbidities
  if (data.neoplasticDisease) score += 30
  if (data.liverDisease) score += 20
  if (data.chfHistory) score += 10
  if (data.cerebrovascularDisease) score += 10
  if (data.renalDisease) score += 10

  // Physical Exam
  if (data.alteredMentalStatus) score += 20
  if (data.respiratoryRateHigh) score += 20
  if (data.systolicBPLow) score += 20
  if (data.temperatureAbnormal) score += 15
  if (data.pulseHigh) score += 10

  // Lab/Radiographic
  if (data.pHLow) score += 30
  if (data.bunHigh) score += 20
  if (data.sodiumLow) score += 20
  if (data.glucoseHigh) score += 10
  if (data.hematocritLow) score += 10
  if (data.pO2Low) score += 10
  if (data.pleuralEffusion) score += 10

  // Determine risk class
  let riskClass: PSIResult["riskClass"]
  let mortality: string
  let recommendation: string
  let disposition: string

  if (score <= 50) {
    riskClass = "I"
    mortality = "0.1-0.4%"
    recommendation = "저위험군 - 외래 치료 가능"
    disposition = "외래 치료"
  } else if (score <= 70) {
    riskClass = "II"
    mortality = "0.6-0.7%"
    recommendation = "저위험군 - 외래 또는 단기 관찰 권고"
    disposition = "외래 또는 관찰"
  } else if (score <= 90) {
    riskClass = "III"
    mortality = "0.9-2.8%"
    recommendation = "중등도 위험 - 입원 치료 권고"
    disposition = "입원 치료"
  } else if (score <= 130) {
    riskClass = "IV"
    mortality = "8.2-9.3%"
    recommendation = "고위험군 - 입원 치료 필수"
    disposition = "입원 필수"
  } else {
    riskClass = "V"
    mortality = "27.0-31.1%"
    recommendation = "초고위험군 - 중환자실 치료 고려"
    disposition = "ICU 고려"
  }

  return {
    score,
    riskClass,
    mortality,
    recommendation,
    disposition,
  }
}

export const psiFactors = [
  { key: "age", label: "나이", points: "나이 값" },
  { key: "sex", label: "성별", points: "여성: -10" },
  { key: "nursingHomeResident", label: "요양시설 거주", points: "+10" },
  { key: "neoplasticDisease", label: "악성 종양", points: "+30" },
  { key: "liverDisease", label: "간질환", points: "+20" },
  { key: "chfHistory", label: "심부전", points: "+10" },
  { key: "cerebrovascularDisease", label: "뇌혈관질환", points: "+10" },
  { key: "renalDisease", label: "신장질환", points: "+10" },
  { key: "alteredMentalStatus", label: "의식 변화", points: "+20" },
  { key: "respiratoryRateHigh", label: "호흡수 ≥30/분", points: "+20" },
  { key: "systolicBPLow", label: "수축기 혈압 <90mmHg", points: "+20" },
  { key: "temperatureAbnormal", label: "체온 <35°C 또는 >39.9°C", points: "+15" },
  { key: "pulseHigh", label: "맥박 ≥125/분", points: "+10" },
  { key: "pHLow", label: "pH <7.35", points: "+30" },
  { key: "bunHigh", label: "BUN ≥30mg/dL", points: "+20" },
  { key: "sodiumLow", label: "Na <130mmol/L", points: "+20" },
  { key: "glucoseHigh", label: "혈당 ≥250mg/dL", points: "+10" },
  { key: "hematocritLow", label: "Hematocrit <30%", points: "+10" },
  { key: "pO2Low", label: "pO2 <60mmHg", points: "+10" },
  { key: "pleuralEffusion", label: "흉수", points: "+10" },
] as const
