import { defineStore } from 'pinia';
import { Image } from 'itk-wasm';
import * as DICOM from '@/src/io/dicom';
import { Chunk } from '@/src/core/streaming/chunk';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { Tags } from '@/src/core/dicomTags';
import { removeFromArray } from '../utils';
import { useLoadDataStore } from './load-data';

import deepEqual from 'fast-deep-equal';

export const ANONYMOUS_PATIENT = 'Anonymous';
export const ANONYMOUS_PATIENT_ID = 'ANONYMOUS';

export function imageCacheMultiKey(offset: number, asThumbnail: boolean) {
  return `${offset}!!${asThumbnail}`;
}

export interface VolumeKeys {
  patientKey: string;
  studyKey: string;
  volumeKey: string;
}

export interface PatientInfo {
  PatientID: string;
  PatientName: string;
  PatientBirthDate: string;
  PatientSex: string;
  PatientAge?: string;
  PatientWeight?: string;
  PatientAddress?: string;
}

export interface StudyInfo {
  StudyID: string;
  StudyInstanceUID: string;
  StudyDescription: string;
  StudyName?: string;
  StudyDate: string;
  StudyTime: string;
  AccessionNumber: string;
  InstitutionName?: string;
  ReferringPhysicianName?: string;
  ManufacturerModelName?: string;
}

export interface WindowingInfo {
  WindowLevel: string;
  WindowWidth: string;
}

export interface VolumeInfo extends WindowingInfo {
  SeriesInstanceUID: string;
  SeriesNumber: string;
  SeriesDescription: string;
  SeriesDate?: string;
  SeriesTime?: string;
  Modality: string;
  BodyPartExamined?: string;
  RepetitionTime?: string;
  EchoTime?: string;
  MagneticFieldStrength?: string;
  TransferSyntaxUID?: string;

  PixelSpacing?: string;
  Rows?: number | string;
  Columns?: number | string;
  SliceThickness?: string;
  SliceLocation?: string;
  ImagePositionPatient?: string;
  ImageOrientationPatient?: string;

  NumberOfSlices: number;
  VolumeID: string;
}

interface State {
  // volumeKey -> imageCacheMultiKey -> ITKImage
  sliceData: Record<string, Record<string, Image>>;

  // volume invalidation information
  needsRebuild: Record<string, boolean>;

  // patientKey -> patient info
  patientInfo: Record<string, PatientInfo>;
  // patientKey -> array of studyKeys
  patientStudies: Record<string, string[]>;

  // studyKey -> study info
  studyInfo: Record<string, StudyInfo>;
  // studyKey -> array of volumeKeys
  studyVolumes: Record<string, string[]>;

  // volumeKey -> volume info
  volumeInfo: Record<string, VolumeInfo>;

  // parent pointers
  // volumeKey -> studyKey
  volumeStudy: Record<string, string>;
  // studyKey -> patientKey
  studyPatient: Record<string, string>;
}

/**
 * Trims and collapses multiple spaces into one.
 * @param name
 * @returns string
 */
const cleanupName = (name: string) => {
  return name.trim().replace(/\s+/g, ' ');
};

export const getDisplayName = (info: VolumeInfo) => {
  return (
    cleanupName(info.SeriesDescription || info.SeriesNumber || '') ||
    info.SeriesInstanceUID ||
    'NONAME'
  );
};

export const getWindowLevels = (info: VolumeInfo | WindowingInfo) => {
  const { WindowWidth, WindowLevel } = info;
  if (
    WindowWidth == null ||
    WindowLevel == null ||
    WindowWidth === '' ||
    WindowLevel === ''
  )
    return []; // missing tag
  const widths = WindowWidth.split('\\').map(parseFloat);
  const levels = WindowLevel.split('\\').map(parseFloat);
  if (
    widths.some((w) => Number.isNaN(w)) ||
    levels.some((l) => Number.isNaN(l))
  ) {
    console.error('Invalid WindowWidth or WindowLevel DICOM tags');
    return [];
  }
  if (widths.length !== levels.length) {
    console.error(
      'Different numbers of WindowWidth and WindowLevel DICOM tags'
    );
    return [];
  }
  return widths.map((width, i) => ({ width, level: levels[i] }));
};

export const useDICOMStore = defineStore('dicom', {
  state: (): State => ({
    sliceData: {},
    patientInfo: {},
    patientStudies: {},
    studyInfo: {},
    studyVolumes: {},
    volumeInfo: {},
    volumeStudy: {},
    studyPatient: {},
    needsRebuild: {},
  }),
  actions: {
    volumeKeyGetSuffix: DICOM.volumeKeyGetSuffix,
    // readDicomTags,

    async importChunks(chunks: Chunk[], volumeKeySuffix?: string) {
      const loadDataStore = useLoadDataStore();
      const imageCacheStore = useImageCacheStore();

      // split into groups
      const chunksByVolume = await DICOM.splitAndSort(
        chunks,
        (chunk) => chunk.metaBlob!,
        volumeKeySuffix
      );

      await Promise.all(
        Object.entries(chunksByVolume).map(async ([id, sortedChunks]) => {
          const image = imageCacheStore.imageById[id] ?? new DicomChunkImage();
          if (!(image instanceof DicomChunkImage)) {
            throw new Error('image is not a DicomChunkImage');
          }

          // Sten Noted:
          // inside the addChunks function call, DICOM.splitAndSort is called again
          // and may mutate the sortedChunks order one more time, only after that the chunks are truly sorted
          await image.addChunks(sortedChunks, id);
          imageCacheStore.addProgressiveImage(image, { id });

          if (volumeKeySuffix) {
            const volumeKey = id;
            if (!loadDataStore.loadedByBus[volumeKeySuffix].volumes[volumeKey]) {
              loadDataStore.loadedByBus[volumeKeySuffix].volumes[volumeKey] = {
                layoutName: '',
                slices: [],
              };
            }
            if (sortedChunks[0]?.metadata) {
              const filesInOrder = [];
              const windowLevels = [];
              const windowWidths = [];
              for (let s = 0; s < sortedChunks.length; s++) {
                const chunk = sortedChunks[s];
                const SopInstanceUID: string = chunk.metadata?.find(meta => meta[0] === '0008|0018')?.[1] || '';
                const InstanceNumber: string = chunk.metadata?.find(meta => meta[0] === '0020|0013')?.[1] || '';
                const WindowLevel: string = chunk.metadata?.find(meta => meta[0] === '0028|1050')?.[1] || '';
                const WindowWidth: string = chunk.metadata?.find(meta => meta[0] === '0028|1051')?.[1] || '';
                // can get more tags here if needed...
                filesInOrder.push({ chunk, n: parseInt(InstanceNumber || '0', 10), uid: SopInstanceUID });
                const [wl] = getWindowLevels({ WindowLevel, WindowWidth });
                if (wl) {
                  windowLevels.push(wl.level);
                  windowWidths.push(wl.width);
                }
              }
              filesInOrder.sort((a, b) => a.n - b.n);
              for (let s = 0; s < sortedChunks.length; s++) {
                const i = filesInOrder.findIndex(({ chunk }) => chunk === sortedChunks[s]);
                const n = filesInOrder[i].n;
                const width = windowWidths[i];
                const level = windowLevels[i];
                loadDataStore.loadedByBus[volumeKeySuffix].volumes[volumeKey].slices.push({
                  width,
                  level,
                  n,
                  i,
                });
                const cachedFiles = loadDataStore.loadedByBus[volumeKeySuffix].cachedFiles;
                if (cachedFiles) {
                  if ((filesInOrder[i].chunk?.dataBlob instanceof File)) {
                    const fileName = filesInOrder[i].chunk.dataBlob.name;
                    const filePath = cachedFiles.fileNameToPath[fileName];
                    if (filePath && cachedFiles.fileByPath[filePath].tags?.SopInstanceUID === filesInOrder[i].uid) {
                      cachedFiles.fileByPath[filePath].slice = s;
                      cachedFiles.fileByPath[filePath].dataID = id;
                    }
                    if (fileName === cachedFiles.primarySelection) {
                      loadDataStore.loadedByBus[volumeKeySuffix].options.s = s;
                    }
                  }
                }
              }
              loadDataStore.loadedByBus[volumeKeySuffix].volumes[volumeKey].wlDiffers = Math.max(...windowLevels) !== Math.min(...windowLevels) || Math.max(...windowWidths) !== Math.min(...windowWidths);
              loadDataStore.loadedByBus[volumeKeySuffix].volumes[volumeKey].wlConfiged = {};
              loadDataStore.loadedByBus[volumeKeySuffix].volumes[volumeKey].wlConfigedByUser = false;
            }
            loadDataStore.dataIDToVolumeKeyUID[volumeKey] = volumeKeySuffix;
          }

          // update database
          const metaPairs = image.getDicomMetadata();
          if (!metaPairs) throw new Error('Metdata not ready');
          const metadata = Object.fromEntries(metaPairs);

          const patientInfo: PatientInfo = {
            PatientID: metadata[Tags.PatientID],
            PatientName: metadata[Tags.PatientName],
            PatientBirthDate: metadata[Tags.PatientBirthDate],
            PatientSex: metadata[Tags.PatientSex],
          };

          const studyInfo: StudyInfo = {
            StudyID: metadata[Tags.StudyID],
            StudyInstanceUID: metadata[Tags.StudyInstanceUID],
            StudyDate: metadata[Tags.StudyDate],
            StudyTime: metadata[Tags.StudyTime],
            AccessionNumber: metadata[Tags.AccessionNumber],
            StudyDescription: metadata[Tags.StudyDescription],
          };

          const volumeInfo: VolumeInfo = {
            NumberOfSlices: image.getChunks().length,
            VolumeID: id,
            Modality: metadata[Tags.Modality],
            SeriesInstanceUID: metadata[Tags.SeriesInstanceUID],
            SeriesNumber: metadata[Tags.SeriesNumber],
            SeriesDescription: metadata[Tags.SeriesDescription],
            WindowLevel: metadata[Tags.WindowLevel],
            WindowWidth: metadata[Tags.WindowWidth],
          };

          this._updateDatabase(patientInfo, studyInfo, volumeInfo);

          // save the image name
          image.setName(getDisplayName(volumeInfo));

          if (volumeKeySuffix) {
            if (image.imageMetadata.value.lpsOrientation) {
              const volumeKey = id;
              const vol = loadDataStore.loadedByBus[volumeKeySuffix].volumes[volumeKey];
              const defaultLayoutName = imageCacheStore.getImageDefaultLayoutName(volumeKey);
              if (defaultLayoutName) {
                if (!vol.layoutName) {
                  const layoutName = loadDataStore.loadedByBus[volumeKeySuffix].options.layoutName || defaultLayoutName;
                  if (layoutName) {
                    vol.layoutName = layoutName;
                  }
                }
                const viewOrientation = image.imageMetadata.value.orientation.slice(6);
                switch (defaultLayoutName) {
                  case 'Axial Only': {
                    if (deepEqual(viewOrientation, image.imageMetadata.value.lpsOrientation.Superior)) {
                      vol.camera = { Axial: { viewDirection: 'Superior', viewUp: 'Anterior' } };
                    }
                    break;
                  }
                  case 'Sagittal Only': {
                    if (deepEqual(viewOrientation, image.imageMetadata.value.lpsOrientation.Left)) {
                      vol.camera = { Sagittal: { viewDirection: 'Left', viewUp: 'Inferior' } };
                    }
                    break;
                  }
                  case 'Coronal Only': {
                    if (deepEqual(viewOrientation, image.imageMetadata.value.lpsOrientation.Anterior)) {
                      vol.camera = { Coronal: { viewDirection: 'Anterior', viewUp: 'Inferior' } };
                    }
                    break;
                  }
                  default: {
                    break;
                  }
                }
              }
            }
          }
        })
      );

      if (volumeKeySuffix) {
        let offset = 0;
        Object.entries(loadDataStore.loadedByBus[volumeKeySuffix].volumes).map(([volumeKey, { slices }]) => ({ volumeKey, n0: slices[0]?.n })).sort((a, b) => a.n0 - b.n0).forEach(({ volumeKey }) => {
          const volumeKeys = loadDataStore.loadedByBus[volumeKeySuffix].volumeKeys;
          volumeKeys.push(volumeKey);
          const { slices } = loadDataStore.loadedByBus[volumeKeySuffix].volumes[volumeKey];
          slices.forEach((slice, s) => {
            slices[s].i += offset;
          });
          offset += slices.length;
        });
      }

      return chunksByVolume;
    },

    _updateDatabase(
      patient: PatientInfo,
      study: StudyInfo,
      volume: VolumeInfo
    ) {
      const patientKey = patient.PatientID;
      const studyKey = study.StudyInstanceUID;
      const volumeKey = volume.VolumeID;

      if (!(patientKey in this.patientInfo)) {
        this.patientInfo[patientKey] = patient;
        this.patientStudies[patientKey] = [];
      }

      if (!(studyKey in this.studyInfo)) {
        this.studyInfo[studyKey] = study;
        this.studyVolumes[studyKey] = [];
        this.studyPatient[studyKey] = patientKey;
        this.patientStudies[patientKey].push(studyKey);
      }

      if (!(volumeKey in this.volumeInfo)) {
        this.volumeInfo[volumeKey] = volume;
        this.volumeStudy[volumeKey] = studyKey;
        this.sliceData[volumeKey] = {};
        this.studyVolumes[studyKey].push(volumeKey);
      }
    },

    // You should probably call datasetStore.remove instead as this does not
    // remove files/images/layers associated with the volume
    deleteVolume(volumeKey: string) {
      if (volumeKey in this.volumeInfo) {
        const studyKey = this.volumeStudy[volumeKey];
        delete this.volumeInfo[volumeKey];
        delete this.sliceData[volumeKey];
        delete this.volumeStudy[volumeKey];

        removeFromArray(this.studyVolumes[studyKey], volumeKey);
        if (this.studyVolumes[studyKey].length === 0) {
          this._deleteStudy(studyKey);
        }
      }
    },

    _deleteStudy(studyKey: string) {
      if (studyKey in this.studyInfo) {
        const patientKey = this.studyPatient[studyKey];
        delete this.studyInfo[studyKey];
        delete this.studyPatient[studyKey];

        [...this.studyVolumes[studyKey]].forEach((volumeKey) =>
          this.deleteVolume(volumeKey)
        );
        delete this.studyVolumes[studyKey];

        removeFromArray(this.patientStudies[patientKey], studyKey);
        if (this.patientStudies[patientKey].length === 0) {
          this._deletePatient(patientKey);
        }
      }
    },

    _deletePatient(patientKey: string) {
      if (patientKey in this.patientInfo) {
        delete this.patientInfo[patientKey];

        [...this.patientStudies[patientKey]].forEach((studyKey) =>
          this._deleteStudy(studyKey)
        );
        delete this.patientStudies[patientKey];
      }
    },
  },
});
