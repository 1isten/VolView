<script setup lang="ts">
import { computed, toRefs, watchEffect, inject } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { useCineRendering } from '@/src/composables/useCineRendering';
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

type Props = {
  viewId: string;
  imageId: Maybe<string>;
  axis: LPSAxis;
  frame?: number;
};

const props = defineProps<Props>();
const { viewId: viewID, imageId: imageID, axis } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const { metadata: imageMetadata, imageData } = useImage(imageID);

const sliceConfig = useSliceConfig(viewID, imageID);
const wlConfig = useWindowingConfig(viewID, imageID);

const { cine, mapperInput } = useCineRendering(
  view,
  imageID,
  imageData,
  () => props.frame
);

const sliceRep = useSliceRepresentation(view, mapperInput);

// Push the base image behind layers/segmentations.
sliceRep.mapper.setResolveCoincidentTopologyToPolygonOffset();
sliceRep.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(1, 1);

watchEffect(() => {
  const { lpsOrientation } = imageMetadata.value;
  const ijkIndex = lpsOrientation[axis.value];
  const mode = [SlicingMode.I, SlicingMode.J, SlicingMode.K][ijkIndex];
  sliceRep.mapper.setSlicingMode(mode);
});

// Cine: the per-view image is a single 2D plane (mapper slice is always 0).
// The frame index drives the cine render buffer instead.
const slice = vtkFieldRef(sliceRep.mapper, 'slice');
const renderSlice = computed(() => (cine.value ? 0 : sliceConfig.slice.value));
syncRefs(renderSlice, slice, { immediate: true });

// Cine pixels are 8-bit display-encoded — pin W/L to a full-byte pass-through
// and skip the bidirectional wlConfig sync, which would otherwise overwrite
// these with uninitialized defaults on first paint.
const colorLevel = vtkFieldRef(sliceRep.property, 'colorLevel');
const colorWindow = vtkFieldRef(sliceRep.property, 'colorWindow');

watchEffect((onCleanup) => {
  if (cine.value) {
    colorWindow.value = 255;
    colorLevel.value = 127.5;
    return;
  }
  const stopLevel = syncRefs(wlConfig.level, colorLevel, { immediate: true });
  const stopWidth = syncRefs(wlConfig.width, colorWindow, { immediate: true });
  onCleanup(() => {
    stopLevel();
    stopWidth();
  });
});

// apply coloring
useVolumeColoringInitializer(viewID, imageID);

const coloringConfig = computed(() =>
  useVolumeColoringStore().getConfig(viewID.value, imageID.value)
);
const applyBaseColoring = () => {
  const config = coloringConfig.value;
  if (!config) return;

  const useHeatmap = config.transferFunction.preset === 'Heatmap';

  const cfun = vtkColorTransferFunction.newInstance();
  const ofun = vtkPiecewiseFunction.newInstance();
  sliceRep.property.setRGBTransferFunction(0, useHeatmap ? cfun : null);
  sliceRep.property.setScalarOpacity(0, useHeatmap ? ofun : null);
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
