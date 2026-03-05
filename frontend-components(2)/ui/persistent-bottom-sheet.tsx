"use client"

import * as React from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

interface PersistentBottomSheetProps {
    children: React.ReactNode
    title: string
    subtitle?: string
    snapPoints?: number[] // Percentage heights: [min, mid, max]
    defaultSnap?: number // Index of default snap point
    isOpen: boolean
    onOpenChange: (open: boolean) => void
}

export function PersistentBottomSheet({
    children,
    title,
    subtitle,
    snapPoints = [0, 50, 85],
    defaultSnap = 0,
    isOpen,
    onOpenChange
}: PersistentBottomSheetProps) {
    const [currentSnap, setCurrentSnap] = React.useState(defaultSnap)
    const [isDragging, setIsDragging] = React.useState(false)
    const [startY, setStartY] = React.useState(0)
    const [currentY, setCurrentY] = React.useState(0)

    React.useEffect(() => {
        if (isOpen && currentSnap === 0) {
            setCurrentSnap(1) // Open to mid position when toggled
        } else if (!isOpen) {
            setCurrentSnap(0) // Minimize when closed
        }
    }, [isOpen])

    const handleDragStart = (clientY: number) => {
        setIsDragging(true)
        setStartY(clientY)
        setCurrentY(clientY)
    }

    const handleDragMove = (clientY: number) => {
        if (!isDragging) return
        setCurrentY(clientY)
    }

    const handleDragEnd = () => {
        if (!isDragging) return
        setIsDragging(false)

        const deltaY = currentY - startY
        const threshold = 50

        if (deltaY > threshold) {
            // Dragged down
            if (currentSnap > 0) {
                const newSnap = currentSnap - 1
                setCurrentSnap(newSnap)
                if (newSnap === 0) {
                    onOpenChange(false)
                }
            }
        } else if (deltaY < -threshold) {
            // Dragged up
            if (currentSnap < snapPoints.length - 1) {
                setCurrentSnap(currentSnap + 1)
                onOpenChange(true)
            }
        }
    }

    const handleHeaderClick = () => {
        if (currentSnap === 0) {
            setCurrentSnap(1)
            onOpenChange(true)
        } else {
            setCurrentSnap(0)
            onOpenChange(false)
        }
    }

    const currentHeight = snapPoints[currentSnap]
    const isMinimized = currentSnap === 0

    return (
        <div
            className={cn(
                "fixed bottom-0 left-0 right-0 z-50 md:hidden",
                "bg-card border-t border-border rounded-t-2xl",
                "shadow-lg transition-all duration-300 ease-out"
            )}
            style={{
                height: isMinimized ? 'auto' : `${currentHeight}vh`,
                transform: isDragging ? `translateY(${Math.max(0, currentY - startY)}px)` : 'translateY(0)'
            }}
        >
            {/* Drag Handle & Header - Always Visible */}
            <div
                className="cursor-grab active:cursor-grabbing"
                onMouseDown={(e) => handleDragStart(e.clientY)}
                onMouseMove={(e) => handleDragMove(e.clientY)}
                onMouseUp={handleDragEnd}
                onMouseLeave={handleDragEnd}
                onTouchStart={(e) => handleDragStart(e.touches[0].clientY)}
                onTouchMove={(e) => handleDragMove(e.touches[0].clientY)}
                onTouchEnd={handleDragEnd}
                onClick={handleHeaderClick}
            >
                {/* Drag Handle */}
                <div className="flex justify-center pt-3 pb-2">
                    <div className="w-12 h-1.5 bg-muted rounded-full" />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex-1">
                        <h3 className="font-semibold text-foreground">{title}</h3>
                        {subtitle && (
                            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
                        )}
                    </div>
                    <div className="shrink-0">
                        {isMinimized ? (
                            <ChevronUp className="h-5 w-5 text-muted-foreground" />
                        ) : (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        )}
                    </div>
                </div>
            </div>

            {/* Content - Only visible when expanded */}
            {!isMinimized && (
                <div
                    className="overflow-y-auto"
                    style={{
                        height: `calc(${currentHeight}vh - 80px)`
                    }}
                >
                    {children}
                </div>
            )}
        </div>
    )
}
