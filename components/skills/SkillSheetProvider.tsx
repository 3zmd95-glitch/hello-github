"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import SkillSheet from "./SkillSheet";

interface SkillSheetApi {
  open(skillId: string): void;
  close(): void;
}

const SkillSheetContext = createContext<SkillSheetApi>({ open: () => {}, close: () => {} });

/** Open the skill popup from any screen (Today, Skills, later the map). */
export function useSkillSheet(): SkillSheetApi {
  return useContext(SkillSheetContext);
}

export default function SkillSheetProvider({ children }: { children: ReactNode }) {
  const [skillId, setSkillId] = useState<string | null>(null);
  const open = useCallback((id: string) => setSkillId(id), []);
  const close = useCallback(() => setSkillId(null), []);
  const api = useMemo(() => ({ open, close }), [open, close]);
  return (
    <SkillSheetContext.Provider value={api}>
      {children}
      {skillId && <SkillSheet key={skillId} skillId={skillId} onClose={close} />}
    </SkillSheetContext.Provider>
  );
}
