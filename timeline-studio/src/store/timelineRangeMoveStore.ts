import { create } from 'zustand';

interface TimelineRangeMovePreviewState {
  active: boolean;
  deltaSeconds: number;
  begin: () => void;
  update: (deltaSeconds: number) => void;
  reset: () => void;
}

/** Ephemeral cross-track preview state. It never participates in undo/redo. */
export const useTimelineRangeMoveStore = create<TimelineRangeMovePreviewState>((set) => ({
  active: false,
  deltaSeconds: 0,
  begin: () => set({ active: true, deltaSeconds: 0 }),
  update: (deltaSeconds) => set({ deltaSeconds }),
  reset: () => set({ active: false, deltaSeconds: 0 })
}));
