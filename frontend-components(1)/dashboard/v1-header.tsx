"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import { Settings, LogOut, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { SettingsDialog } from "@/components/clinical/settings-dialog"
import { NotificationBellPanel } from "@/components/clinical/notification-bell-panel"
import { useUser } from "@/lib/user-context"

interface V1HeaderProps {
    title?: string
    subtitle?: string
    subtitlePlacement?: "below" | "right"
    titleControls?: ReactNode
    rightContent?: ReactNode
}

export function V1Header({
    title,
    subtitle,
    subtitlePlacement = "below",
    titleControls,
    rightContent,
}: V1HeaderProps) {
    const [settingsOpen, setSettingsOpen] = useState(false)
    const { user, users, switchUser, loginAsDefaultUser, logout } = useUser()

    return (
        <>
            <header className="h-14 shrink-0 border-b border-border bg-card px-6">
                <div className="grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
                    {/* Left: Page context */}
                    <div className="min-w-0">
                        {title ? (
                            <div className="flex min-w-0 flex-col justify-center">
                                <div className="flex min-w-0 items-center gap-2">
                                    <h1 className="min-w-0 truncate text-[17px] font-semibold leading-tight text-foreground">
                                        {title}
                                    </h1>
                                    {subtitle && subtitlePlacement === "right" ? (
                                        <p className="min-w-0 truncate text-xs leading-tight text-muted-foreground">
                                            {subtitle}
                                        </p>
                                    ) : null}
                                    {titleControls ? (
                                        <div className="flex shrink-0 items-center gap-2">
                                            {titleControls}
                                        </div>
                                    ) : null}
                                </div>
                                {subtitle && subtitlePlacement === "below" ? (
                                    <p className="truncate text-xs leading-tight text-muted-foreground">
                                        {subtitle}
                                    </p>
                                ) : null}
                            </div>
                        ) : (
                            <div />
                        )}
                    </div>

                    {/* Right: Global utilities (fixed positions) */}
                    <div className="flex items-center justify-end gap-2">
                        {rightContent ? (
                            <div className="hidden md:block">{rightContent}</div>
                        ) : null}

                        {/* Settings */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-muted-foreground hover:text-foreground"
                            onClick={() => setSettingsOpen(true)}
                        >
                            <Settings className="h-5 w-5" />
                            <span className="sr-only">설정</span>
                        </Button>

                        {/* Notification Bell */}
                        <NotificationBellPanel />

                        {/* User Profile / Login */}
                        {user ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button id="v1-header-user-menu-trigger" variant="ghost" className="relative h-9 w-9 rounded-full">
                                        <Avatar className="h-9 w-9 border border-border">
                                            <AvatarImage src="/placeholder-user.jpg" alt={user.name} />
                                            <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                                        </Avatar>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent id="v1-header-user-menu-content" className="w-56" align="end" forceMount>
                                    <DropdownMenuLabel className="font-normal">
                                        <div className="flex flex-col space-y-1">
                                            <p className="text-sm font-medium leading-none">{user.name}</p>
                                            <p className="text-xs leading-none text-muted-foreground">
                                                {user.email}
                                            </p>
                                        </div>
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                                        사용자 전환
                                    </DropdownMenuLabel>
                                    <DropdownMenuRadioGroup value={user.id} onValueChange={switchUser}>
                                        {users.map((candidate) => (
                                            <DropdownMenuRadioItem key={candidate.id} value={candidate.id} className="cursor-pointer">
                                                <div className="flex flex-col">
                                                    <span>{candidate.name}</span>
                                                    <span className="text-[11px] text-muted-foreground">{candidate.role}</span>
                                                </div>
                                            </DropdownMenuRadioItem>
                                        ))}
                                    </DropdownMenuRadioGroup>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem className="cursor-pointer">프로필</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setSettingsOpen(true)} className="cursor-pointer">설정</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={logout} className="text-red-600 focus:text-red-600 cursor-pointer">
                                        <LogOut className="mr-2 h-4 w-4" />
                                        <span>로그아웃</span>
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : (
                            <Button onClick={loginAsDefaultUser} size="sm" variant="default" className="gap-2">
                                <User className="h-4 w-4" />
                                로그인
                            </Button>
                        )}
                    </div>
                </div>
            </header>

            <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        </>
    )
}
