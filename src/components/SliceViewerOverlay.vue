<script setup lang="ts">
import { inject, toRefs, ref, computed, watch } from 'vue';
import vtkCoordinate from '@kitware/vtk.js/Rendering/Core/Coordinate';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import { getImageData } from '@/src/composables/useCurrentImage';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { useOrientationLabels } from '@/src/composables/useOrientationLabels';
import DicomQuickInfoButton from '@/src/components/DicomQuickInfoButton.vue';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useViewStore } from '@/src/store/views';
import { isDicomImage } from '@/src/utils/dataSelection';
import {
  // worldToSVG,
  normalizeIJKCoords
} from '@/src/utils/vtk-helpers';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
  slicingMode: string;
  hover?: boolean;
}

const props = defineProps<Props>();
const { viewId, imageId, slicingMode, hover } = toRefs(props);
const currentImageData = computed(() => getImageData(imageId.value));

const viewStore = useViewStore();
const layoutName = computed(() => viewStore.layout?.name || '');

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const sliceRep = useSliceRepresentation(view, currentImageData.value);

const dicomStore = useDICOMStore();
const dicomMoreInfo = computed(() => {
  const volumeKey = imageId.value;
  if (layoutName.value.endsWith(' Only') && volumeKey && isDicomImage(volumeKey)) {
    const volumeInfo = dicomStore.volumeInfo[volumeKey];
    const studyKey = dicomStore.volumeStudy[volumeKey];
    const studyInfo = dicomStore.studyInfo[studyKey];
    const patientKey = dicomStore.studyPatient[studyKey];
    const patientInfo = dicomStore.patientInfo[patientKey];

    const patientName = patientInfo.PatientName;                     // (0010,0010)
    const patientID = patientInfo.PatientID;                         // (0010,0020)
    const patientBirthDate = patientInfo.PatientBirthDate;           // (0010,0030)
    const patientSex = patientInfo.PatientSex;                       // (0010,0040)
    const studyDescription = studyInfo.StudyDescription;             // (0008,1030)
    const seriesDescription = volumeInfo.SeriesDescription;          // (0008,103E)

    const institutionName = studyInfo.InstitutionName;               // (0008,0080)
    const manufacturerModelName = studyInfo.ManufacturerModelName;   // (0008,1090)
    const referringPhysicianName = studyInfo.ReferringPhysicianName; // (0008,0090)
    const studyID = studyInfo.StudyID;                               // (0020,0010)
    const studyDate = studyInfo.StudyDate;                           // (0008,0020)

    const sliceThickness = volumeInfo.SliceThickness;                // (0018,0050)
    const sliceLocation = volumeInfo.SliceLocation;                  // (0020,1041)
    const repetitionTime = volumeInfo.RepetitionTime;                // (0018,0080)
    const echoTime = volumeInfo.EchoTime;                            // (0018,0081)
    const magneticFieldStrength = volumeInfo.MagneticFieldStrength;  // (0018,0087)
    const modality = volumeInfo.Modality;                            // (0008,0060)
    const bodyPartExamined = volumeInfo.BodyPartExamined;            // (0018,0015)
    const seriesNumber = volumeInfo.SeriesNumber;                    // (0020,0011)

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
      referringPhysicianName,
      studyID,
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

const coordinate = vtkCoordinate.newInstance();
coordinate.setCoordinateSystemToDisplay();
const pointValue = ref({
  x: '',
  y: '',
  value: '',
});
onVTKEvent(view.interactor, 'onMouseMove', e => {
  if (!hover.value) {
    return;
  }
  if (!e.position) {
    return;
  }
  if (!currentImageData.value || !sliceRep) {
    return;
  }
  coordinate.setValue([e.position.x, e.position.y, e.position.z]);
  const xyz = coordinate.getComputedWorldValue(view.renderer); // mm
  const ijk = currentImageData.value.worldToIndex([xyz[0], xyz[1], xyz[2]]); // px
  // const pos = worldToSVG([xyz[0], xyz[1], xyz[2]], view.renderer); // px

  // let x: number | string = pos ? pos[0] : 0;
  // let y: number | string = pos ? pos[1] : 0;
  // x = x.toFixed(2) + 'px';
  // y = y.toFixed(2) + 'px';

  const {
    ijk: [i, j, k],
    outOfRange,
  } = normalizeIJKCoords(ijk, slicingMode.value, slice.value, currentImageData.value.getExtent());

  let offsetIndex = -1;
  let pixelValue = 0;
  if (outOfRange) {
    //
  } else {
    offsetIndex = currentImageData.value.computeOffsetIndex([i, j, k]);
    pixelValue = currentImageData.value.getPointData().getScalars().getData()[offsetIndex];
    pixelValue = Math.round(pixelValue);
  }

  // console.log(viewId.value, { x, y }, [i, j], pixelValue);
  pointValue.value = {
    x: (slicingMode.value === 'I' ? 'Y: ' : slicingMode.value === 'J' ? 'X: ' : 'X: ') + `${i.toFixed(2)} px`,
    y: (slicingMode.value === 'I' ? 'Z: ' : slicingMode.value === 'J' ? 'Z: ' : 'Y: ') + `${j.toFixed(2)} px`,
    value: 'Value: ' + pixelValue,
  };
});
watch(hover, () => {
  if (!hover.value) {
    pointValue.value.x = '';
    pointValue.value.y = '';
    pointValue.value.value = '';
  }
});
</script>

<template>
  <view-overlay-grid class="overlay-no-events view-annotations">
    <template v-slot:top-left>
      <div class="annotation-cell font-mono opacity-90">
        <div v-if="dicomMoreInfo?.patientName">
          {{ dicomMoreInfo.patientName }}
        </div>
        <div v-if="dicomMoreInfo?.patientID">
          {{ dicomMoreInfo.patientID }}
        </div>
        <div v-if="dicomMoreInfo?.patientBirthDate || dicomMoreInfo?.patientSex">
          {{ dicomMoreInfo.patientBirthDate }} {{ dicomMoreInfo.patientSex }}
        </div>
        <div v-if="dicomMoreInfo?.studyDescription">
          {{ dicomMoreInfo.studyDescription }}
        </div>
        <div v-if="dicomMoreInfo?.seriesDescription">
          {{ dicomMoreInfo.seriesDescription }}
        </div>
      </div>
    </template>
    <template v-slot:top-center>
      <div class="annotation-cell">
        <span>{{ topLabel }}</span>
      </div>
    </template>
    <template v-slot:top-right>
      <div class="annotation-cell font-mono opacity-90" v-if="dicomMoreInfo !== null">
        <div v-if="dicomMoreInfo?.institutionName">
          {{ dicomMoreInfo.institutionName }}
        </div>
        <div v-if="dicomMoreInfo?.manufacturerModelName">
          {{ dicomMoreInfo.manufacturerModelName }}
        </div>
        <div v-if="dicomMoreInfo?.referringPhysicianName">
          {{ dicomMoreInfo.referringPhysicianName }}
        </div>
        <div v-if="dicomMoreInfo?.studyID">
          {{ dicomMoreInfo.studyID }}
        </div>
        <div v-if="dicomMoreInfo?.studyDate">
          {{ dicomMoreInfo.studyDate }}
        </div>
      </div>
      <div class="annotation-cell" v-else>
        <dicom-quick-info-button :image-id="imageId"></dicom-quick-info-button>
      </div>
    </template>
    <template v-slot:middle-left>
      <div class="annotation-cell">
        <span>{{ leftLabel }}</span>
      </div>
    </template>
    <template v-slot:bottom-left>
      <div class="annotation-cell font-mono opacity-90">
        <div v-if="dicomMoreInfo?.sliceThickness || dicomMoreInfo?.sliceLocation">
          ST: {{ dicomMoreInfo.sliceThickness }} SL: {{ dicomMoreInfo.sliceLocation }}
        </div>
        <div v-if="dicomMoreInfo?.repetitionTime || dicomMoreInfo?.echoTime">
          RT: {{ dicomMoreInfo.repetitionTime }} ET: {{ dicomMoreInfo.echoTime }}
        </div>
        <div v-if="dicomMoreInfo?.magneticFieldStrength">
          FS: {{ dicomMoreInfo.magneticFieldStrength }}
        </div>
        <div v-if="dicomMoreInfo?.modality">
          {{ dicomMoreInfo.modality }}
        </div>
        <div v-if="dicomMoreInfo?.bodyPartExamined">
          {{ dicomMoreInfo.bodyPartExamined }}
        </div>
        <div v-if="dicomMoreInfo?.seriesNumber">
          Series #: {{ dicomMoreInfo.seriesNumber }}
        </div>
        <div v-if="sliceConfig">
          Images: {{ slice + 1 }}/{{ sliceRange[1] + 1 }}
        </div>
        <div v-if="wlConfig">
          WL: {{ windowLevel.toFixed(2).slice(0, -3) }} WW: {{ windowWidth.toFixed(2).slice(0, -3) }}
        </div>
      </div>
    </template>
    <template v-slot:bottom-right>
      <div class="annotation-cell font-mono opacity-90">
        <div v-if="pointValue.x || pointValue.y">
          {{ pointValue.x }} {{ pointValue.y }}
        </div>
        <div v-if="pointValue.value">
          {{ pointValue.value }}
        </div>
      </div>
    </template>
  </view-overlay-grid>
</template>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
