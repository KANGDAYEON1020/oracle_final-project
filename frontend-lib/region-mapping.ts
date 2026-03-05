// 시/도 표준 매핑 테이블
// GeoJSON 키 <-> API 응답 지역명 정규화

export interface RegionInfo {
  code: string
  nameKo: string
  nameEn: string
  aliases: string[]
}

export const REGIONS: RegionInfo[] = [
  { code: "seoul", nameKo: "서울특별시", nameEn: "Seoul", aliases: ["서울", "서울시", "서울특별시"] },
  { code: "busan", nameKo: "부산광역시", nameEn: "Busan", aliases: ["부산", "부산시", "부산광역시"] },
  { code: "daegu", nameKo: "대구광역시", nameEn: "Daegu", aliases: ["대구", "대구시", "대구광역시"] },
  { code: "incheon", nameKo: "인천광역시", nameEn: "Incheon", aliases: ["인천", "인천시", "인천광역시"] },
  { code: "gwangju", nameKo: "광주광역시", nameEn: "Gwangju", aliases: ["광주", "광주시", "광주광역시"] },
  { code: "daejeon", nameKo: "대전광역시", nameEn: "Daejeon", aliases: ["대전", "대전시", "대전광역시"] },
  { code: "ulsan", nameKo: "울산광역시", nameEn: "Ulsan", aliases: ["울산", "울산시", "울산광역시"] },
  { code: "sejong", nameKo: "세종특별자치시", nameEn: "Sejong", aliases: ["세종", "세종시", "세종특별자치시"] },
  { code: "gyeonggi", nameKo: "경기도", nameEn: "Gyeonggi", aliases: ["경기", "경기도"] },
  { code: "gangwon", nameKo: "강원특별자치도", nameEn: "Gangwon", aliases: ["강원", "강원도", "강원특별자치도"] },
  { code: "chungbuk", nameKo: "충청북도", nameEn: "Chungbuk", aliases: ["충북", "충청북도"] },
  { code: "chungnam", nameKo: "충청남도", nameEn: "Chungnam", aliases: ["충남", "충청남도"] },
  { code: "jeonbuk", nameKo: "전북특별자치도", nameEn: "Jeonbuk", aliases: ["전북", "전라북도", "전북특별자치도"] },
  { code: "jeonnam", nameKo: "전라남도", nameEn: "Jeonnam", aliases: ["전남", "전라남도"] },
  { code: "gyeongbuk", nameKo: "경상북도", nameEn: "Gyeongbuk", aliases: ["경북", "경상북도"] },
  { code: "gyeongnam", nameKo: "경상남도", nameEn: "Gyeongnam", aliases: ["경남", "경상남도"] },
  { code: "jeju", nameKo: "제주특별자치도", nameEn: "Jeju", aliases: ["제주", "제주도", "제주특별자치도"] },
]

// 지역명 -> 표준 코드 변환
export function normalizeRegionName(raw: string): string | null {
  const trimmed = raw.trim()
  for (const region of REGIONS) {
    if (region.aliases.includes(trimmed) || region.nameKo === trimmed || region.code === trimmed) {
      return region.code
    }
  }
  console.warn(`[region-mapping] 매핑 실패: "${raw}"`)
  return null
}

// 코드 -> RegionInfo
export function getRegionByCode(code: string): RegionInfo | undefined {
  return REGIONS.find((r) => r.code === code)
}

// 코드 -> 한글명
export function getRegionNameKo(code: string): string {
  return getRegionByCode(code)?.nameKo ?? code
}

// 코드 -> 영문명
export function getRegionNameEn(code: string): string {
  return getRegionByCode(code)?.nameEn ?? code
}
