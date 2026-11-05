import type { PigmentoApi } from '../../src/shared/ipc';

/** Shape of the test hook exposed by the renderer when PIGMENTO_E2E=1. */
export interface PigmentoTestHook {
  pixel(x: number, y: number): { r: number; g: number; b: number; a: number };
  doc(): { width: number; height: number };
  history(): { index: number; length: number; dirty: boolean };
  tool(): string;
  docToScreen(x: number, y: number): { x: number; y: number };
  liveKind(): string | null;
  selection(): { x: number; y: number; w: number; h: number } | null;
  openPath(path: string): Promise<void>;
  saveAs(path: string): Promise<void>;
  filePath(): string | null;
}

declare global {
  interface Window {
    pigmento: PigmentoApi;
    __pigmentoTest?: PigmentoTestHook;
  }
}
