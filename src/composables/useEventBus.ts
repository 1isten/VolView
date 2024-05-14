import { inject, onMounted, onUnmounted } from 'vue';
import { Emitter } from 'mitt';

export interface LoadEventOptions {
  volumeKeyUID?: string;
  volumeKeySuffix?: string; // make use of volumeKeySuffix as volumeKeyUID
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
  // received from outside
  load: LoadEvent;
  unload: void;
  // ...

  // emit to outside
  slicing: {
    volumeKeyUID: string;
    slice: number;
  };
  // ...
};

export type Handlers = {
  load: (payload: Events['load']) => void;
  unload: () => void;
};

export function useEventBus(handlers?: Handlers) {
  const emitter: Emitter<Events> = inject('bus')!;
  const bus = { emitter };

  onMounted(() => {
    if (handlers) {
      emitter.on('load', handlers.load);
      emitter.on('unload', handlers.unload);
    }
  });

  onUnmounted(() => {
    if (handlers) {
      emitter.off('load', handlers.load);
      emitter.off('unload', handlers.unload);
    }
  });

  return bus;
}
