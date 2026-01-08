import { UrlParams, useUrlSearchParams } from '@vueuse/core';
import {
  fileToDataSource,
  uriToDataSource,
  DataSource,
  getDataSourceName,
} from '@/src/io/import/dataSource';
import { useLoadDataStore, type LoadEventOptions } from '@/src/store/load-data';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { wrapInArray, nonNullable, partition } from '@/src/utils';
import { basename } from '@/src/utils/path';
import { parseUrl } from '@/src/utils/url';
import { logError } from '@/src/utils/loggers';
import {
  importDataSources,
  toDataSelection,
} from '@/src/io/import/importDataSources';
import {
  ErrorResult,
  ImportResult,
  LoadableResult,
  LoadableVolumeResult,
  isLoadableResult,
  isVolumeResult,
  ImportDataSourcesResult,
} from '@/src/io/import/common';
import { isDicomImage } from '@/src/utils/dataSelection';
import { useViewStore } from '@/src/store/views';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useDatasetStore } from '@/src/store/datasets';
import { useImageCacheStore } from '@/src/store/image-cache';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';

import JSZip from 'jszip';
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
  const dicoms = loadableDataSources.filter(({ dataID }) =>
    isDicomImage(dataID)
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

function sortByDataSourceName(a: LoadableResult, b: LoadableResult) {
  const nameA = getDataSourceName(a.dataSource) ?? '';
  const nameB = getDataSourceName(b.dataSource) ?? '';
  return nameA.localeCompare(nameB);
}

// does not pick segmentation or layer images
function findBaseImage(
  loadableDataSources: Array<LoadableResult>,
  segmentGroupExtension: string,
  layerExtension: string
) {
  const baseImages = loadableDataSources
    .filter(({ dataType }) => dataType === 'image')
    .filter((importResult) => {
      const name = getDataSourceName(importResult.dataSource);
      if (!name) return false;
      return (
        !isSegmentation(segmentGroupExtension, name) &&
        !isSegmentation(layerExtension, name)
      );
    });

  if (baseImages.length) return baseImages[0];
  return undefined;
}

// returns image and dicom sources, no config files
function filterLoadableDataSources(succeeded: Array<ImportResult>) {
  return succeeded.filter(isLoadableResult);
}

// Returns list of dataSources with file names where the name has the extension argument
// and the start of the file name matches the primary file name.
function filterMatchingNames(
  primaryDataSource: LoadableVolumeResult,
  succeeded: Array<ImportResult>,
  extension: string
) {
  const dicomStore = useDICOMStore();
  const primaryName = isDicomImage(primaryDataSource.dataID)
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
  succeeded: Array<ImportResult>,
  segmentGroupExtension: string,
  layerExtension: string
) {
  const loadableDataSources = filterLoadableDataSources(succeeded);
  const baseDicom = findBaseDicom(loadableDataSources);
  if (baseDicom) return baseDicom;

  const baseImage = findBaseImage(
    loadableDataSources,
    segmentGroupExtension,
    layerExtension
  );
  if (baseImage) return baseImage;
  return loadableDataSources[0];
}

function filterOtherVolumesInStudy(
  volumeID: string,
  succeeded: Array<ImportResult>
) {
  const targetStudyUID = getStudyUID(volumeID);
  const dicomDataSources = filterLoadableDataSources(succeeded).filter(
    ({ dataID }) => isDicomImage(dataID)
  );
  return dicomDataSources.filter((ds) => {
    const sourceStudyUID = getStudyUID(ds.dataID);
    return sourceStudyUID === targetStudyUID && ds.dataID !== volumeID;
  }) as Array<LoadableVolumeResult>;
}

// Layers a DICOM PET on a CT if found
function autoLayerDicoms(
  primaryDataSource: LoadableVolumeResult,
  succeeded: Array<ImportResult>
) {
  if (!isDicomImage(primaryDataSource.dataID)) return;
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

function autoLayerByName(
  primaryDataSource: LoadableVolumeResult,
  succeeded: Array<ImportResult>,
  layerExtension: string
) {
  if (isDicomImage(primaryDataSource.dataID)) return;
  const matchingLayers = filterMatchingNames(
    primaryDataSource,
    succeeded,
    layerExtension
  )
    .filter(isVolumeResult)
    .sort(sortByDataSourceName);

  const primarySelection = toDataSelection(primaryDataSource);
  const layersStore = useLayersStore();
  matchingLayers.forEach((ds) => {
    const layerSelection = toDataSelection(ds);
    layersStore.addLayer(primarySelection, layerSelection);
  });
}

// Loads other DataSources as Segment Groups:
// - DICOM SEG modalities with matching StudyUIDs.
// - DataSources that have a name like foo.segmentation.bar and the primary DataSource is named foo.baz
function loadSegmentations(
  primaryDataSource: LoadableVolumeResult,
  succeeded: Array<ImportResult>,
  segmentGroupExtension: string
) {
  const matchingNames = filterMatchingNames(
    primaryDataSource,
    succeeded,
    segmentGroupExtension
  )
    .filter(
      isVolumeResult // filter out models
    )
    .sort(sortByDataSourceName);

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
  const loadDataStore = useLoadDataStore();
  const imageCacheStore = useImageCacheStore();
  const viewStore = useViewStore();
  const viewSliceStore = useViewSliceStore();

  const load = async () => {
    let results: ImportDataSourcesResult[];
    try {
      results = (await importDataSources(sources, volumeKeySuffix)).filter((result) =>
        // only look at data and error results
        ['data', 'error'].includes(result.type)
      );
    } catch (error) {
      loadDataStore.setError(error as Error);
      return;
    }

    const [succeeded, errored] = partition(
      (result) => result.type !== 'error',
      results
    );

    const shouldShowData = viewStore
      .getAllViews()
      // .every((view) => !view.dataID);
      .length;

    if (succeeded.length && shouldShowData) {
      const primaryDataSource = findBaseDataSource(
        succeeded,
        loadDataStore.segmentGroupExtension,
        loadDataStore.layerExtension
      );

      if (isVolumeResult(primaryDataSource)) {
        let selection = toDataSelection(primaryDataSource);
        if (volumeKeySuffix) {
          let dataID: string | null | undefined;
          let viewID: string | null | undefined;
          let s = -1;

          const { volumes, options } = loadDataStore.loadedByBus[volumeKeySuffix];

          if (
            // options.changeSlice === false ||
            options.s === undefined &&
            options.n === undefined &&
            options.i === undefined
          ) {
            const vol = volumes[selection];
            if (vol) {
              const layoutName = options.layoutName || useUrlSearchParams().layoutName;
              if (options.changeLayout === false) {
                //
              } else if (layoutName && options.changeLayout !== 'auto') {
                viewStore.setLayoutByName(layoutName.toString(), true);
              } else if (vol.layoutName) {
                viewStore.setLayoutByName(vol.layoutName, true);
              }
            } else { // maybe not dcm, like nifti etc.
              const layoutName = options.layoutName || useUrlSearchParams().layoutName;
              if (options.changeLayout === false) {
                //
              } else if (layoutName && options.changeLayout !== 'auto') {
                viewStore.setLayoutByName(layoutName.toString(), true);
              }
            }
          } else if (typeof options.s === 'number') {
            const vol = volumes[selection];
            if (vol) {
              const layoutName = options.layoutName || useUrlSearchParams().layoutName;
              if (options.changeLayout === false) {
                //
              } else if (layoutName && options.changeLayout !== 'auto') {
                viewStore.setLayoutByName(layoutName.toString(), true);
              } else if (vol.layoutName) {
                viewStore.setLayoutByName(vol.layoutName, true);
              }
              s = options.s;
              if (s !== -1) {
                dataID = selection;
              } else {
                selection = '';
              }
            }
          } else if (typeof options.n === 'number') {
            for (const volumeKey of Object.keys(volumes)) {
              const vol = volumes[volumeKey];
              if (vol) {
                const layoutName = options.layoutName || useUrlSearchParams().layoutName;
                if (options.changeLayout === false) {
                  //
                } else if (layoutName && options.changeLayout !== 'auto') {
                  viewStore.setLayoutByName(layoutName.toString(), true);
                } else if (vol.layoutName) {
                  viewStore.setLayoutByName(vol.layoutName, true);
                }
                s = vol.slices.findIndex(({ n }) => n === options.n);
                if (s !== -1) {
                  selection = volumeKey;
                  dataID = selection;
                  break;
                } else {
                  selection = '';
                }
              }
            }
          } else if (typeof options.i === 'number') {
            for (const volumeKey of Object.keys(volumes)) {
              const vol = volumes[volumeKey];
              if (vol) {
                const layoutName = options.layoutName || useUrlSearchParams().layoutName;
                if (options.changeLayout === false) {
                  //
                } else if (layoutName && options.changeLayout !== 'auto') {
                  viewStore.setLayoutByName(layoutName.toString(), true);
                } else if (vol.layoutName) {
                  viewStore.setLayoutByName(vol.layoutName, true);
                }
                s = vol.slices.findIndex(({ i }) => i === options.i);
                if (s !== -1) {
                  selection = volumeKey;
                  dataID = selection;
                  break;
                } else {
                  selection = '';
                }
              }
            }
          }
          requestAnimationFrame(() => {
            const defaultLayoutName = dataID ? imageCacheStore.getImageDefaultLayoutName(dataID) : '';
            viewStore.getViewsForData(selection).forEach(v => {
              const viewId = v.id as string;
              const dataId = v.dataID as string;
              if (s !== -1 && defaultLayoutName) {
                if (v.name === defaultLayoutName.replace(' Only', '')) {
                  viewID = viewId;
                  dataID = dataId;
                  viewSliceStore.updateConfig(viewID, dataID, { slice: s });
                  viewStore.setActiveView(viewID);
                  if (!viewStore.isActiveViewMaximized) {
                    viewStore.toggleActiveViewMaximized();
                  }
                }
              }
              const wlConfig = useWindowingStore().getConfig(viewId, dataId);
              if ((!wlConfig?.width || !wlConfig?.level || wlConfig?.level === 2 ** 32 - 1) && wlConfig?.auto) {
                useWindowingStore().updateConfig(viewId, dataId, {
                  auto: wlConfig.auto,
                }, true);
              }
            });
          });
        }
        viewStore.setDataForAllViews(selection);
        autoLayerDicoms(primaryDataSource, succeeded);
        autoLayerByName(
          primaryDataSource,
          succeeded,
          loadDataStore.layerExtension
        );
        loadSegmentations(
          primaryDataSource,
          succeeded,
          loadDataStore.segmentGroupExtension
        );
      } // else must be primaryDataSource.type === 'model', which are not dealt with here yet
    }

    if (errored.length) {
      const errorMessages = (errored as ErrorResult[]).map((errResult) => {
        const { dataSource, error } = errResult;
        const name = getDataSourceName(dataSource);
        logError(error);
        return error.message ? `- ${name}: ${error.message}` : `- ${name}`;
      });
      const failedError = new Error(
        `These files failed to load:\n${errorMessages.join('\n')}`
      );

      loadDataStore.setError(failedError);
    } else if (loadDataStore.isLoadingByBus) {
      loadDataStore.setIsLoadingByBus(false, volumeKeySuffix);
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

function urlsToDataSources(urls: string[], names: string[] = []): DataSource[] {
  return urls.map((url, idx) => {
    const defaultName =
      basename(parseUrl(url, window.location.href).pathname) || url;
    return uriToDataSource(url, names[idx] || defaultName);
  });
}

type LoadUrlsParams = {
  urls?: string[];
  names?: string[];
  config?: string[];
};

export async function loadUrls(params: UrlParams | LoadUrlsParams, options?: LoadEventOptions) {
  if (params.config) {
    const configUrls = wrapInArray(params.config);
    const configSources = urlsToDataSources(configUrls);
    await loadDataSources(configSources);
  }

  if (params.urls) {
    let urls = wrapInArray(params.urls);
    let names = wrapInArray(params.names ?? []);
    let sources = urlsToDataSources(urls, names);

    if (options && options.volumeKeySuffix) {
      const loadDataStore = useLoadDataStore();
      const imageCacheStore = useImageCacheStore();
      const viewStore = useViewStore();
      const viewSliceStore = useViewSliceStore();
      const volumeKeySuffix = loadDataStore.setLoadedByBusOptions(options.volumeKeySuffix, options).volumeKeySuffix!;

      const beforeLoadByBus = async () => {
        const { volumeKeys, volumes } = loadDataStore.loadedByBus[volumeKeySuffix];
        if (volumeKeys?.length && volumes) {
          if (
            options.changeSlice === false ||
            options.s === undefined &&
            options.n === undefined &&
            options.i === undefined
          ) {
            if (names.some(name => name.toLowerCase().endsWith('.zip') && name !== 'archive.zip')) {
              const datasetStore = useDatasetStore();
              volumeKeys.forEach(imageID => datasetStore.remove(imageID));
              loadDataStore.setLoadedByBusOptions(options.volumeKeySuffix, options);
              return loadDataStore.setIsLoadingByBus(true);
            }
            for (const dataID of Object.keys(volumes)) {
              const vol = volumes[dataID];
              const defaultLayoutName = imageCacheStore.getImageDefaultLayoutName(dataID);
              if (defaultLayoutName) {
                const layoutName = options.layoutName || useUrlSearchParams().layoutName;
                if (options.changeLayout === false) {
                  //
                } else if (vol?.layoutName && options.changeLayout === 'auto' || layoutName) {
                  viewStore.setLayoutByName(vol.layoutName ?? layoutName.toString(), true);
                }
                viewStore.setDataForAllViews(dataID);
                return loadDataStore.setIsLoadingByBus(false, volumeKeySuffix);
              }
            }
          } else if (typeof options.s === 'number') {
            for (const dataID of Object.keys(volumes)) {
              const vol = volumes[dataID];
              const s = options.s;
              if (vol?.slices[options.s]) {
                const defaultLayoutName = imageCacheStore.getImageDefaultLayoutName(dataID);
                if (defaultLayoutName) {
                  const layoutName = options.layoutName || useUrlSearchParams().layoutName;
                  if (options.changeLayout === false) {
                    //
                  } else if (vol?.layoutName && options.changeLayout === 'auto' || layoutName) {
                    viewStore.setLayoutByName(vol.layoutName ?? layoutName.toString(), true);
                  }
                  requestAnimationFrame(() => {
                    viewStore.getViewsForData(dataID).forEach(({ id: viewID, ...v }) => {
                      if (v.name === defaultLayoutName.replace(' Only', '')) {
                        viewSliceStore.updateConfig(viewID, dataID, { slice: s });
                        viewStore.setActiveView(viewID);
                        if (!viewStore.isActiveViewMaximized) {
                          viewStore.toggleActiveViewMaximized();
                        }
                      }
                    });
                  });
                  viewStore.setDataForAllViews(dataID);
                  return loadDataStore.setIsLoadingByBus(false, volumeKeySuffix);
                }
              }
            }
          } else if (typeof options.n === 'number') {
            for (const dataID of Object.keys(volumes)) {
              const vol = volumes[dataID];
              const s = vol?.slices?.findIndex(({ n }) => n === options.n) ?? -1;
              if (s !== -1) {
                const defaultLayoutName = imageCacheStore.getImageDefaultLayoutName(dataID);
                if (defaultLayoutName) {
                  const layoutName = options.layoutName || useUrlSearchParams().layoutName;
                  if (options.changeLayout === false) {
                    //
                  } else if (vol?.layoutName && options.changeLayout === 'auto' || layoutName) {
                    viewStore.setLayoutByName(vol.layoutName ?? layoutName.toString(), true);
                  }
                  requestAnimationFrame(() => {
                    viewStore.getViewsForData(dataID).forEach(({ id: viewID, ...v }) => {
                      if (v.name === defaultLayoutName.replace(' Only', '')) {
                        viewSliceStore.updateConfig(viewID, dataID, { slice: s });
                        viewStore.setActiveView(viewID);
                        if (!viewStore.isActiveViewMaximized) {
                          viewStore.toggleActiveViewMaximized();
                        }
                      }
                    });
                  });
                  viewStore.setDataForAllViews(dataID);
                  return loadDataStore.setIsLoadingByBus(false, volumeKeySuffix);
                }
              }
            }
          } else if (typeof options.i === 'number') {
            for (const dataID of Object.keys(volumes)) {
              const vol = volumes[dataID];
              const s = vol?.slices?.findIndex(({ i }) => i === options.i) ?? -1;
              if (s !== -1) {
                const defaultLayoutName = imageCacheStore.getImageDefaultLayoutName(dataID);
                if (defaultLayoutName) {
                  const layoutName = options.layoutName || useUrlSearchParams().layoutName;
                  if (options.changeLayout === false) {
                    //
                  } else if (vol?.layoutName && options.changeLayout === 'auto' || layoutName) {
                    viewStore.setLayoutByName(vol.layoutName ?? layoutName.toString(), true);
                  }
                  requestAnimationFrame(() => {
                    viewStore.getViewsForData(dataID).forEach(({ id: viewID, ...v }) => {
                      if (v.name === defaultLayoutName.replace(' Only', '')) {
                        viewSliceStore.updateConfig(viewID, dataID, { slice: s });
                        viewStore.setActiveView(viewID);
                        if (!viewStore.isActiveViewMaximized) {
                          viewStore.toggleActiveViewMaximized();
                        }
                      }
                    });
                  });
                  viewStore.setDataForAllViews(dataID);
                  return loadDataStore.setIsLoadingByBus(false, volumeKeySuffix);
                }
              }
            }
          }
          return loadDataStore.setIsLoadingByBus(false, volumeKeySuffix);
        }
        if (options.zip && urls.length > 0) {
          if (loadDataStore.getLoadedByBusOptions(volumeKeySuffix)?.loading) {
            return false;
          }
          loadDataStore.setIsLoadingByBus(true);
          options.loading = true;
          const zip = new JSZip();
          const zipBlob = await Promise.all(urls.map((url, i, arr) => {
            return fetch(url).then((res) => res.ok ? res.blob() : null).then((blob) => {
              if (blob) {
                const file = names[i] || url?.split('/')?.pop()?.split('\\')?.pop()
                const name = file?.split('.')?.[0]
                const ext = (file?.slice(name?.length) || '.dcm').toLowerCase();
                const fileName = arr.length === 1 && file ? file : `${name || ('file-' + i)}${ext}`.replaceAll(' ', '_');
                zip.file(fileName, blob);
              }
            }).catch(console.error);
          })).then(() => {
            return zip.generateAsync({ type: 'blob' });
          }).catch(console.error);
          if (zipBlob) {
            options.zipObjectUrl = URL.createObjectURL(zipBlob);
            urls = [options.zipObjectUrl];
            names = ['archive.zip'];
            sources = urls.map((url, idx) =>
              uriToDataSource(
                url,
                names[idx] ||
                  basename(parseUrl(url, window.location.href).pathname) ||
                  url
              )
            );
          }     
        }
        if (options.prefetchFiles && urls.length > 0) {
          // console.warn('[prefetch]', urls, names);
          loadDataStore.setIsLoadingByBus(true);
          const files = await Promise.all(urls.map((url, i, arr) => fetch(url).then(res => res.blob()).then(blob => {
            const file = names[i] || url?.split('/')?.pop()?.split('\\')?.pop()
            const name = file?.split('.')?.[0]
            const ext = (file?.slice(name?.length) || '.dcm').toLowerCase();
            const fileName = arr.length === 1 && file ? file : `${name || ('file-' + i)}${ext}`.replaceAll(' ', '_');
            const mimeType = FILE_EXT_TO_MIME[ext.slice(1)];
            return new File([blob], fileName, { type: mimeType });
          })));
          const dataSources = files.map(fileToDataSource);
          loadDataSources(dataSources, volumeKeySuffix);
          return false;
        }
        return loadDataStore.setIsLoadingByBus(true);
      };

      if ('dicomWebURL' in params) {
        const dicomWebFiles: File[] = [];
        const dicomWebURL = params.dicomWebURL?.toString();
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
        return (await beforeLoadByBus()) && await loadFiles(dicomWebFiles, volumeKeySuffix);
      }

      return (await beforeLoadByBus()) && await loadDataSources(sources, volumeKeySuffix);
    }

    await loadDataSources(sources);
  }
}
