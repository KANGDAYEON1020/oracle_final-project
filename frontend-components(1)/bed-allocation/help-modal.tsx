"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Bed, Users, Droplet } from "lucide-react"

interface HelpModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function HelpModal({ open, onOpenChange }: HelpModalProps) {
    const [activeSection, setActiveSection] = useState<"guide" | "icons" | "faq">("guide")

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>병상 배정 시스템 도움말</DialogTitle>
                    <DialogDescription>
                        빠른 시작 가이드와 자주 묻는 질문
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Section Tabs */}
                    <div className="flex gap-2 border-b">
                        <Button
                            variant={activeSection === "guide" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setActiveSection("guide")}
                        >
                            빠른 시작
                        </Button>
                        <Button
                            variant={activeSection === "icons" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setActiveSection("icons")}
                        >
                            아이콘 설명
                        </Button>
                        <Button
                            variant={activeSection === "faq" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setActiveSection("faq")}
                        >
                            자주 묻는 질문
                        </Button>
                    </div>

                    {/* Quick Start Guide */}
                    {activeSection === "guide" && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">빠른 시작 가이드</h3>

                            <div className="space-y-3">
                                <div className="flex gap-3">
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                                        1
                                    </div>
                                    <div>
                                        <h4 className="font-medium">대기 환자 확인</h4>
                                        <p className="text-sm text-muted-foreground">
                                            "대기 환자" 탭에서 병상 배정이 필요한 환자 목록을 확인합니다.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                                        2
                                    </div>
                                    <div>
                                        <h4 className="font-medium">자동 배치</h4>
                                        <p className="text-sm text-muted-foreground">
                                            환자를 선택하고 "자동 배치" 버튼을 클릭하면 시스템이 최적의 병상을 찾아줍니다.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                                        3
                                    </div>
                                    <div>
                                        <h4 className="font-medium">수동 조정 (선택사항)</h4>
                                        <p className="text-sm text-muted-foreground">
                                            "병상 현황" 탭에서 드래그 앤 드롭으로 환자를 다른 병상으로 이동할 수 있습니다.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                                        4
                                    </div>
                                    <div>
                                        <h4 className="font-medium">확정</h4>
                                        <p className="text-sm text-muted-foreground">
                                            "확정 요청" 버튼을 클릭하여 배정을 완료합니다.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <Alert>
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription>
                                    시스템이 자동으로 감염 관리 규칙을 확인하므로, 배정 불가능한 병상에는 환자를 배치할 수 없습니다.
                                </AlertDescription>
                            </Alert>
                        </div>
                    )}

                    {/* Icon Explanations */}
                    {activeSection === "icons" && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">아이콘 및 색상 설명</h3>

                            <div className="space-y-3">
                                <div>
                                    <h4 className="font-medium mb-2">감염 유형 색상</h4>
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 rounded bg-blue-500" />
                                            <span className="text-sm">파란색 - 폐렴 (비말 격리)</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 rounded bg-amber-500" />
                                            <span className="text-sm">주황색 - 요로감염</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 rounded bg-cyan-500" />
                                            <span className="text-sm">청록색 - 수인성 감염</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 rounded bg-green-500" />
                                            <span className="text-sm">초록색 - 진드기 매개 감염</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 rounded bg-red-500" />
                                            <span className="text-sm">빨간색 - 다제내성균 (MDRO)</span>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <h4 className="font-medium mb-2">병실 아이콘</h4>
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Bed className="h-4 w-4" />
                                            <span className="text-sm">1인실 - 격리가 필요한 환자 전용</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Users className="h-4 w-4" />
                                            <span className="text-sm">다인실 (2인/4인) - 같은 감염, 같은 성별만 가능</span>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <h4 className="font-medium mb-2">베드 상태</h4>
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 border-2 border-dashed border-gray-400 rounded" />
                                            <span className="text-sm">점선 테두리 - 빈 병상</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 border-2 border-solid border-blue-500 bg-blue-50 rounded" />
                                            <span className="text-sm">실선 테두리 - 환자 배정됨</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 border-2 border-dashed border-primary bg-primary/10 rounded" />
                                            <span className="text-sm">파란 점선 - 가배치 (임시 배정)</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* FAQ */}
                    {activeSection === "faq" && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">자주 묻는 질문</h3>

                            <div className="space-y-4">
                                <div>
                                    <h4 className="font-medium text-sm mb-1">Q. 왜 이 병상에 환자를 배정할 수 없나요?</h4>
                                    <p className="text-sm text-muted-foreground">
                                        A. 감염 관리 규칙에 따라 다음과 같은 경우 배정이 제한됩니다:
                                    </p>
                                    <ul className="text-sm text-muted-foreground list-disc list-inside ml-2 mt-1 space-y-1">
                                        <li>다인실에 다른 성별 환자가 있는 경우</li>
                                        <li>다인실에 다른 감염 유형 환자가 있는 경우</li>
                                        <li>병상이 이미 만실인 경우</li>
                                        <li>특정 감염은 1인실 격리가 필요한 경우</li>
                                    </ul>
                                </div>

                                <div>
                                    <h4 className="font-medium text-sm mb-1">Q. 가배치란 무엇인가요?</h4>
                                    <p className="text-sm text-muted-foreground">
                                        A. 가배치는 아직 확정되지 않은 임시 배정입니다. "확정 요청" 버튼을 클릭하기 전까지는 언제든지 변경할 수 있습니다.
                                    </p>
                                </div>

                                <div>
                                    <h4 className="font-medium text-sm mb-1">Q. 자동 배치는 어떤 기준으로 병상을 선택하나요?</h4>
                                    <p className="text-sm text-muted-foreground">
                                        A. 시스템은 다음 우선순위로 병상을 선택합니다:
                                    </p>
                                    <ul className="text-sm text-muted-foreground list-disc list-inside ml-2 mt-1 space-y-1">
                                        <li>1순위: 감염 관리 규칙 준수</li>
                                        <li>2순위: 격리 전용 병동 (5층) 우선 배정</li>
                                        <li>3순위: 같은 감염 환자와 코호트 격리</li>
                                        <li>4순위: 병상 효율성 (빈 병상 최소화)</li>
                                    </ul>
                                </div>

                                <div>
                                    <h4 className="font-medium text-sm mb-1">Q. 드래그 앤 드롭이 작동하지 않아요</h4>
                                    <p className="text-sm text-muted-foreground">
                                        A. 환자가 배정된 병상만 드래그할 수 있습니다. 빈 병상은 드래그할 수 없으며, 드롭 대상도 빈 병상이어야 합니다.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-end pt-4 border-t">
                    <Button onClick={() => onOpenChange(false)}>
                        닫기
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
