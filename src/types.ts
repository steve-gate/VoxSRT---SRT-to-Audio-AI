export interface SrtSegment {
  id: number;
  startTime: string;
  endTime: string;
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  audioUrl?: string;
  isGenerating?: boolean;
}

export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export interface AppState {
  segments: SrtSegment[];
  isProcessing: boolean;
  selectedVoice: VoiceName;
  language: string;
}
