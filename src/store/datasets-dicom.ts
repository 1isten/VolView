import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { defineStore } from 'pinia';
import { Image } from 'itk-wasm';
import useLoadDataStore from '@/src/store/load-data';
import { useViewStore } from '@/src/store/views';
import { DataSourceWithFile } from '@/src/io/import/dataSource';
import { arrayRange } from '../utils/minmax';
import { pick, removeFromArray } from '../utils';
import { useImageStore } from './datasets-images';
import { useFileStore } from './datasets-files';
import { StateFile, DatasetType } from '../io/state-file/schema';
import { serializeData } from '../io/state-file/utils';
import { DICOMIO, volumeKeyGetSuffix } from '../io/dicom';

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
  PatientName: string;
  PatientID: string;
  PatientBirthDate: string;
  PatientSex: string;
  PatientAge: string;
  PatientWeight: string;
  PatientAddress: string;
}

export interface StudyInfo {
  StudyInstanceUID: string;
  StudyID: string;
  StudyName: string;
  StudyDate: string;
  StudyTime: string;
  StudyDescription: string;
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
  SeriesDate: string;
  SeriesTime: string;
  SeriesDescription: string;
  Modality: string;
  BodyPartExamined: string;
  RepetitionTime?: string;
  EchoTime?: string;
  MagneticFieldStrength?: string;
  TransferSyntaxUID?: string;

  SliceThickness?: string;
  SliceLocation?: string;
  PixelSpacing?: string;

  NumberOfSlices: number;
  VolumeID: string;
}

interface State {
  // volumeKey -> imageCacheMultiKey -> ITKImage
  sliceData: Record<string, Record<string, Image>>;

  // volume invalidation information
  needsRebuild: Record<string, boolean>;

  // Avoid recomputing image data for the same volume by checking this for existing buildVolume tasks
  volumeImageData: Record<string, Promise<vtkImageData>>;

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

  // volumeKey -> volume slices info
  volumeSlicesInfo: Record<string, any>;

  // parent pointers
  // volumeKey -> studyKey
  volumeStudy: Record<string, string>;
  // studyKey -> patientKey
  studyPatient: Record<string, string>;
}

const instanceTags = [
  { name: 'SOPInstanceUID', tag: '0008|0018' },
  { name: 'InstanceNumber', tag: '0020|0013' },
  { name: 'SliceThickness', tag: '0018|0050' },
  { name: 'SliceLocation', tag: '0020|1041' },
  // { name: 'ImagePositionPatient', tag: '0020|0032' },
  // { name: 'ImageOrientationPatient', tag: '0020|0037' },
  // { name: 'Rows', tag: '0028|0010' },
  // { name: 'Columns', tag: '0028|0011' },
  // { name: 'PixelSpacing', tag: '0028|0030' },
  { name: 'WindowLevel', tag: '0028|1050' }, // WindowCenter
  { name: 'WindowWidth', tag: '0028|1051' },
];

const mainDicomTags = [
  // Patient
  { name: 'PatientName', tag: '0010|0010', strconv: true },
  { name: 'PatientID', tag: '0010|0020', strconv: true },
  { name: 'PatientBirthDate', tag: '0010|0030' },
  { name: 'PatientSex', tag: '0010|0040' },
  { name: 'PatientAge', tag: '0010|1010' },
  { name: 'PatientWeight', tag: '0010|1030' },
  { name: 'PatientAddress', tag: '0010|1040' },
  // Study
  { name: 'StudyInstanceUID', tag: '0020|000d' },
  { name: 'StudyID', tag: '0020|0010', strconv: true },
  { name: 'StudyName', tag: '0010|0010' }, // PatientName
  { name: 'StudyDate', tag: '0008|0020' },
  { name: 'StudyTime', tag: '0008|0030' },
  { name: 'StudyDescription', tag: '0008|1030', strconv: true },
  { name: 'AccessionNumber', tag: '0008|0050' },
  { name: 'InstitutionName', tag: '0008|0080' },
  { name: 'ReferringPhysicianName', tag: '0008|0090' },
  { name: 'ManufacturerModelName', tag: '0008|1090' },
  // Series
  { name: 'SeriesInstanceUID', tag: '0020|000e' },
  { name: 'SeriesNumber', tag: '0020|0011' },
  { name: 'SeriesDate', tag: '0008|0021' },
  { name: 'SeriesTime', tag: '0008|0031' },
  { name: 'SeriesDescription', tag: '0008|103e', strconv: true },
  { name: 'Modality', tag: '0008|0060' },
  { name: 'BodyPartExamined', tag: '0018|0015' },
  { name: 'RepetitionTime', tag: '0018|0080' },
  { name: 'EchoTime', tag: '0018|0081' },
  { name: 'MagneticFieldStrength', tag: '0018|0087' },
  // { name: 'TransferSyntaxUID', tag: '0002|0010' },
  // Instance
  ...instanceTags,
];

export const readDicomTags = (dicomIO: DICOMIO, file: File, tags = mainDicomTags) => dicomIO.readTags(file, tags);

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
  if (WindowWidth === '') return []; // missing tag
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

export const constructImage = async (dicomIO: DICOMIO, volumeKey: string, singleSortedSeries: boolean = false) => {
  const fileStore = useFileStore();
  const files = fileStore.getFiles(volumeKey);
  if (!files) throw new Error('No files for volume key');
  const image = vtkITKHelper.convertItkToVtkImage(
    await dicomIO.buildImage(files, singleSortedSeries)
  );
  return image;
};

export const useDICOMStore = defineStore('dicom', {
  state: (): State => ({
    sliceData: {},
    volumeImageData: {},
    patientInfo: {},
    patientStudies: {},
    studyInfo: {},
    studyVolumes: {},
    volumeInfo: {},
    volumeSlicesInfo: {},
    volumeStudy: {},
    studyPatient: {},
    needsRebuild: {},
  }),
  actions: {
    volumeKeyGetSuffix,
    readDicomTags,

    async importFiles(datasets: DataSourceWithFile[], volumeKeySuffix?: string) {
      if (!datasets.length) return [];

      const dicomIO = this.$dicomIO;

      const fileToDataSource = new Map(
        datasets.map((ds) => [ds.fileSrc.file, ds])
      );
      const allFiles = [...fileToDataSource.keys()];

      const volumeToFiles = await dicomIO.categorizeFiles(allFiles, volumeKeySuffix);
      if (Object.keys(volumeToFiles).length === 0) {
        throw new Error('No volumes categorized from DICOM file(s)');
      } else { // save some data into volumeSlicesInfo
        const volumeKeys = Object.keys(volumeToFiles);
        for (let i = 0; i < volumeKeys.length; i++) {
          const volumeKey = volumeKeys[i];
          // eslint-disable-next-line no-await-in-loop
          const filesWithTagsInfo = await Promise.all(
            volumeToFiles[volumeKey].map(async file => {
              const tags = await this.readDicomTags(dicomIO, file, [
                ...instanceTags,
              ]);
              const windowLevels = getWindowLevels({
                WindowLevel: tags.WindowLevel,
                WindowWidth: tags.WindowWidth,
              });
              return {
                file,
                tags: {
                  ...tags,
                  InstanceNumber: `${parseInt(tags.InstanceNumber || '0', 10)}`,
                  WindowLevel: `${windowLevels[0]?.level || tags.WindowLevel}`,
                  WindowWidth: `${windowLevels[0]?.width || tags.WindowWidth}`,
                },
              };
            })
          );
          filesWithTagsInfo.sort((a, b) => +a.tags.InstanceNumber - +b.tags.InstanceNumber);
          let reSorted = false;
          let windowingDiffs= false;
          const windowLevels: number[] = [];
          const windowWidths: number[] = [];
          const tags: Record<string, string>[] = [];
          volumeToFiles[volumeKey].forEach((file, idx) => {
            const { file: fileSorted, tags: fileTags } = filesWithTagsInfo[idx];
            if (file !== fileSorted) {
              volumeToFiles[volumeKey][idx] = fileSorted;
              reSorted = true;
            }
            tags[idx] = fileTags;
            windowLevels.push(Number(fileTags.WindowLevel));
            windowWidths.push(Number(fileTags.WindowWidth));
          });
          if (
            Math.max(...windowLevels) !== Math.min(...windowLevels) ||
            Math.max(...windowWidths) !== Math.min(...windowWidths)
          ) {
            windowingDiffs = true;
          }
          this.volumeSlicesInfo[volumeKey] = {
            reSorted,
            tags,
            windowingDiffs,
            dataRanges: [],
          };
        }
      }

      const fileStore = useFileStore();

      // Link VolumeKey and DatasetFiles in fileStore
      Object.entries(volumeToFiles).forEach(([volumeKey, files]) => {
        const volumeDatasetFiles = files.map((file) => {
          const source = fileToDataSource.get(file);
          if (!source)
            throw new Error('Did not match File with source DataSource');
          return source;
        });
        fileStore.add(volumeKey, volumeDatasetFiles);
      });

      await Promise.all(
        Object.entries(volumeToFiles).map(async ([volumeKey, files]) => {
          // Read tags of first file
          if (!(volumeKey in this.volumeInfo)) {
            const tags = await readDicomTags(dicomIO, files[0]);
            // TODO parse the raw string values
            const patient = {
              PatientName: tags.PatientName || ANONYMOUS_PATIENT,
              PatientID: tags.PatientID || ANONYMOUS_PATIENT_ID,
              PatientBirthDate: tags.PatientBirthDate || '',
              PatientSex: tags.PatientSex || '',
              PatientAge: tags.PatientAge || '',
              PatientWeight: tags.PatientWeight || '',
              PatientAddress: tags.PatientAddress || '',
            };

            const study = pick(
              tags,
              'StudyInstanceUID',
              'StudyID',
              'StudyName',
              'StudyDate',
              'StudyTime',
              'StudyDescription',
              'AccessionNumber',
              'InstitutionName',
              'ReferringPhysicianName',
              'ManufacturerModelName'
            );

            const volumeInfo = {
              ...pick(
                tags,
                'SeriesInstanceUID',
                'SeriesNumber',
                'SeriesDate',
                'SeriesTime',
                'SeriesDescription',
                'Modality',
                'BodyPartExamined',
                'RepetitionTime',
                'EchoTime',
                'MagneticFieldStrength',
                // 'TransferSyntaxUID',
                // ...
                'SliceThickness',
                'SliceLocation',
                // ...
                'PixelSpacing',
                // ...
                'WindowLevel',
                'WindowWidth'
              ),
              NumberOfSlices: files.length,
              VolumeID: volumeKey,
            };

            this._updateDatabase(patient, study, volumeInfo);
          }

          // invalidate any existing volume
          if (volumeKey in useImageStore().dataIndex) {
            // buildVolume requestor uses this as a rebuild hint
            this.needsRebuild[volumeKey] = true;
          }

          // save pixel data min max into volumeSlicesInfo
          if (this.volumeSlicesInfo[volumeKey]?.windowingDiffs) {
            files.forEach(async (file, idx) => {
              const image = await this.getVolumeSlice(volumeKey, idx + 1);
              if (image.data) {
                const [min, max] = arrayRange(image.data);
                if (!('dataRanges' in this.volumeSlicesInfo[volumeKey])) {
                  this.volumeSlicesInfo[volumeKey].dataRanges = [];
                }
                this.volumeSlicesInfo[volumeKey].dataRanges[idx] = { min, max };
              }
            });
          }
        })
      );

      return Object.keys(volumeToFiles);
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
        delete this.volumeSlicesInfo[volumeKey];
        delete this.sliceData[volumeKey];
        delete this.volumeStudy[volumeKey];

        if (volumeKey in this.volumeImageData) {
          delete this.volumeImageData[volumeKey];
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

    async serialize(stateFile: StateFile) {
      const dataIDs = Object.keys(this.volumeInfo);
      await serializeData(stateFile, dataIDs, DatasetType.DICOM);
    },

    async deserialize(files: DataSourceWithFile[], volumeKeySuffix?: string) {
      return this.importFiles(files, volumeKeySuffix).then((volumeKeys) => {
        if (volumeKeys.length !== 1) {
          // Volumes are store individually so we should get one back.
          throw new Error('Invalid state file.');
        }

        return volumeKeys[0];
      });
    },

    // returns an ITK image object
    async getVolumeSlice(
      volumeKey: string,
      sliceIndex: number,
      asThumbnail = false
    ) {
      const dicomIO = this.$dicomIO;
      const fileStore = useFileStore();

      const cacheKey = imageCacheMultiKey(sliceIndex, asThumbnail);
      if (
        volumeKey in this.sliceData &&
        cacheKey in this.sliceData[volumeKey]
      ) {
        return this.sliceData[volumeKey][cacheKey];
      }

      if (!(volumeKey in this.volumeInfo)) {
        throw new Error(`Cannot find given volume key: ${volumeKey}`);
      }
      const volumeInfo = this.volumeInfo[volumeKey];
      const numSlices = volumeInfo.NumberOfSlices;

      if (sliceIndex < 1 || sliceIndex > numSlices) {
        throw new Error(`Slice ${sliceIndex} is out of bounds`);
      }

      const volumeFiles = fileStore.getFiles(volumeKey);

      if (!volumeFiles) {
        throw new Error(`No files found for volume key: ${volumeKey}`);
      }

      const sliceFile = volumeFiles[sliceIndex - 1];

      const itkImage = await dicomIO.getVolumeSlice(sliceFile, asThumbnail);

      this.sliceData[volumeKey][cacheKey] = itkImage;
      return itkImage;
    },

    // returns an ITK image object
    async getVolumeThumbnail(volumeKey: string) {
      const { NumberOfSlices } = this.volumeInfo[volumeKey];
      const middleSlice = Math.ceil(NumberOfSlices / 2);
      return this.getVolumeSlice(volumeKey, middleSlice, true);
    },

    async buildVolume(volumeKey: string, forceRebuild: boolean = false) {
      const imageStore = useImageStore();

      const alreadyBuilt = volumeKey in this.volumeImageData;
      const buildNeeded =
        forceRebuild || this.needsRebuild[volumeKey] || !alreadyBuilt;
      delete this.needsRebuild[volumeKey];

      // wait for old buildVolume call so we can run imageStore update side effects after
      const oldImagePromise = alreadyBuilt
        ? [this.volumeImageData[volumeKey]]
        : [];
      // actually build volume or wait for existing build?
      const newImagePromise = buildNeeded
        ? constructImage(this.$dicomIO, volumeKey, !!this.volumeSlicesInfo[volumeKey]?.reSorted)
        : this.volumeImageData[volumeKey];
      // let other calls to buildVolume reuse this constructImage work
      this.volumeImageData[volumeKey] = newImagePromise;
      const [image] = await Promise.all([newImagePromise, ...oldImagePromise]);

      // update image store
      const imageExists = imageStore.dataIndex[volumeKey];
      if (imageExists) {
        // was a rebuild
        imageStore.updateData(volumeKey, image);
      } else {
        const info = this.volumeInfo[volumeKey];
        const name = getDisplayName(info);
        imageStore.addVTKImageData(name, image, volumeKey);
        // auto set layout to be the correct axis view (when loaded by bus)
        const loadDataStore = useLoadDataStore();
        const viewStore = useViewStore();
        const viewID = imageStore.getPrimaryViewID(volumeKey);
        const volumeKeySuffix = volumeKeyGetSuffix(volumeKey);
        if (volumeKeySuffix) {
          if (viewID) {
            const { layoutName, defaultSlices, slice } = loadDataStore.getLoadedByBus(volumeKeySuffix);
            if (layoutName === undefined) {
              loadDataStore.setLoadedByBus(volumeKeySuffix, {
                layoutName: viewStore.getLayoutByViewID(viewID),
              });
            }
            if (slice !== undefined && (defaultSlices === undefined || defaultSlices[viewID] === undefined)) {
              loadDataStore.setLoadedByBus(volumeKeySuffix, {
                defaultSlices: {
                  ...(defaultSlices || {}),
                  [viewID]: slice,
                },
              });
            }
          }
        } else if (viewID) {
          // viewStore.setLayoutByViewID(viewID);
        }
      }

      return image;
    },
  },
});
