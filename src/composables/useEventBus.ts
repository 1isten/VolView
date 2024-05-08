import { inject, onMounted, onUnmounted } from 'vue';
import { Emitter } from 'mitt';

export interface LoadEventOptions {
  volumeKeySuffix?: string; // make use of it as volumeKeyUID
  layoutName?: string;
  initialSlices?: {
    Axial?: number;
    Sagittal?: number;
    Coronal?: number;
  };
}

export interface LoadEvent extends LoadEventOptions {
  urlParams: {
    urls: [string];
    names?: [string];
    // DICOMweb options:
    dicomWebURL?: string;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
    sopInstanceUID?: string;
  };
}

export type Events = {
  load: LoadEvent;
};

export type Handlers = {
  load: (payload: Events['load']) => void;
};

export function useEventBus(handlers: Handlers) {
  const emitter: Emitter<Events> = inject('bus')!;
  const bus = { emitter };

  onMounted(() => {
    if (import.meta.env.DEV) {
      Reflect.set(window, '$bus', bus);
    }
    emitter.on('load', handlers.load);
  });

  onUnmounted(() => {
    if (import.meta.env.DEV) {
      Reflect.deleteProperty(window, '$bus');
    }
    emitter.off('load', handlers.load);
  });

  return bus;
}
