import { clampValue } from '@/src/utils';
import { defineStore } from 'pinia';
import { reactive } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import {
  DoubleKeyRecord,
  deleteSecondKey,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { Maybe } from '@/src/types';
import { useCurrentImage, useImage } from '@/src/composables/useCurrentImage';
import { createViewConfigSerializer } from '@/src/store/view-configs/common';
import { ViewConfig } from '@/src/io/state-file/schema';
import { SliceConfig } from '@/src/store/view-configs/types';
import { useImageStore } from '@/src/store/datasets-images';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';

import { useWindowingStore } from './windowing';
import { useLoadDataStore } from '../load-data';

export const defaultSliceConfig = (): SliceConfig => ({
  slice: 0,
  min: 0,
  max: 1,
  syncState: false,
});

export const useViewSliceStore = defineStore('viewSlice', () => {
  const imageStore = useImageStore();
  const imageCacheStore = useImageCacheStore();
  const viewStore = useViewStore();
  const configs = reactive<DoubleKeyRecord<SliceConfig>>({});

  const loadDataStore = useLoadDataStore();
  const windowingStore = useWindowingStore();
  const handleConfigUpdate = useDebounceFn((viewID: string, dataID: string, config: any) => {
    let currentSliceMetadata: any = null;
    let volumeKeySuffix = loadDataStore.dataIDToVolumeKeyUID[dataID];
    if (volumeKeySuffix) {
      const vol = loadDataStore.loadedByBus[volumeKeySuffix].volumes[dataID];
      if (vol?.layoutName) {
        currentSliceMetadata = Object.create(null);
        const view = viewStore.getViewsForData(dataID).find((v) => v.id === viewID && v.dataID === dataID);
        if (view && vol.layoutName.includes(view.name)) {
          const emitter = loadDataStore.$bus.emitter;
          const sliceInfo = vol.slices[config.slice];
          if (
            sliceInfo?.width !== undefined &&
            sliceInfo?.level !== undefined
          ) {
            // per slice per wl
            if ((vol.wlDiffers || !vol.wlConfiged?.[viewID]) && !vol.wlConfigedByUser) {
              try {
                windowingStore.updateConfig(viewID, dataID, {
                  width: sliceInfo.width,
                  level: sliceInfo.level,
                });
              } catch (err) {
                console.warn(err);
              }
            }
          }
          const cachedFiles = loadDataStore.loadedByBus[volumeKeySuffix].cachedFiles;
          if (cachedFiles?.primarySelection) {
            const SeriesInstanceUID = cachedFiles.fileByPath[cachedFiles.fileNameToPath[cachedFiles.primarySelection]]?.tags?.SeriesInstanceUID;
            if (SeriesInstanceUID) {
              const cachedFilePath = Object.entries(cachedFiles.fileByPath).find(([, v]) => v.tags?.SeriesInstanceUID === SeriesInstanceUID && (v.isVolume ? v.dataID === dataID : v.slice === config.slice))?.[0];
              const cachedFile = cachedFilePath ? cachedFiles.fileByPath[cachedFilePath] : null;
              if (cachedFile) {
                cachedFiles.primarySelection = cachedFile.name;
                cachedFile.slice = config.slice;
                const hashPos = volumeKeySuffix.indexOf('#');
                if (hashPos !== -1) {
                  volumeKeySuffix = volumeKeySuffix.substring(0, hashPos);
                }
                emitter?.emit('slicing', {
                  uid: volumeKeySuffix,
                  slice: { s: cachedFile.slice },
                  filePath: cachedFilePath,
                });
                if (cachedFile.dataID && cachedFile.slice !== undefined) {
                  const cachedImage = imageCacheStore.imageById[cachedFile.dataID];
                  if (cachedImage?.loaded && 'chunks' in cachedImage) {
                    const cachedChunk = (cachedImage.chunks as any[])[cachedFile?.isVolume ? 0 : cachedFile?.slice];
                    if (cachedChunk) {
                      const dataBlob = cachedChunk.dataBlob;
                      if (dataBlob && dataBlob instanceof File && cachedChunk.metadata && Array.isArray(cachedChunk.metadata)) {
                        const tags = Object.fromEntries(cachedChunk.metadata);
                        const SopInstanceUID = tags['0008|0018'] || '';
                        currentSliceMetadata.dataID = cachedFile.dataID;
                        currentSliceMetadata.SopInstanceUID = SopInstanceUID;
                        currentSliceMetadata.file = dataBlob;
                      }
                    }
                  }
                }
              }
            }
          } else if (sliceInfo) {
            emitter?.emit('slicing', {
              uid: volumeKeySuffix,
              slice: { n: sliceInfo.n, i: sliceInfo.i },
            });
            const cachedImage = imageCacheStore.imageById[dataID];
            if (cachedImage?.loaded && 'chunks' in cachedImage) {
              const cachedChunk = (cachedImage.chunks as any[])[config.slice]; // TODO: comfirm config.slice index is correct mapping to chunk index??
              if (cachedChunk) {
                const dataBlob = cachedChunk.dataBlob;
                if (dataBlob && dataBlob instanceof File && cachedChunk.metadata && Array.isArray(cachedChunk.metadata)) {
                  const tags = Object.fromEntries(cachedChunk.metadata);
                  const SopInstanceUID = tags['0008|0018'] || '';
                  currentSliceMetadata.dataID = dataID;
                  currentSliceMetadata.SopInstanceUID = SopInstanceUID;
                  currentSliceMetadata.file = dataBlob;
                }
              }
            }
          }
        }
      }
    }
    if (currentSliceMetadata === null) {
      loadDataStore.currentSliceMetadata = null; // not dcm
    } else if (Object.keys(currentSliceMetadata).length === 0) {
      loadDataStore.currentSliceMetadata = currentSliceMetadata; // same dcm, just view switched
    } else if (loadDataStore.currentSliceMetadata?.SopInstanceUID !== currentSliceMetadata.SopInstanceUID) {
      loadDataStore.currentSliceMetadata = currentSliceMetadata;
    }
  }, 0);

  const computeDefaultSliceConfig = (
    viewID: Maybe<string>,
    imageID: Maybe<string>
  ): SliceConfig => {
    if (!viewID || !imageID) return defaultSliceConfig();

    const view = viewStore.getView(viewID);
    if (view?.type !== '2D') return defaultSliceConfig();

    const { orientation } = view.options;
    const { metadata } = useImage(imageID);
    const { lpsOrientation, dimensions } = metadata.value;
    const ijkIndex = lpsOrientation[orientation];
    const dimMax = dimensions[ijkIndex];

    return {
      min: 0,
      slice: Math.ceil((dimMax - 1) / 2),
      max: dimMax - 1,
      syncState: false,
    };
  };

  const getConfig = (viewID: Maybe<string>, dataID: Maybe<string>) =>
    getDoubleKeyRecord(configs, viewID, dataID) ??
    computeDefaultSliceConfig(viewID, dataID);

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

  const resetSlice = (viewID: string, dataID: string) => {
    const config = getConfig(viewID, dataID);
    if (!config) return;

    const volumeKeySuffix = loadDataStore.dataIDToVolumeKeyUID[dataID];
    if (volumeKeySuffix) {
      const vol = loadDataStore.loadedByBus[volumeKeySuffix].volumes[dataID];
      if (vol?.layoutName && vol.layoutName.includes(viewID)) {
        const options = loadDataStore.getLoadedByBusOptions(volumeKeySuffix);
        if (options.i !== undefined) {
          const sliceInfo = vol.slices[options.i];
          if (sliceInfo?.i !== undefined) {
            updateConfig(viewID, dataID, {
              slice: sliceInfo.i,
            });
            return;
          }
        }
      }
    }

    // Setting this to floor() will affect images where the
    // middle slice is fractional.
    // This is consistent with vtkImageMapper and SliceRepresentationProxy.
    updateConfig(viewID, dataID, {
      slice: Math.ceil((config.min + config.max) / 2),
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

  const toggleSyncImages = () => {
    // Synchronize all images when toggled
    Object.keys(configs).forEach((viewID) => {
      imageStore.idList.forEach((imageID) => {
        const { syncState } = {
          ...defaultSliceConfig(),
          ...getConfig(viewID, imageID),
        };
        updateConfig(viewID, imageID, { syncState: !syncState });
      });
    });
  };

  const isSync = () => {
    const allSync = Object.keys(configs).every((sc) =>
      Object.keys(configs[sc]).every((c) => configs[sc][c].syncState)
    );

    return allSync;
  };

  const updateSyncConfigs = () => {
    Object.keys(configs).forEach((viewID) => {
      const { currentImageID } = useCurrentImage('global');
      const config = getConfig(viewID, currentImageID.value);
      imageStore.idList.forEach((imageID) => {
        const { syncState } = {
          ...defaultSliceConfig(),
          ...getConfig(viewID, imageID),
        };

        if (syncState) {
          updateConfig(viewID, imageID, { slice: config?.slice });
        }
      });
    });
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
    toggleSyncImages,
    updateSyncConfigs,
    isSync,
    serialize,
    deserialize,
  };
});

export default useViewSliceStore;
