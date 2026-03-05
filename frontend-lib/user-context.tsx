"use client"

import { createContext, useContext, useMemo, useState, type ReactNode } from "react"

export interface AppUser {
  id: string
  name: string
  role: string
  email: string
}

interface UserContextValue {
  user: AppUser | null
  users: AppUser[]
  switchUser: (userId: string) => void
  loginAsDefaultUser: () => void
  logout: () => void
}

const APP_USERS: AppUser[] = [
  {
    id: "rn-yun-sunhwa",
    name: "RN 윤선화",
    role: "Ward Nurse",
    email: "sunhwa.yoon@hospital.org",
  },
  {
    id: "dr-kim",
    name: "Dr. Kim",
    role: "Infectious Disease Specialist",
    email: "dr.kim@hospital.org",
  },
]

const DEFAULT_USER_ID = "rn-yun-sunhwa"

function resolveDefaultUser(): AppUser | null {
  return APP_USERS.find((candidate) => candidate.id === DEFAULT_USER_ID) ?? APP_USERS[0] ?? null
}

const UserContext = createContext<UserContextValue | undefined>(undefined)

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(resolveDefaultUser)

  const switchUser = (userId: string) => {
    const nextUser = APP_USERS.find((candidate) => candidate.id === userId)
    if (!nextUser) return
    setUser(nextUser)
  }

  const loginAsDefaultUser = () => {
    setUser(resolveDefaultUser())
  }

  const logout = () => {
    setUser(null)
  }

  const value = useMemo<UserContextValue>(
    () => ({
      user,
      users: APP_USERS,
      switchUser,
      loginAsDefaultUser,
      logout,
    }),
    [user]
  )

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export function useUser() {
  const context = useContext(UserContext)
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider")
  }
  return context
}
