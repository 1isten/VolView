import { useMessageStore } from '@/src/store/messages';
import { Maybe } from '@/src/types';
import { logError } from '@/src/utils/loggers';
import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';
import { useToast } from '@/src/composables/useToast';
import { TYPE } from 'vue-toastification';
import { ToastID, ToastOptions } from 'vue-toastification/dist/types/types';

import { LPSAxisDir } from '@/src/types/lps';

export interface LoadEventOptions {
  uid?: string; // shortcut for volumeKeyUID
  volumeKeyUID?: string; // alias for volumeKeySuffix
  volumeKeySuffix?: string; // make use of volumeKeySuffix as UID
  layoutName?: string; // Quad View | Axial | Sagittal | Coronal | 3D
  changeLayout?: boolean | 'auto';
  changeSlice?: boolean | 'auto';
  // ...
  s?: number; // slice
  n?: number; // instance number (x00200013)
  i?: number; // index (from parsed data list)
  // ...
  loading?: boolean;
  atob?: boolean;
  prefetchFiles?: boolean;
  // ...
  openFolder?: string;
  openFile?: string;
  // ...
  zip?: boolean;
  zipObjectUrl?: string | null;
  // ...
  savedSession?: any;
}

export type LoadedByBusRecord = {
  options: LoadEventOptions;
  volumes: Record<
    string, // volumeKey
    {
      layoutName?: string;
      camera?: {
        Axial?: { viewDirection?: LPSAxisDir; viewUp?: LPSAxisDir };
        Sagittal?: { viewDirection?: LPSAxisDir; viewUp?: LPSAxisDir };
        Coronal?: { viewDirection?: LPSAxisDir; viewUp?: LPSAxisDir };
      },
      slices: {
        width?: number;
        level?: number;
        n: number;
        i: number;
      }[];
      wlDiffers?: boolean;
      wlConfiged?: Record<string, any>;
      wlConfigedByUser?: boolean;
      cached?: boolean;
    }
  >;
  volumeKeys: string[]; // ordered volumes

  cachedFiles?: {
    fileNameToPath: Record<string, string>; // new file name to original file path mapping
    fileByPath: Record<string, {
      name: string; // original file name
      tags?: Record<string, any>;
      isVolume?: boolean; // check (0002,0002) Media Storage SOP Class UID
      slice?: number;
      dataID?: string;
    }>;
    primarySelection?: string | null;
  };
};

export type LoadedByBus = Record<
  string, // volumeKeyUID
  LoadedByBusRecord
>;

export interface LoadEvent extends LoadEventOptions {
  urlParams: {
    urls: string[];
    names?: string[];
    // DICOMweb options:
    dicomWebURL?: string;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
    sopInstanceUID?: string;
  };
}

export type Events = {
  // received from outside
  onload: LoadEvent;
  onunload: void;
  onunselect: void;
  // ...

  // emit to outside
  onslicing?: {
    uid: string;
    slice: number;
  };
  onclose?: void;
  // ...
};

const NotificationMessages = {
  Loading: 'Loading datasets...',
  Done: 'Datasets loaded!',
  Error: 'Some files failed to load',
};

const LoadingToastOptions = {
  type: TYPE.INFO,
  timeout: false,
  closeButton: false,
  closeOnClick: false,
} satisfies ToastOptions;

export function useLoadingNotifications() {
  const messageStore = useMessageStore();

  const loadingCount = ref(0);
  const loadingError = ref<Maybe<Error>>();

  const startLoading = () => {
    loadingCount.value += 1;
  };

  const stopLoading = () => {
    if (loadingCount.value === 0) return;
    loadingCount.value -= 1;
  };

  const setError = (err: Error) => {
    loadingError.value = err;
  };

  const toast = useToast();
  let toastID: Maybe<ToastID> = null;

  const showLoadingToast = () => {
    if (toastID == null) {
      toastID = toast.info(NotificationMessages.Loading, LoadingToastOptions);
    } else {
      toast.update(toastID, {
        content: NotificationMessages.Loading,
        options: LoadingToastOptions,
      });
    }
  };

  const showResults = () => {
    if (toastID == null) return;
    const error = loadingError.value;
    loadingError.value = null;

    if (error) {
      logError(error);
      toast.dismiss(toastID);
      messageStore.addError(NotificationMessages.Error, error);
    } else {
      toast.update(toastID, {
        content: NotificationMessages.Done,
        options: {
          type: TYPE.SUCCESS,
          timeout: 3000,
          closeButton: 'button',
          closeOnClick: true,
          onClose() {
            toastID = null;
          },
        },
      });
    }
  };

  watch(loadingCount, (count) => {
    if (count) showLoadingToast();
    else showResults();
  });

  const isLoading = computed(() => {
    return loadingCount.value > 0;
  });

  return {
    isLoading,
    startLoading,
    stopLoading,
    setError,
  };
}

export const useLoadDataStore = defineStore('loadData', () => {
  const { startLoading, stopLoading, setError, isLoading } =
    useLoadingNotifications();

  const segmentGroupExtension = ref('');
  const layerExtension = ref('');

  const $bus = {
    emitter: null as any
  };
  const dataIDToVolumeKeyUID = shallowRef<Record<string, string>>(Object.create(null));
  const loadedByBus = shallowRef<LoadedByBus>(Object.create(null));
  const isLoadingByBus = ref(false);
  const isBusUnselected = ref(false);
  const getLoadedByBusOptions = (volumeKeyUID?: string) => volumeKeyUID && loadedByBus.value[volumeKeyUID]?.options || {};
  const setLoadedByBusOptions = (volumeKeyUID: string | undefined, options: LoadEventOptions) => {
    if (!volumeKeyUID) {
      return options;
    }
    if (!loadedByBus.value[volumeKeyUID]) {
      loadedByBus.value[volumeKeyUID] = Object.create(null);
      loadedByBus.value[volumeKeyUID].volumes = Object.create(null);
      loadedByBus.value[volumeKeyUID].volumeKeys = [];
      loadedByBus.value[volumeKeyUID].cachedFiles = {
        fileNameToPath: Object.create(null),
        fileByPath: Object.create(null),
        primarySelection: null,
      };
    }
    loadedByBus.value[volumeKeyUID].options = options;
    return loadedByBus.value[volumeKeyUID].options;
  };

  return {
    segmentGroupExtension,
    layerExtension,
    isLoading,
    startLoading,
    stopLoading,
    setError,

    volumeRendered: ref(Object.create(null)),
    hasProjectPort: ref(false),
    getLoadedByBusOptions,
    setLoadedByBusOptions,
    setIsLoadingByBus(value: boolean, uid?: string) {
      isLoadingByBus.value = value;
      if (!isLoadingByBus.value && isBusUnselected.value) {
        isBusUnselected.value = false;
      }
      if (!isLoadingByBus.value && uid) {
        const options = getLoadedByBusOptions(uid);
        if (options && options.zip && options.zipObjectUrl) {
          URL.revokeObjectURL(options.zipObjectUrl);
          options.zipObjectUrl = null;
        }
        delete options.loading;
      }
      return isLoadingByBus.value;
    },
    isLoadingByBus,
    isBusUnselected,
    loadedByBus,
    dataIDToVolumeKeyUID,
    removeLoadedByBus: (id: string | null) => {
      if (id && id in dataIDToVolumeKeyUID.value) {
        const volumeKeyUID = dataIDToVolumeKeyUID.value[id];
        delete dataIDToVolumeKeyUID.value[id];
        if (volumeKeyUID in loadedByBus.value) {
          delete loadedByBus.value[volumeKeyUID];
        }
      }
    },
    loadBus: (emitter?: any) => {
      $bus.emitter = emitter || null;
    },
    $bus,
  };
});

export default useLoadDataStore;
