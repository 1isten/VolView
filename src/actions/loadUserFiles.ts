import { UrlParams } from '@vueuse/core';
import {
  fileToDataSource,
  uriToDataSource,
  DataSource,
  getDataSourceName,
} from '@/src/io/import/dataSource';
import { useLoadDataStore, type LoadEventOptions } from '@/src/store/load-data';
import { useDatasetStore } from '@/src/store/datasets';
import { useImageStore } from '@/src/store/datasets-images';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useViewStore } from '@/src/store/views';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { wrapInArray, nonNullable } from '@/src/utils';
import { basename } from '@/src/utils/path';
import { parseUrl } from '@/src/utils/url';
import { logError } from '@/src/utils/loggers';
import { PipelineResultSuccess, partitionResults } from '@/src/core/pipeline';
import {
  ImportDataSourcesResult,
  importDataSources,
  toDataSelection,
} from '@/src/io/import/importDataSources';
import {
  ImportResult,
  LoadableResult,
  VolumeResult,
  isLoadableResult,
  isVolumeResult,
} from '@/src/io/import/common';
import {
  fetchSeries,
  fetchInstance,
} from '@/src/core/dicom-web-api';

// higher value priority is preferred for picking a primary selection
const BASE_MODALITY_TYPES = {
  CT: { priority: 3 },
  MR: { priority: 3 },
  US: { priority: 2 },
  DX: { priority: 1 },
} as const;

function findBaseDicom(loadableDataSources: Array<LoadableResult>) {
  // find dicom dataset for primary selection if available
  const dicoms = loadableDataSources.filter(
    ({ dataType }) => dataType === 'dicom'
  );
  // prefer some modalities as base
  const dicomStore = useDICOMStore();
  const baseDicomVolumes = dicoms
    .map((dicomSource) => {
      const volumeInfo = dicomStore.volumeInfo[dicomSource.dataID];
      const modality = volumeInfo?.Modality as keyof typeof BASE_MODALITY_TYPES;
      if (modality in BASE_MODALITY_TYPES)
        return {
          dicomSource,
          priority: BASE_MODALITY_TYPES[modality]?.priority,
          volumeInfo,
        };
      return undefined;
    })
    .filter(nonNullable)
    .sort(
      (
        { priority: a, volumeInfo: infoA },
        { priority: b, volumeInfo: infoB }
      ) => {
        const priorityDiff = a - b;
        if (priorityDiff !== 0) return priorityDiff;
        // same modality, then more slices preferred
        if (!infoA.NumberOfSlices) return 1;
        if (!infoB.NumberOfSlices) return -1;
        return infoB.NumberOfSlices - infoA.NumberOfSlices;
      }
    );
  if (baseDicomVolumes.length) return baseDicomVolumes[0].dicomSource;
  return undefined;
}

function isSegmentation(extension: string, name: string) {
  if (!extension) return false; // avoid 'foo..bar' if extension is ''
  const extensions = name.split('.').slice(1);
  return extensions.includes(extension);
}

// does not pick segmentation images
function findBaseImage(
  loadableDataSources: Array<LoadableResult>,
  segmentGroupExtension: string
) {
  const baseImages = loadableDataSources
    .filter(({ dataType }) => dataType === 'image')
    .filter((importResult) => {
      const name = getDataSourceName(importResult.dataSource);
      if (!name) return false;
      return !isSegmentation(segmentGroupExtension, name);
    });

  if (baseImages.length) return baseImages[0];
  return undefined;
}

// returns image and dicom sources, no config files
function filterLoadableDataSources(
  succeeded: Array<PipelineResultSuccess<ImportResult>>
) {
  return succeeded.flatMap((result) => {
    return result.data.filter(isLoadableResult);
  });
}

// Returns list of dataSources with file names where the name has the extension argument
// and the start of the file name matches the primary file name.
function filterMatchingNames(
  primaryDataSource: VolumeResult,
  succeeded: Array<PipelineResultSuccess<ImportResult>>,
  extension: string
) {
  const dicomStore = useDICOMStore();
  const primaryName =
    primaryDataSource.dataType === 'dicom'
      ? dicomStore.volumeInfo[primaryDataSource.dataID].SeriesNumber
      : getDataSourceName(primaryDataSource.dataSource);
  if (!primaryName) return [];
  const primaryNamePrefix = primaryName.split('.').slice(0, 1).join();
  return filterLoadableDataSources(succeeded)
    .filter((ds) => ds !== primaryDataSource)
    .map((importResult) => ({
      importResult,
      name: getDataSourceName(importResult.dataSource),
    }))
    .filter(({ name }) => {
      if (!name) return false;
      const hasExtension = isSegmentation(extension, name);
      const nameMatchesPrimary = name.startsWith(primaryNamePrefix);
      return hasExtension && nameMatchesPrimary;
    })
    .map(({ importResult }) => importResult);
}

function getStudyUID(volumeID: string) {
  const dicomStore = useDICOMStore();
  const studyKey = dicomStore.volumeStudy[volumeID];
  return dicomStore.studyInfo[studyKey]?.StudyInstanceUID;
}

function findBaseDataSource(
  succeeded: Array<PipelineResultSuccess<ImportResult>>,
  segmentGroupExtension: string
) {
  const loadableDataSources = filterLoadableDataSources(succeeded);
  const baseDicom = findBaseDicom(loadableDataSources);
  if (baseDicom) return baseDicom;

  const baseImage = findBaseImage(loadableDataSources, segmentGroupExtension);
  if (baseImage) return baseImage;
  return loadableDataSources[0];
}

function filterOtherVolumesInStudy(
  volumeID: string,
  succeeded: Array<PipelineResultSuccess<ImportResult>>
) {
  const targetStudyUID = getStudyUID(volumeID);
  const dicomDataSources = filterLoadableDataSources(succeeded).filter(
    ({ dataType }) => dataType === 'dicom'
  );
  return dicomDataSources.filter((ds) => {
    const sourceStudyUID = getStudyUID(ds.dataID);
    return sourceStudyUID === targetStudyUID && ds.dataID !== volumeID;
  }) as Array<VolumeResult>;
}

// Layers a DICOM PET on a CT if found
function loadLayers(
  primaryDataSource: VolumeResult,
  succeeded: Array<PipelineResultSuccess<ImportResult>>
) {
  if (primaryDataSource.dataType !== 'dicom') return;
  const otherVolumesInStudy = filterOtherVolumesInStudy(
    primaryDataSource.dataID,
    succeeded
  );
  const dicomStore = useDICOMStore();
  const primaryModality =
    dicomStore.volumeInfo[primaryDataSource.dataID].Modality;
  if (primaryModality !== 'CT') return;
  // Look for one PET volume to layer with CT.  Only one as there are often multiple "White Balance" corrected PET volumes.
  const toLayer = otherVolumesInStudy.find((ds) => {
    const otherModality = dicomStore.volumeInfo[ds.dataID].Modality;
    return otherModality === 'PT';
  });
  if (!toLayer) return;

  const primarySelection = toDataSelection(primaryDataSource);
  const layersStore = useLayersStore();
  const layerSelection = toDataSelection(toLayer);
  layersStore.addLayer(primarySelection, layerSelection);
}

// Loads other DataSources as Segment Groups:
// - DICOM SEG modalities with matching StudyUIDs.
// - DataSources that have a name like foo.segmentation.bar and the primary DataSource is named foo.baz
function loadSegmentations(
  primaryDataSource: VolumeResult,
  succeeded: Array<PipelineResultSuccess<ImportResult>>,
  segmentGroupExtension: string
) {
  const matchingNames = filterMatchingNames(
    primaryDataSource,
    succeeded,
    segmentGroupExtension
  ).filter(
    isVolumeResult // filter out models
  );

  const dicomStore = useDICOMStore();
  const otherSegVolumesInStudy = filterOtherVolumesInStudy(
    primaryDataSource.dataID,
    succeeded
  ).filter((ds) => {
    const modality = dicomStore.volumeInfo[ds.dataID].Modality;
    if (!modality) return false;
    return modality.trim() === 'SEG';
  });

  const segmentGroupStore = useSegmentGroupStore();
  [...otherSegVolumesInStudy, ...matchingNames].forEach((ds) => {
    const loadable = toDataSelection(ds);
    segmentGroupStore.convertImageToLabelmap(
      loadable,
      toDataSelection(primaryDataSource)
    );
  });
}

function loadDataSources(sources: DataSource[], volumeKeySuffix?: string) {
  const load = async () => {
    const loadDataStore = useLoadDataStore();
    const dataStore = useDatasetStore();

    let results: ImportDataSourcesResult[];
    try {
      results = await importDataSources(sources, volumeKeySuffix);
    } catch (error) {
      loadDataStore.setError(error as Error);
      return;
    }

    const [succeeded, errored] = partitionResults(results);

    if (!dataStore.primarySelection || succeeded.length) {
      const primaryDataSource = findBaseDataSource(
        succeeded,
        loadDataStore.segmentGroupExtension
      );

      if (isVolumeResult(primaryDataSource)) {
        let selection = toDataSelection(primaryDataSource);

        if (volumeKeySuffix) {
          let dataID: string | null = null;
          let viewID: string | null = null;
          let s = -1;

          const { volumes, options } = loadDataStore.loadedByBus[volumeKeySuffix];

          if (typeof options.s === 'number') {
            const vol = volumes[selection];
            if (vol?.layoutName) {
              useViewStore().setLayoutByName(vol.layoutName);
              s = options.s;
              if (s !== -1) {
                dataID = selection;
                viewID = useImageStore().getPrimaryViewID(dataID);
              }
            }
          } else if (typeof options.n === 'number') {
            selection = '';
            // eslint-disable-next-line no-restricted-syntax
            for (const volumeKey of Object.keys(volumes)) {
              const vol = volumes[volumeKey];
              if (vol?.layoutName) {
                useViewStore().setLayoutByName(vol.layoutName);
                s = vol.slices.findIndex(({ n }) => n === options.n);
                if (s !== -1) {
                  selection = volumeKey;
                  dataID = volumeKey;
                  viewID = useImageStore().getPrimaryViewID(volumeKey);
                  break;
                }
              }
            }
          } else if (typeof options.i === 'number') {
            selection = '';
            // eslint-disable-next-line no-restricted-syntax
            for (const volumeKey of Object.keys(volumes)) {
              const vol = volumes[volumeKey];
              if (vol?.layoutName) {
                useViewStore().setLayoutByName(vol.layoutName);
                s = vol.slices.findIndex(({ i }) => i === options.i);
                if (s !== -1) {
                  selection = volumeKey;
                  dataID = volumeKey;
                  viewID = useImageStore().getPrimaryViewID(volumeKey);
                  break;
                }
              }
            }
          }
          requestAnimationFrame(() => {
            if (viewID && dataID && s !== -1) {
              useViewSliceStore().updateConfig(viewID, dataID, { slice: s });
            }
          });
        }

        dataStore.setPrimarySelection(selection || null);
        loadLayers(primaryDataSource, succeeded);
        loadSegmentations(
          primaryDataSource,
          succeeded,
          loadDataStore.segmentGroupExtension
        );
      } // then must be primaryDataSource.type === 'model'

      if (loadDataStore.isLoadingByBus) {
        loadDataStore.isLoadingByBus = false;
      }
    }

    if (errored.length) {
      const errorMessages = errored.map((errResult) => {
        // pick first error
        const [firstError] = errResult.errors;
        // pick innermost dataset that errored
        const name = getDataSourceName(firstError.inputDataStackTrace[0]);
        // log error for debugging
        logError(firstError.cause);
        return `- ${name}: ${firstError.message}`;
      });
      const failedError = new Error(
        `These files failed to load:\n${errorMessages.join('\n')}`
      );

      loadDataStore.setError(failedError);
    }
  };

  const wrapWithLoading = <T extends (...args: any[]) => void>(fn: T) => {
    const { startLoading, stopLoading } = useLoadDataStore();
    return async function wrapper(...args: any[]) {
      try {
        startLoading();
        await fn(...args);
      } finally {
        stopLoading();
      }
    };
  };

  return wrapWithLoading(load)();
}

export function openFileDialog() {
  return new Promise<File[]>((resolve) => {
    const fileEl = document.createElement('input');
    fileEl.setAttribute('type', 'file');
    fileEl.setAttribute('multiple', 'multiple');
    fileEl.setAttribute('accept', '*');
    fileEl.addEventListener('change', () => {
      const files = [...(fileEl.files ?? [])];
      resolve(files);
    });
    fileEl.click();
  });
}

export async function loadFiles(files: File[], volumeKeySuffix?: string) {
  const dataSources = files.map(fileToDataSource);
  return loadDataSources(dataSources, volumeKeySuffix);
}

export async function loadUserPromptedFiles() {
  const files = await openFileDialog();
  return loadFiles(files);
}

export async function loadUrls(params: UrlParams, options?: LoadEventOptions) {
  const urls = wrapInArray(params.urls);
  const names = wrapInArray(params.names ?? []); // optional names should resolve to [] if params.names === undefined
  const sources = urls.map((url, idx) =>
    uriToDataSource(
      url,
      names[idx] ||
        basename(parseUrl(url, window.location.href).pathname) ||
        url
    )
  );

  // intercept load event from bus emitter
  if (options && options.volumeKeySuffix) {
    const loadDataStore = useLoadDataStore();
    const volumeKeySuffix = loadDataStore.setLoadedByBusOptions(options.volumeKeySuffix, options).volumeKeySuffix!;

    const beforeLoadByBus = () => {
      const { volumeKeys, volumes } = loadDataStore.loadedByBus[volumeKeySuffix];
      if (volumeKeys?.length && volumes) {
        if (typeof options.s === 'number') {
          // eslint-disable-next-line no-restricted-syntax
          for (const volumeKey of Object.keys(volumes)) {
            const vol = volumes[volumeKey];
            const s = options.s;
            if (vol?.slices[options.s]) {
              const viewID = useImageStore().getPrimaryViewID(volumeKey);
              if (viewID) {
                if (vol?.layoutName) {
                  // console.log('cache hit!', volumeKey, vol.layoutName, s);
                  // useViewStore().setLayoutByName(vol.layoutName);
                }
                useViewSliceStore().updateConfig(viewID, volumeKey, { slice: s });
                useDatasetStore().setPrimarySelection(volumeKey);
                // eslint-disable-next-line no-return-assign
                return (loadDataStore.isLoadingByBus = false);
              }
            }
          }
        } else if (typeof options.n === 'number') {
          // eslint-disable-next-line no-restricted-syntax
          for (const volumeKey of Object.keys(volumes)) {
            const vol = volumes[volumeKey];
            const s = vol?.slices?.findIndex(({ n }) => n === options.n) ?? -1;
            if (s !== -1) {
              const viewID = useImageStore().getPrimaryViewID(volumeKey);
              if (viewID) {
                if (vol?.layoutName) {
                  // console.log('cache hit!', volumeKey, vol.layoutName, s);
                  // useViewStore().setLayoutByName(vol.layoutName);
                }
                useViewSliceStore().updateConfig(viewID, volumeKey, { slice: s });
                useDatasetStore().setPrimarySelection(volumeKey);
                // eslint-disable-next-line no-return-assign
                return (loadDataStore.isLoadingByBus = false);
              }
            }
          }
        } else if (typeof options.i === 'number') {
          // eslint-disable-next-line no-restricted-syntax
          for (const volumeKey of Object.keys(volumes)) {
            const vol = volumes[volumeKey];
            const s = vol?.slices?.findIndex(({ i }) => i === options.i) ?? -1;
            if (s !== -1) {
              const viewID = useImageStore().getPrimaryViewID(volumeKey);
              if (viewID) {
                if (vol?.layoutName) {
                  // console.log('cache hit!', volumeKey, vol.layoutName, s);
                  // useViewStore().setLayoutByName(vol.layoutName);
                }
                useViewSliceStore().updateConfig(viewID, volumeKey, { slice: s });
                useDatasetStore().setPrimarySelection(volumeKey);
                // eslint-disable-next-line no-return-assign
                return (loadDataStore.isLoadingByBus = false);
              }
            }
          }
        }
        loadDataStore.isLoadingByBus = false;
      }
      // eslint-disable-next-line no-return-assign
      return (loadDataStore.isLoadingByBus = true);
    };

    const dicomWebURL = params.dicomWebURL?.toString();
    if (dicomWebURL) {
      const dicomWebFiles: File[] = [];
      const studyInstanceUID = params.studyInstanceUID?.toString();
      const seriesInstanceUID = params.seriesInstanceUID?.toString();
      const sopInstanceUID = params.sopInstanceUID?.toString();
      if (studyInstanceUID && seriesInstanceUID) {
        if (sopInstanceUID) {
          try {
            const file = await fetchInstance(dicomWebURL, {
              studyInstanceUID,
              seriesInstanceUID,
              sopInstanceUID,
            });
            dicomWebFiles.push(file);
          } catch (error) {
            console.error(error);
          }
        } else {
          try {
            const files = await fetchSeries(dicomWebURL, {
              studyInstanceUID,
              seriesInstanceUID,
            }, ({ loaded, total }: ProgressEvent) => {
              console.info(`fetching series ${loaded} of ${total}`);
            });
            dicomWebFiles.push(...files);
          } catch (error) {
            console.error(error);
          }
        }
      }
      return beforeLoadByBus() && loadFiles(dicomWebFiles, volumeKeySuffix);
    }
    return beforeLoadByBus() && loadDataSources(sources, volumeKeySuffix);
  }

  return loadDataSources(sources);
}
