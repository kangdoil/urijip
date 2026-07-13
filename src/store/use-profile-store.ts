import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ProfileState {
  displayName: string
  setDisplayName: (name: string) => void
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      displayName: '',
      setDisplayName: (name) => set({ displayName: name }),
    }),
    { name: 'urijib-profile' }
  )
)
