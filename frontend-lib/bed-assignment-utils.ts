import type {
  IsolationBed,
  IsolationType,
  MDROType,
  MDROBedAssignment,
} from "@/lib/types"

/**
 * API /api/rooms 응답을 IsolationBed[] 형태로 변환
 * (격리병실만 필터링)
 */
export function roomsToIsolationBeds(rooms: any[]): IsolationBed[] {
  const beds: IsolationBed[] = []
  for (const room of rooms) {
    if (!room.isIsolation) continue
    for (const bed of room.beds || []) {
      beds.push({
        id: bed.id,
        roomNumber: room.roomNo,
        bedNumber: bed.id.split("-").pop() || "1",
        ward: room.wardId || "격리병동",
        isolationType: (room.isolationType as IsolationType) || "contact",
        isOccupied: !!bed.patient,
        currentPatient: bed.patient
          ? {
              id: bed.patient.id,
              name: bed.patient.name,
              mdroType: undefined,
              gender: bed.patient.gender as "M" | "F",
            }
          : undefined,
        features: {
          negativePressure: room.hasAIIR || false,
          anteroom: room.hasDedicatedToilet || false,
          privateRoom: room.capacity === 1,
        },
      })
    }
  }
  return beds
}

/**
 * MDRO 병상 자동 배정 추천 알고리즘
 * (격리 타입, 코호트 가능성, 1인실, 전실 유무 등을 점수화)
 */
export function computeMDROBedAssignment(
  patientId: string,
  patientName: string,
  requiredIsolation: IsolationType,
  mdroType: MDROType | undefined,
  gender: "M" | "F",
  isolationBeds: IsolationBed[]
): MDROBedAssignment {
  const availableBeds = isolationBeds.filter((bed) => !bed.isOccupied)
  const recommendations: MDROBedAssignment["recommendations"] = []
  const unavailableReasons: string[] = []

  for (const bed of availableBeds) {
    let score = 50
    const matchReasons: string[] = []
    const warnings: string[] = []
    let cohortCompatible = false

    // Isolation type match
    if (bed.isolationType === requiredIsolation) {
      score += 30
      matchReasons.push(`격리 타입 일치 (${requiredIsolation})`)
    } else if (
      requiredIsolation === "contact" &&
      bed.isolationType === "droplet"
    ) {
      score += 10
      matchReasons.push("격리 타입 호환 가능")
      warnings.push("접촉격리용 병상 권장")
    } else {
      score -= 20
      warnings.push(
        `격리 타입 불일치 (필요: ${requiredIsolation}, 병상: ${bed.isolationType})`
      )
    }

    // Cohort possibility (same room, same MDRO type, same gender)
    if (!bed.features.privateRoom) {
      const roommates = isolationBeds.filter(
        (b) =>
          b.roomNumber === bed.roomNumber && b.isOccupied && b.currentPatient
      )
      if (roommates.length > 0) {
        const roommate = roommates[0].currentPatient!
        if (roommate.mdroType === mdroType && roommate.gender === gender) {
          cohortCompatible = true
          score += 20
          matchReasons.push(`코호트 가능 (동일 균: ${mdroType}, 동일 성별)`)
        } else if (roommate.gender !== gender) {
          score -= 30
          warnings.push(
            `성별 불일치 (환자: ${gender}, 동실: ${roommate.gender})`
          )
        } else if (roommate.mdroType !== mdroType) {
          score -= 20
          warnings.push(
            `MDRO 타입 불일치 (환자: ${mdroType}, 동실: ${roommate.mdroType})`
          )
        }
      }
    }

    // Private room bonus
    if (bed.features.privateRoom) {
      score += 15
      matchReasons.push("1인실")
    }

    // Anteroom bonus
    if (bed.features.anteroom) {
      score += 5
      matchReasons.push("전실 있음")
    }

    if (score > 30) {
      recommendations.push({
        bed,
        score: Math.min(100, Math.max(0, score)),
        matchReasons,
        warnings: warnings.length > 0 ? warnings : undefined,
        cohortCompatible,
      })
    }
  }

  // Sort by score descending
  recommendations.sort((a, b) => b.score - a.score)

  if (recommendations.length === 0) {
    unavailableReasons.push("격리 타입에 맞는 빈 병상 없음")
  }
  const occupiedSameType = isolationBeds.filter(
    (b) => b.isOccupied && b.isolationType === requiredIsolation
  )
  if (occupiedSameType.length > 0) {
    unavailableReasons.push(
      `${requiredIsolation} 격리병상 ${occupiedSameType.length}개 사용 중`
    )
  }

  return {
    patientId,
    patientName,
    requiredIsolation,
    mdroType,
    gender,
    recommendations: recommendations.slice(0, 3),
    unavailableReasons,
    generatedAt: new Date().toISOString(),
  }
}
