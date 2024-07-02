<script setup lang="ts">
import { inject, toRefs, computed } from 'vue';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { useOrientationLabels } from '@/src/composables/useOrientationLabels';
// import DicomQuickInfoButton from '@/src/components/DicomQuickInfoButton.vue';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { isDicomImage } from '@/src/utils/dataSelection';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
}

const props = defineProps<Props>();
const { viewId, imageId } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const dicomStore = useDICOMStore();
const dicomInfo = computed(() => {
  const volumeKey = imageId.value;
  if (volumeKey && isDicomImage(volumeKey)) {
    const volumeInfo = dicomStore.volumeInfo[volumeKey];
    const studyKey = dicomStore.volumeStudy[volumeKey];
    const studyInfo = dicomStore.studyInfo[studyKey];
    const patientKey = dicomStore.studyPatient[studyKey];
    const patientInfo = dicomStore.patientInfo[patientKey];

    const patientName = patientInfo.PatientName;                    // 0010|0010
    const patientID = patientInfo.PatientID;                        // 0010|0020
    const patientBirthDate = patientInfo.PatientBirthDate;          // 0010|0030
    const patientSex = patientInfo.PatientSex;                      // 0010|0040
    const studyDescription = studyInfo.StudyDescription;            // 0008|1030
    const seriesDescription = volumeInfo.SeriesDescription;         // 0008|103E

    const institutionName = studyInfo.InstitutionName;              // 0008|0080
    const manufacturerModelName = studyInfo.ManufacturerModelName;  // 0008|1090
    const studyDate = studyInfo.StudyDate;                          // 0008|0020

    const sliceThickness = volumeInfo.SliceThickness;               // 0018|0050
    const sliceLocation = volumeInfo.SliceLocation;                 // 0020|1041
    const repetitionTime = volumeInfo.RepetitionTime;               // 0018|0080
    const echoTime = volumeInfo.EchoTime;                           // 0018|0081
    const magneticFieldStrength = volumeInfo.MagneticFieldStrength; // 0018|0087
    const modality = volumeInfo.Modality;                           // 0008|0060
    const bodyPartExamined = volumeInfo.BodyPartExamined;           // 0018|0015
    const seriesNumber = volumeInfo.SeriesNumber;                   // 0020|0011

    return {
      // top-left
      patientName: patientName === patientID ? '' : patientName,
      patientID,
      patientBirthDate,
      patientSex,
      studyDescription,
      seriesDescription,

      // top-right
      institutionName,
      manufacturerModelName,
      studyDate,

      // bottom-left
      sliceThickness,
      sliceLocation,
      repetitionTime,
      echoTime,
      magneticFieldStrength,
      modality,
      bodyPartExamined,
      seriesNumber,
    };
  }

  return null;
});

const { top: topLabel, left: leftLabel } = useOrientationLabels(view);

const {
  config: sliceConfig,
  slice,
  range: sliceRange,
} = useSliceConfig(viewId, imageId);
const {
  config: wlConfig,
  width: windowWidth,
  level: windowLevel,
} = useWindowingConfig(viewId, imageId);
</script>

<template>
  <view-overlay-grid class="overlay-no-events view-annotations">
    <template v-slot:top-left>
      <div class="annotation-cell">
        <div v-if="dicomInfo?.patientName">
          {{ dicomInfo.patientName }}
        </div>
        <div v-if="dicomInfo?.patientID">
          {{ dicomInfo.patientID }}
        </div>
        <div v-if="dicomInfo?.patientBirthDate || dicomInfo?.patientSex">
          {{ dicomInfo.patientBirthDate }} {{ dicomInfo.patientSex }}
        </div>
        <div v-if="dicomInfo?.studyDescription">
          {{ dicomInfo.studyDescription }}
        </div>
        <div v-if="dicomInfo?.seriesDescription">
          {{ dicomInfo.seriesDescription }}
        </div>
      </div>
    </template>
    <template v-slot:top-center>
      <div class="annotation-cell">
        <span>{{ topLabel }}</span>
      </div>
    </template>
    <template v-slot:top-right>
      <div class="annotation-cell">
        <div v-if="dicomInfo?.institutionName">
          {{ dicomInfo.institutionName }}
        </div>
        <div v-if="dicomInfo?.manufacturerModelName">
          {{ dicomInfo.manufacturerModelName }}
        </div>
        <div v-if="dicomInfo?.studyDate">
          {{ dicomInfo.studyDate }}
        </div>
      </div>
    </template>
    <template v-slot:middle-left>
      <div class="annotation-cell">
        <span>{{ leftLabel }}</span>
      </div>
    </template>
    <template v-slot:bottom-left>
      <div class="annotation-cell">
        <div v-if="dicomInfo?.sliceThickness || dicomInfo?.sliceLocation">
          ST: {{ dicomInfo.sliceThickness }} SL: {{ dicomInfo.sliceLocation }}
        </div>
        <div v-if="dicomInfo?.repetitionTime || dicomInfo?.echoTime">
          RT: {{ dicomInfo.repetitionTime }} ET: {{ dicomInfo.echoTime }}
        </div>
        <div v-if="dicomInfo?.magneticFieldStrength">
          FS: {{ dicomInfo.magneticFieldStrength }}
        </div>
        <div v-if="dicomInfo?.modality">
          {{ dicomInfo.modality }}
        </div>
        <div v-if="dicomInfo?.bodyPartExamined">
          {{ dicomInfo.bodyPartExamined }}
        </div>
        <div v-if="sliceConfig">
          Slice: {{ slice + 1 }}/{{ sliceRange[1] + 1 }}
        </div>
        <div v-if="dicomInfo?.seriesNumber">
          Series: {{ dicomInfo.seriesNumber }}
        </div>
      </div>
    </template>
    <template v-slot:bottom-right>
      <div class="annotation-cell">
        <div v-if="false">
          X: {{ 'x.xx' }} mm  Y: {{ 'y.yy' }} mm
        </div>
        <div v-if="true">
          X: {{ '64.00' }} px  Y: {{ '103.00' }} px
        </div>
        <div v-if="true">
          Value: {{ 232.86 }}
        </div>
        <div v-if="wlConfig">
          W/L: {{ windowWidth.toFixed(2) }} / {{ windowLevel.toFixed(2) }}
        </div>
      </div>
    </template>
    <!--
    <template v-slot:top-right>
      <div class="annotation-cell">
        <dicom-quick-info-button :image-id="imageId"></dicom-quick-info-button>
      </div>
    </template>
    -->
  </view-overlay-grid>
</template>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
