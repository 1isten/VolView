import { clampValue } from '@/src/utils';
import { defineStore } from 'pinia';
import { reactive } from 'vue';
import {
  DoubleKeyRecord,
  deleteSecondKey,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { Maybe } from '@/src/types';
import useLoadDataStore from '@/src/store/load-data';
import { useDatasetStore } from '@/src/store/datasets';
import { useDICOMStore } from '@/src/store/datasets-dicom';
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
  const configs = reactive<DoubleKeyRecord<SliceConfig>>({});

  const getConfig = (viewID: Maybe<string>, dataID: Maybe<string>) =>
    getDoubleKeyRecord(configs, viewID, dataID);

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
  };

  const resetSlice = async (viewID: string, dataID: string) => {
    const config = getConfig(viewID, dataID);
    if (!config) return;

    const loadDataStore = useLoadDataStore();
    const dataStore = useDatasetStore();
    const selection = dataStore.primarySelection;

    const tryGetInitialSlice = async (retryCount = 100) => {
      let slice: number | undefined;
      if (
        viewID === 'Axial' ||
        viewID === 'Sagittal' ||
        viewID === 'Coronal'
      ) {
        while (slice === undefined && retryCount > 0) {
          const { initialSlices } = loadDataStore.getLoadedByBus(loadDataStore.imageIDToVolumeKeyUID[dataID]);
          if (initialSlices) {
            slice = initialSlices[viewID];
          }
          // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
          await new Promise(r => setTimeout(r, 10));
          // eslint-disable-next-line no-param-reassign
          retryCount--;
        }
      }
      if (typeof slice === 'number') {
        if (slice < config.min) {
          slice = config.min;
        } else if (slice > config.max) {
          slice = config.max;
        }
      }
      return slice;
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
