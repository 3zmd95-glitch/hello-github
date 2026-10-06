import { create } from "zustand";

/** The Social shell's compact title (shown in the glass slab once the page scrolls). PageHeader sets it. */
export const useChrome = create<{ title: string; setTitle: (title: string) => void }>((set) => ({
  title: "",
  setTitle: (title) => set({ title }),
}));
