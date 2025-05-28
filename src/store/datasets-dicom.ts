import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import { defineStore } from 'pinia';
import { Image } from 'itk-wasm';
import * as DICOM from '@/src/io/dicom';
import { Chunk } from '@/src/core/streaming/chunk';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { Tags } from '@/src/core/dicomTags';
import { removeFromArray } from '../utils';
import { useFileStore } from './datasets-files';
import { useLoadDataStore } from './load-data';
import { useViewStore } from './views';

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

const buildImage = async (seriesFiles: File[], modality: string) => {
  const messages: string[] = [];
  if (modality === 'SEG') {
    const segFile = seriesFiles[0];
    const results = await DICOM.buildSegmentGroups(segFile);
    if (seriesFiles.length > 1)
      messages.push(
        'Tried to make one volume from 2 SEG modality files. Using only the first file!'
      );
    return {
      modality: 'SEG',
      builtImageResults: results,
      messages,
    };
  }
  return {
    builtImageResults: await DICOM.buildImage(seriesFiles),
    messages,
  };
};

const constructImage = async (volumeKey: string, volumeInfo: VolumeInfo) => {
  const fileStore = useFileStore();
  const files = fileStore.getFiles(volumeKey);
  if (!files) throw new Error('No files for volume key');
  const results = await buildImage(files, volumeInfo.Modality);
  const image = vtkITKHelper.convertItkToVtkImage(
    results.builtImageResults.outputImage
  );
  return {
    ...results,
    image,
  };
};

interface State {
  // volumeKey -> imageCacheMultiKey -> ITKImage
  sliceData: Record<string, Record<string, Image>>;

  // volume invalidation information
  needsRebuild: Record<string, boolean>;

  // Avoid recomputing image data for the same volume by checking this for existing buildVolume tasks
  volumeBuildResults: Record<string, ReturnType<typeof constructImage>>;

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
    cleanupName(info.SeriesDescription || info.SeriesNumber) ||
    info.SeriesInstanceUID
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
    volumeBuildResults: {},
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
      const imageCacheStore = useImageCacheStore();

      // split into groups
      const chunksByVolume = await DICOM.splitAndSort(
        chunks,
        (chunk) => chunk.metaBlob!,
        volumeKeySuffix
      );

      if (volumeKeySuffix) {
        const loadDataStore = useLoadDataStore();
        Object.entries(chunksByVolume).forEach(([volumeKey, sortedChunks]) => {
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
              const InstanceNumber: string = chunk.metadata?.find(meta => meta[0] === '0020|0013')?.[1] || '';
              const WindowLevel: string = chunk.metadata?.find(meta => meta[0] === '0028|1050')?.[1] || '';
              const WindowWidth: string = chunk.metadata?.find(meta => meta[0] === '0028|1051')?.[1] || '';
              // can get more tags here if needed...
              filesInOrder.push({ chunk, n: parseInt(InstanceNumber || '0', 10) });
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
            }
            loadDataStore.loadedByBus[volumeKeySuffix].volumes[volumeKey].wlDiffers = Math.max(...windowLevels) !== Math.min(...windowLevels) || Math.max(...windowWidths) !== Math.min(...windowWidths);
            loadDataStore.loadedByBus[volumeKeySuffix].volumes[volumeKey].wlConfiged = {};
            loadDataStore.loadedByBus[volumeKeySuffix].volumes[volumeKey].wlConfigedByUser = false;
          }
          loadDataStore.dataIDToVolumeKeyUID[volumeKey] = volumeKeySuffix;
        });
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

      await Promise.all(
        Object.entries(chunksByVolume).map(async ([id, sortedChunks]) => {
          const image = imageCacheStore.imageById[id] ?? new DicomChunkImage();
          if (!(image instanceof DicomChunkImage)) {
            throw new Error('image is not a DicomChunkImage');
          }

          await image.addChunks(sortedChunks);
          imageCacheStore.addProgressiveImage(image, { id });

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

          if (image.imageMetadata.value.lpsOrientation) {
            if (volumeKeySuffix) {
              const loadDataStore = useLoadDataStore();
              const viewStore = useViewStore();
              const volumeKey = id;
              const vol = loadDataStore.loadedByBus[volumeKeySuffix].volumes[volumeKey];
              const viewID = viewStore.getPrimaryViewID(volumeKey);
              if (viewID && !vol.layoutName) {
                const layoutName = viewStore.getLayoutByViewID(viewID);
                if (layoutName) {
                  vol.layoutName = layoutName;
                }
              }
            }
          }
        })
      );

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

        if (volumeKey in this.volumeBuildResults) {
          delete this.volumeBuildResults[volumeKey];
        }

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
