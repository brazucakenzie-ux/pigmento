/// <reference types="vite/client" />
import type { PigmentoApi } from '@shared/ipc';

declare global {
  interface Window {
    pigmento: PigmentoApi;
  }
}

export {};
