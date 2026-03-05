"use client"

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface BottomSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    children: React.ReactNode
    title?: string
}

export function BottomSheet({ open, onOpenChange, children, title }: BottomSheetProps) {
    React.useEffect(() => {
        if (open) {
            document.body.style.overflow = "hidden"
        } else {
            document.body.style.overflow = ""
        }
        return () => {
            document.body.style.overflow = ""
        }
    }, [open])

    if (!open) return null

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
                onClick={() => onOpenChange(false)}
            />

            {/* Bottom Sheet */}
            <div
                className={cn(
                    "fixed bottom-0 left-0 right-0 z-50",
                    "bg-card border-t border-border rounded-t-2xl",
                    "shadow-lg",
                    "animate-in slide-in-from-bottom duration-300"
                )}
                style={{ maxHeight: "80vh" }}
            >
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-2">
                    <div className="w-12 h-1.5 bg-muted rounded-full" />
                </div>

                {/* Header */}
                {title && (
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                        <h3 className="font-semibold text-foreground">{title}</h3>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => onOpenChange(false)}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                )}

                {/* Content */}
                <div className="overflow-y-auto" style={{ maxHeight: title ? "calc(80vh - 120px)" : "calc(80vh - 60px)" }}>
                    {children}
                </div>
            </div>
        </>
    )
}
