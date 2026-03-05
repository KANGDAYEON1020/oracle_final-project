/**
 * /patients/[id]/explain
 * Legacy 경로: /patients/[id]로 통합
 */
import { redirect } from "next/navigation"

interface Props {
  params: Promise<{ id: string }>
}

export default async function PatientExplainPage({ params }: Props) {
  const { id } = await params
  redirect(`/patients/${id}`)
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params
  return {
    title: `환자 ${id} — 임상 변화 분석 | LOOK`,
  }
}
