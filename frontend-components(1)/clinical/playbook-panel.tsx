"use client"

import { CheckCircle2, Clock, PlayCircle, AlertTriangle, BookOpen, ListChecks, ExternalLink } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { Patient, PlaybookAction, ChecklistItem } from "@/lib/types"

interface PlaybookPanelProps {
  patient: Patient | null
}

const statusConfig = {
  pending: {
    icon: Clock,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    label: "대기",
  },
  "in-progress": {
    icon: PlayCircle,
    color: "text-primary",
    bgColor: "bg-primary/10",
    label: "진행중",
  },
  completed: {
    icon: CheckCircle2,
    color: "text-primary",
    bgColor: "bg-primary/10",
    label: "완료",
  },
}

const priorityConfig = {
  low: {
    color: "text-muted-foreground",
    borderColor: "border-muted-foreground/30",
    label: "낮음",
  },
  medium: {
    color: "text-warning",
    borderColor: "border-warning/30",
    label: "보통",
  },
  high: {
    color: "text-destructive",
    borderColor: "border-destructive/30",
    label: "높음",
  },
}

export function PlaybookPanel({ patient }: PlaybookPanelProps) {
  if (!patient) {
    return (
      <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-sidebar">
        <div className="flex h-full items-center justify-center">
          <div className="text-center text-muted-foreground">
            <BookOpen className="mx-auto h-10 w-10 opacity-50" />
            <p className="mt-2 text-sm">환자를 선택하면</p>
            <p className="text-sm">Playbook이 표시됩니다</p>
          </div>
        </div>
      </aside>
    )
  }

  if (patient.status === "transferred") {
    return (
      <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-sidebar">
        <div className="flex h-full items-center justify-center">
          <div className="text-center text-muted-foreground">
            <CheckCircle2 className="mx-auto h-10 w-10 opacity-50" />
            <p className="mt-2 text-sm">전원이 완료되었습니다</p>
          </div>
        </div>
      </aside>
    )
  }

  const completedPlaybook = patient.playbook.filter((p) => p.status === "completed").length
  const totalPlaybook = patient.playbook.length
  const checkedItems = patient.checklist.filter((c) => c.checked).length
  const totalChecklist = patient.checklist.length
  const criticalItems = patient.checklist.filter((c) => c.critical)
  const checkedCritical = criticalItems.filter((c) => c.checked).length

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-sidebar">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-sidebar-foreground">조치 실행</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {patient.name} 환자 - {patient.diagnosis}
        </p>
      </div>

      <Tabs defaultValue="playbook" className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 grid w-auto grid-cols-2 bg-muted/50">
          <TabsTrigger value="playbook" className="text-xs gap-1">
            <BookOpen className="h-3 w-3" />
            Playbook
          </TabsTrigger>
          <TabsTrigger value="checklist" className="text-xs gap-1">
            <ListChecks className="h-3 w-3" />
            체크리스트
          </TabsTrigger>
        </TabsList>

        {/* Playbook Tab */}
        <TabsContent value="playbook" className="flex flex-1 flex-col overflow-hidden mt-0 data-[state=inactive]:hidden">
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">진행률</span>
              <span className="text-foreground">
                {completedPlaybook} / {totalPlaybook}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(completedPlaybook / totalPlaybook) * 100}%` }}
              />
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {patient.playbook.map((action, index) => (
                <PlaybookActionCard key={action.id} action={action} index={index + 1} />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Checklist Tab */}
        <TabsContent value="checklist" className="flex flex-1 flex-col overflow-hidden mt-0 data-[state=inactive]:hidden">
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">전체 진행률</span>
              <span className="text-foreground">
                {checkedItems} / {totalChecklist}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(checkedItems / totalChecklist) * 100}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">필수 항목</span>
              <span className={cn(
                checkedCritical === criticalItems.length ? "text-primary" : "text-destructive"
              )}>
                {checkedCritical} / {criticalItems.length}
              </span>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {/* Critical Items First */}
              <div>
                <h4 className="text-xs font-medium text-destructive mb-2 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  필수 항목
                </h4>
                <div className="space-y-2">
                  {criticalItems.map((item) => (
                    <ChecklistItemCard key={item.id} item={item} />
                  ))}
                </div>
              </div>

              {/* Other Items */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">일반 항목</h4>
                <div className="space-y-2">
                  {patient.checklist
                    .filter((c) => !c.critical)
                    .map((item) => (
                      <ChecklistItemCard key={item.id} item={item} />
                    ))}
                </div>
              </div>
            </div>
          </ScrollArea>

          {/* Transfer Guidelines Link */}
          <div className="border-t border-border p-4">
            <Button variant="outline" size="sm" className="w-full text-xs gap-2 bg-transparent" asChild>
              <a
                href="https://www.notion.so/Transfer-2f68cfa323e880f8ace6db609fd0899"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-3 w-3" />
                전원 가이드라인 보기
              </a>
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* Warning */}
      <div className="border-t border-border p-4">
        <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
          <div>
            <p className="text-xs font-medium text-warning">주의사항</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              모든 조치 사항을 순서대로 수행하고, 이상 소견 발생 시 즉시 담당 의료진에게 보고하세요.
            </p>
          </div>
        </div>
      </div>
    </aside>
  )
}

function PlaybookActionCard({ action, index }: { action: PlaybookAction; index: number }) {
  const status = statusConfig[action.status]
  const priority = priorityConfig[action.priority]
  const StatusIcon = status.icon

  return (
    <Card
      className={cn(
        "bg-card border-border transition-all",
        action.status === "in-progress" && "border-primary/50 shadow-sm shadow-primary/10"
      )}
    >
      <CardHeader className="p-3 pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
              {index}
            </span>
            <CardTitle className="text-sm text-card-foreground">{action.title}</CardTitle>
          </div>
          <div className={cn("rounded-full p-1", status.bgColor)}>
            <StatusIcon className={cn("h-3.5 w-3.5", status.color)} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <p className="text-xs text-muted-foreground leading-relaxed">{action.description}</p>
        <div className="mt-2 flex items-center justify-between">
          <Badge variant="outline" className={cn("text-[10px]", priority.borderColor, priority.color)}>
            우선순위: {priority.label}
          </Badge>
          <span className={cn("text-[10px]", status.color)}>{status.label}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function ChecklistItemCard({ item }: { item: ChecklistItem }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border p-2.5 text-xs transition-colors",
        item.checked
          ? "bg-primary/5 border-primary/30"
          : item.critical
          ? "bg-destructive/5 border-destructive/30"
          : "bg-card border-border"
      )}
    >
      <div
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
          item.checked ? "bg-primary" : "bg-muted"
        )}
      >
        {item.checked && <CheckCircle2 className="h-3 w-3 text-primary-foreground" />}
      </div>
      <span
        className={cn(
          "flex-1",
          item.checked ? "text-muted-foreground line-through" : "text-foreground"
        )}
      >
        {item.label}
      </span>
      {item.critical && !item.checked && (
        <Badge variant="outline" className="text-[9px] border-destructive/50 text-destructive">
          필수
        </Badge>
      )}
    </div>
  )
}
