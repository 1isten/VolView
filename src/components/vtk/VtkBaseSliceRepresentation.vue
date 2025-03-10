<script setup lang="ts">
import { computed, toRefs, watchEffect, inject } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { LPSAxis } from '@/src/types/lps';
import { syncRefs } from '@vueuse/core';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { SlicingMode } from '@kitware/vtk.js/Rendering/Core/ImageMapper/Constants';
import { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';

import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import useVolumeColoringStore from '@/src/store/view-configs/volume-coloring';
import { useVolumeColoringInitializer } from '@/src/composables/useVolumeColoringInitializer';
import { applyColoring } from '@/src/composables/useColoringEffect';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
  axis: LPSAxis;
}

const props = defineProps<Props>();
const { viewId: viewID, imageId: imageID, axis } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const { metadata: imageMetadata, imageData } = useImage(imageID);

// bind slice and window configs
const sliceConfig = useSliceConfig(viewID, imageID);
const wlConfig = useWindowingConfig(viewID, imageID);

// setup base image
const sliceRep = useSliceRepresentation(view, imageData);

// set slice ordering to be in the back
sliceRep.mapper.setResolveCoincidentTopologyToPolygonOffset();
sliceRep.mapper.setResolveCoincidentTopologyPolygonOffsetParameters(1, 1);

// set slicing mode
watchEffect(() => {
  const { lpsOrientation } = imageMetadata.value;
  const ijkIndex = lpsOrientation[axis.value];
  const mode = [SlicingMode.I, SlicingMode.J, SlicingMode.K][ijkIndex];
  sliceRep.mapper.setSlicingMode(mode);
});

// sync slicing
const slice = vtkFieldRef(sliceRep.mapper, 'slice');
syncRefs(sliceConfig.slice, slice, { immediate: true });

// sync windowing
const colorLevel = vtkFieldRef(sliceRep.property, 'colorLevel');
const colorWindow = vtkFieldRef(sliceRep.property, 'colorWindow');
syncRefs(wlConfig.level, colorLevel, { immediate: true });
syncRefs(wlConfig.width, colorWindow, { immediate: true });

// apply coloring
useVolumeColoringInitializer(viewID, imageID);

const coloringConfig = computed(() =>
  useVolumeColoringStore().getConfig(viewID.value, imageID.value)
);
const applyBaseColoring = () => {
  const config = coloringConfig.value;
  if (!config) return;

  const isHeatmap = config.transferFunction.preset === 'Heatmap';

  const cfun = vtkColorTransferFunction.newInstance();
  const ofun = vtkPiecewiseFunction.newInstance();
  sliceRep.property.setRGBTransferFunction(0, isHeatmap ? cfun : null);
  sliceRep.property.setScalarOpacity(0, isHeatmap ? ofun : null);
  // sliceRep.property.setUseLookupTableScalarRange(false);

  applyColoring({
    props: {
      colorFunction: config.transferFunction,
      opacityFunction: config.opacityFunction,
    },
    cfun,
    ofun,
  });
};

watchEffect(applyBaseColoring);

defineExpose(sliceRep);
</script>

<template>
  <slot></slot>
</template>
