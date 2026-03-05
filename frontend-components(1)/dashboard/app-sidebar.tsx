"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutGrid,
  Users,
  BarChart3,
  Zap,
  ChevronDown,
  BedDouble,
  FileText,
  ClipboardCheck,
  ClipboardList,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useUser } from "@/lib/user-context"
import { DemoControlBar } from "@/components/dashboard/demo-control-bar"

export type SidebarPage =
  | "pc"
  | "transfer"
  | "infection"
  | "report"
  | "autodraft"
  | "isolation"
  | "transferChecklist"
  | "guidelineSearch"

interface AppSidebarProps {
  currentPage: SidebarPage
  onNavigate: (page: SidebarPage) => void
}

interface SubItem {
  label: string
  icon: React.ElementType
  page: SidebarPage
  path?: string
}

const actionPages: SidebarPage[] = ["report", "isolation", "autodraft", "transferChecklist", "guidelineSearch"]

// In-memory UI hint:
// - resets on full refresh
// - survives client-side route transitions
let openActionsOnNextMount = false

export function AppSidebar({ currentPage, onNavigate }: AppSidebarProps) {
  const router = useRouter()
  const { user } = useUser()
  const [collapsed, setCollapsed] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(() => openActionsOnNextMount)

  const navItems = [
    { label: "워치 대시보드", icon: LayoutGrid, page: "pc" as const },
    { label: "환자 목록", icon: Users, page: "transfer" as const, path: "/patients" },
    { label: "감염 현황", icon: BarChart3, page: "infection" as const },
  ]

  const actionSubItems: SubItem[] = [
    { label: "Smart Bed System", icon: BedDouble, page: "report" as const, path: "/bed-allocation" },
    { label: "격리 체크리스트", icon: ClipboardList, page: "isolation" as const, path: "/isolation-checklist" },
    { label: "문서 초안 자동화", icon: FileText, page: "autodraft" as const, path: "/?view=autodraft" },
    { label: "전원 체크리스트", icon: ClipboardCheck, page: "transferChecklist" as const, path: "/transfer-checklist" },
    { label: "지침서 검색기", icon: Search, page: "guidelineSearch" as const, path: "/guideline-search" },
  ]

  const handleNavigate = (page: SidebarPage, path?: string) => {
    const nextIsActionPage = actionPages.includes(page)
    openActionsOnNextMount = nextIsActionPage
    setActionsOpen(nextIsActionPage)

    if (path) {
      router.push(path)
      return
    }
    onNavigate(page)
  }

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      if (next) setActionsOpen(false)
      return next
    })
  }

  return (
    <aside
      className={cn(
        "flex h-dvh flex-col border-r border-border bg-card transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-60"
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          "flex items-center",
          collapsed ? "flex-col gap-3 px-2 py-4" : "gap-2 px-5 py-5"
        )}
      >
        <div className={cn("flex items-center gap-2", collapsed && "flex-col")}>
          <div className="relative h-8 w-8 overflow-hidden rounded-lg">
            <img
              src="/look_img.png"
              alt="LOOK"
              className="h-full w-auto max-w-none object-cover object-left"
            />
          </div>
          {!collapsed && (
            <button
              type="button"
              onClick={() => handleNavigate("pc")}
              className="text-lg font-bold tracking-tight text-primary hover:opacity-80 transition-opacity"
            >
              LOOK
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            collapsed ? "" : "ml-auto"
          )}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>



      <DemoControlBar collapsed={collapsed} />

      {/* Main nav */}
      <nav className={cn("flex flex-1 flex-col gap-1", collapsed ? "px-2" : "px-3")}>
        {navItems.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => handleNavigate(item.page, item.path)}
            aria-label={item.label}
            title={item.label}
            className={cn(
              "flex items-center rounded-lg text-sm font-medium transition-colors",
              collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
              currentPage === item.page
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            <item.icon className="h-[18px] w-[18px]" />
            {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
          </button>
        ))}

        {/* Actions Accordion */}
        {collapsed ? (
          <div className="mt-1 flex flex-col gap-1">
            {actionSubItems.map((sub) => (
              <button
                key={sub.label}
                type="button"
                onClick={() => handleNavigate(sub.page, sub.path)}
                aria-label={sub.label}
                title={sub.label}
                className={cn(
                  "flex items-center justify-center rounded-lg px-2 py-2.5 text-sm font-medium transition-colors",
                  currentPage === sub.page
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <sub.icon className="h-[18px] w-[18px]" />
              </button>
            ))}
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() =>
                setActionsOpen((prev) => {
                  const next = !prev
                  openActionsOnNextMount = next
                  return next
                })
              }
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                actionsOpen
                  ? "text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <Zap className="h-[18px] w-[18px]" />
              <span className="flex-1 text-left">액션</span>
              <span className="mr-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                {actionSubItems.length}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-200",
                  actionsOpen && "rotate-180"
                )}
              />
            </button>

            {/* Sub-items */}
            <div
              className={cn(
                "overflow-hidden transition-all duration-200 ease-in-out",
                actionsOpen ? "max-h-60 opacity-100 mt-0.5" : "max-h-0 opacity-0"
              )}
            >
              <div className="ml-4 flex flex-col gap-0.5 border-l border-border/60 pl-2">
                {actionSubItems.map((sub) => (
                  <button
                    key={sub.label}
                    type="button"
                    onClick={() => handleNavigate(sub.page, sub.path)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                      currentPage === sub.page
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                  >
                    <sub.icon className="h-4 w-4" />
                    <span>{sub.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

      </nav>

      {/* User profile */}
      <div className={cn("border-t border-border", collapsed ? "p-3" : "p-4")}>
        <div className={cn("flex items-center", collapsed ? "justify-center" : "gap-3")}>
          <Avatar className="h-9 w-9">
            <AvatarImage src="/placeholder-user.jpg" alt={user?.name ?? "로그인 안 됨"} />
            <AvatarFallback className="bg-accent text-accent-foreground text-xs font-semibold">
              {user?.name?.charAt(0) ?? "?"}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">
                {user?.name ?? "로그인 안 됨"}
              </span>
              <span className="text-xs text-muted-foreground">
                {user?.role ?? "로그인이 필요합니다"}
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
