"use client"

import {
    BarChart3,
    LayoutGrid,
    MoreHorizontal,
    Users,
    BedDouble,
    ClipboardList,
    FileText,
    ClipboardCheck,
    X,
    Search,
} from "lucide-react"
import { cn } from "@/lib/utils"
// import { Button } from "@/components/ui/button" // Not strictly needed if using buttons directly
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarPage } from "@/components/dashboard/app-sidebar"
import { useState } from "react"
import { useRouter } from "next/navigation"

interface BottomNavProps {
    currentPage: SidebarPage
    onNavigate: (page: SidebarPage) => void
}

export function BottomNav({ currentPage, onNavigate }: BottomNavProps) {
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const router = useRouter()

    const mainItems = [
        { label: "워치", icon: LayoutGrid, page: "pc" as const },
        // Updated: 2nd item is Patient List, points to /patients
        { label: "환자 목록", icon: Users, page: "transfer" as const, path: "/patients" },
        { label: "감염 현황", icon: BarChart3, page: "infection" as const },
    ]

    const actionItems = [
        // Updated: MDRO links to Bed Allocation
        { label: "Smart Bed System", icon: BedDouble, page: "report" as const, path: "/bed-allocation" },
        { label: "격리 체크", icon: ClipboardList, page: "isolation" as const, path: "/isolation-checklist" },
        { label: "문서 초안", icon: FileText, page: "autodraft" as const },
        // Updated: Transfer Checklist moved to Actions
        { label: "전원 체크", icon: ClipboardCheck, page: "transferChecklist" as const, path: "/transfer-checklist" },
        { label: "지침서 검색", icon: Search, page: "guidelineSearch" as const, path: "/guideline-search" },
    ]

    const isActionPage = actionItems.some((item) => item.page === currentPage)

    const handleNavigation = (item: { page: SidebarPage; path?: string }) => {
        if (item.path) {
            router.push(item.path)
        } else {
            onNavigate(item.page)
        }
        setIsMenuOpen(false)
    }

    return (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t border-border bg-background px-2 pb-safe shadow-[0_-1px_3px_rgba(0,0,0,0.05)]">
            {mainItems.map((item) => {
                const Icon = item.icon
                // Highlight if currentPage matches
                const isActive = currentPage === item.page

                return (
                    <button
                        key={item.label}
                        onClick={() => handleNavigation(item)}
                        className={cn(
                            "flex flex-1 flex-col items-center justify-center gap-1 py-1 transition-colors select-none",
                            isActive ? "text-primary" : "text-muted-foreground hover:text-foreground active:text-primary/70"
                        )}
                    >
                        <Icon className={cn("h-5 w-5", isActive && "fill-current/20")} />
                        <span className="text-[10px] font-medium">{item.label}</span>
                    </button>
                )
            })}

            {/* Actions Menu */}
            <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                <DropdownMenuTrigger asChild>
                    <button
                        id="bottom-nav-actions-trigger"
                        className={cn(
                            "flex flex-1 flex-col items-center justify-center gap-1 py-1 transition-colors select-none",
                            isActionPage || isMenuOpen ? "text-primary" : "text-muted-foreground hover:text-foreground active:text-primary/70"
                        )}
                    >
                        {isMenuOpen ? (
                            <X className="h-5 w-5" />
                        ) : (
                            <MoreHorizontal className="h-5 w-5" />
                        )}
                        <span className="text-[10px] font-medium">액션</span>
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent id="bottom-nav-actions-content" align="end" side="top" className="w-56 mb-2">
                    {actionItems.map((item) => {
                        const Icon = item.icon
                        const isActive = currentPage === item.page
                        return (
                            <DropdownMenuItem
                                key={item.label}
                                onClick={() => handleNavigation(item)}
                                className={cn(
                                    "flex items-center gap-2 py-2.5 cursor-pointer",
                                    isActive && "bg-accent text-accent-foreground"
                                )}
                            >
                                <Icon className="h-4 w-4" />
                                <span>{item.label}</span>
                            </DropdownMenuItem>
                        )
                    })}

                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
