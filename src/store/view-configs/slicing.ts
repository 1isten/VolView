import { clampValue } from '@/src/utils';
import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import {
  DoubleKeyRecord,
  deleteSecondKey,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { Maybe } from '@/src/types';
import useLoadDataStore from '@/src/store/load-data';
import { useDatasetStore } from '@/src/store/datasets';
import { useImageStore } from '@/src/store/datasets-images';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import useWindowingStore from '@/src/store/view-configs/windowing';
import { useEventBus } from '@/src/composables/useEventBus';
import { createViewConfigSerializer } from './common';
import { ViewConfig } from '../../io/state-file/schema';
import { SliceConfig } from './types';


export const defaultSliceConfig = (): SliceConfig => ({
  slice: 0,
  min: 0,
  max: 1,
  axisDirection: 'Inferior',
});

export const useViewSliceStore = defineStore('viewSlice', () => {
  const { emitter } = useEventBus();

  const configs = reactive<DoubleKeyRecord<SliceConfig>>({});
  const syncWindowLevelWithTag = ref(true);

  const getConfig = (viewID: Maybe<string>, dataID: Maybe<string>) =>
    getDoubleKeyRecord(configs, viewID, dataID);

  const handleConfigUpdate = useDebounceFn((viewID, dataID, config) => {
    const loadDataStore = useLoadDataStore();
    const volumeKeyUID = loadDataStore.imageIDToVolumeKeyUID[dataID];
    const { layoutName } = loadDataStore.getLoadedByBus(volumeKeyUID);
    if (layoutName && layoutName.includes(viewID) || volumeKeyUID && useImageStore().getPrimaryViewID(dataID) === viewID) {
      if (syncWindowLevelWithTag.value) {
        const dicomStore = useDICOMStore();
        const volumeSlicesInfo = dicomStore.volumeSlicesInfo[dicomStore.imageIDToVolumeKey[dataID]];
        if (volumeSlicesInfo && volumeSlicesInfo.windowingDiffs) {
          const tag = volumeSlicesInfo.tags?.[config.slice];
          const dataRange = volumeSlicesInfo.dataRanges?.[config.slice];
          if (tag && dataRange) {
            const { WindowLevel, WindowWidth } = tag;
            const { min, max } = dataRange;
            try {
              // console.warn(`auto reset windowing based on dicom tags for slice ${config.slice + 1}`);
              const windowingStore = useWindowingStore();
              windowingStore.updateConfig(viewID, dataID, {
                width: Number(WindowWidth),
                level: Number(WindowLevel),
                min,
                max,
              });
            } catch (error) {
              console.warn(error);
            }
          }
        }
      }
    }
    if (volumeKeyUID) {
      emitter.emit('slicing', {
        uid: volumeKeyUID,
        slice: config.slice,
      });
    }
  }, 1);

  const updateConfig = (
    viewID: string,
    dataID: string,
    patch: Partial<SliceConfig>
  ) => {
    const config = {
      ...defaultSliceConfig(),
      ...getConfig(viewID, dataID),
      ...patch,
    };

    config.slice = clampValue(config.slice, config.min, config.max);
    patchDoubleKeyRecord(configs, viewID, dataID, config);

    handleConfigUpdate(viewID, dataID, config);
  };

  const resetSlice = async (viewID: string, dataID: string) => {
    const config = getConfig(viewID, dataID);
    if (!config) return;

    const loadDataStore = useLoadDataStore();
    const dataStore = useDatasetStore();
    const selection = dataStore.primarySelection;

    const tryGetInitialSlice = async (retryCount = 100) => {
      let s: number | undefined;
      if (
        viewID === 'Axial' ||
        viewID === 'Sagittal' ||
        viewID === 'Coronal'
      ) {
        while (s === undefined && retryCount > 0) {
          const loadedByBus = loadDataStore.loadedByBus[loadDataStore.imageIDToVolumeKeyUID[dataID]];
          if (loadedByBus) {
            if (!('defaultSlices' in loadedByBus || 'slice' in loadedByBus)) {
              break;
            }
          }
          const { defaultSlices, slice } = loadedByBus || {};
          if (defaultSlices) {
            s = defaultSlices[viewID];
          } else if (slice !== undefined) {
            s = slice;
          }
          // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
          await new Promise(r => setTimeout(r, 10));
          // eslint-disable-next-line no-param-reassign
          retryCount--;
        }
      }
      if (typeof s === 'number') {
        if (s < config.min) {
          s = config.min;
        } else if (s > config.max) {
          s = config.max;
        }
      }
      return s;
    };
    const initialSlice = selection && selection.type === 'dicom' && useDICOMStore().volumeKeyGetSuffix(selection.volumeKey) ? await tryGetInitialSlice() : undefined;

    // Setting this to floor() will affect images where the
    // middle slice is fractional.
    // This is consistent with vtkImageMapper and SliceRepresentationProxy.
    updateConfig(viewID, dataID, {
      slice: initialSlice !== undefined ? initialSlice : Math.ceil((config.min + config.max) / 2),
    });
  };

  const removeView = (viewID: string) => {
    delete configs[viewID];
  };

  const removeData = (dataID: string, viewID?: string) => {
    if (viewID) {
      delete configs[viewID]?.[dataID];
    } else {
      deleteSecondKey(configs, dataID);
    }
  };

  const serialize = createViewConfigSerializer(configs, 'slice');

  const deserialize = (viewID: string, config: Record<string, ViewConfig>) => {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.slice) {
        updateConfig(viewID, dataID, viewConfig.slice);
      }
    });
  };

  return {
    configs,
    getConfig,
    updateConfig,
    resetSlice,
    removeView,
    removeData,
    serialize,
    deserialize,
  };
});

export default useViewSliceStore;
