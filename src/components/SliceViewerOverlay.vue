<script setup lang="ts">
import { inject, toRefs, ref } from 'vue';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { useOrientationLabels } from '@/src/composables/useOrientationLabels';
import DicomQuickInfoButton from '@/src/components/DicomQuickInfoButton.vue';

import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { shortenNumber } from '@/src/utils';
import { useProbeStore } from '@/src/store/probe';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkCoordinate from '@kitware/vtk.js/Rendering/Core/Coordinate';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
  currentImageData?: vtkImageData | null;
  baseRep?: ReturnType<typeof useSliceRepresentation>;
  slicingMode?: 'I' | 'J' | 'K';
  hover?: boolean;
}

const props = defineProps<Props>();
const { viewId, imageId, currentImageData, baseRep: sliceRep, slicingMode, hover } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

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

const probeStore = useProbeStore();
const pointValue = ref({
  x: '',
  y: '',
  value: '',
});

onVTKEvent(view.interactor, 'onMouseMove', e => {
  if (!hover.value) {
    return;
  }
  if (!slicingMode?.value) {
    return;
  }
  if (!currentImageData?.value || !sliceRep?.value) {
    return;
  }

  const { x, y, z } = e.position;
  coordinate.setValue([x, y, z]);
  const xyz = probeStore.probeData ? probeStore.probeData.pos : coordinate.getComputedWorldValue(view.renderer);
  const ijk = currentImageData.value.worldToIndex([xyz[0], xyz[1], xyz[2]]);
  const val = (probeStore.probeData?.samples || []).find(sample => sample.id === imageId.value)?.displayValues.map(v => typeof v === 'number' ? shortenNumber(v) : v).join(', ') || 0;

  switch (slicingMode.value) {
    case 'I': {
      const [, j, k] = ijk;
      pointValue.value = {
        x: `Y: ${j.toFixed(2)} px`,
        y: `Z: ${k.toFixed(2)} px`,
        value: `Value: ${val}`,
      };
      break;
    }
    case 'J': {
      const [i, , k] = ijk;
      pointValue.value = {
        x: `X: ${i.toFixed(2)} px`,
        y: `Z: ${k.toFixed(2)} px`,
        value: `Value: ${val}`,
      };
      break;
    }
    case 'K': {
      const [i, j] = ijk;
      pointValue.value = {
        x: `X: ${i.toFixed(2)} px`,
        y: `Y: ${j.toFixed(2)} px`,
        value: `Value: ${val}`,
      };
      break;
    }
    default: {
      pointValue.value = {
        x: '',
        y: '',
        value: '',
      };
      break;
    }
  }
});

onVTKEvent(view.interactor, 'onPointerLeave', () => {
  pointValue.value.x = '';
  pointValue.value.y = '';
  pointValue.value.value = '';
});
</script>

<template>
  <view-overlay-grid class="overlay-no-events view-annotations">
    <template v-slot:top-center>
      <div class="annotation-cell">
        <span>{{ topLabel }}</span>
      </div>
    </template>
    <template v-slot:middle-left>
      <div class="annotation-cell">
        <span>{{ leftLabel }}</span>
      </div>
    </template>
    <template v-slot:bottom-left>
      <div class="annotation-cell">
        <div v-if="sliceConfig">
          Slice: {{ slice + 1 }}/{{ sliceRange[1] + 1 }}
        </div>
        <div v-if="wlConfig">
          W/L: {{ windowWidth.toFixed(2) }} / {{ windowLevel.toFixed(2) }}
        </div>
      </div>
    </template>
    <template v-slot:top-right>
      <div class="annotation-cell">
        <dicom-quick-info-button :image-id="imageId"></dicom-quick-info-button>
      </div>
    </template>
    <template v-slot:bottom-right>
      <div class="annotation-cell">
        <div v-if="pointValue.value">
          {{ pointValue.value }}
        </div>
        <div v-if="pointValue.x || pointValue.y">
          {{ pointValue.x }} {{ pointValue.y }}
        </div>
      </div>
    </template>
  </view-overlay-grid>
</template>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
