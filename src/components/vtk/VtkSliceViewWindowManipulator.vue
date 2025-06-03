<script setup lang="ts">
import { VtkViewContext } from '@/src/components/vtk/context';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { useWindowingConfigInitializer } from '@/src/composables/useWindowingConfigInitializer';
import { useMouseRangeManipulatorListener } from '@/src/core/vtk/useMouseRangeManipulatorListener';
import { useVtkInteractionManipulator } from '@/src/core/vtk/useVtkInteractionManipulator';
import { Maybe } from '@/src/types';
import vtkMouseRangeManipulator, {
  IMouseRangeManipulatorInitialValues,
} from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import type { Vector2 } from '@kitware/vtk.js/types';
import { syncRef } from '@vueuse/core';
import { inject, toRefs, unref, computed } from 'vue';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useLoadDataStore } from '@/src/store/load-data';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
  manipulatorConfig?: IMouseRangeManipulatorInitialValues;
}

const props = defineProps<Props>();
const { viewId, imageId, manipulatorConfig } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const interactorStyle =
  view.interactorStyle as Maybe<vtkInteractorStyleManipulator>;
if (!interactorStyle?.isA('vtkInteractorStyleManipulator')) {
  throw new Error('No vtkInteractorStyleManipulator');
}

const config = computed(() => {
  return {
    button: 1,
    dragEnabled: true,
    scrollEnabled: false,
    ...manipulatorConfig?.value,
  };
});

const { instance: rangeManipulator } = useVtkInteractionManipulator(
  interactorStyle,
  vtkMouseRangeManipulator,
  config
);
const wlToolEnabled = computed(() => config.value.button !== -1);

const wlConfig = useWindowingConfig(viewId, imageId);
useWindowingConfigInitializer(viewId, imageId);

const computeStep = (range: Vector2) => {
  const diff = range[1] - range[0] || 1;
  return Math.min(diff, 1) / 256;
};
const wlStep = computed(() => computeStep(wlConfig.range.value));

const horiz = useMouseRangeManipulatorListener(
  rangeManipulator,
  'horizontal',
  wlConfig.range,
  wlStep,
  wlConfig.level.value
);

const vert = useMouseRangeManipulatorListener(
  rangeManipulator,
  'vertical',
  computed(() => [1e-12, wlConfig.range.value[1] - wlConfig.range.value[0]]),
  wlStep,
  wlConfig.width.value
);

syncRef(horiz, wlConfig.level, { immediate: true });
syncRef(vert, wlConfig.width, { immediate: true });

function handleUserMouseInteraction() {
  const imageID = unref(imageId);
  const viewID = unref(viewId);
  if (imageID && viewID) {
    const loadDataStore = useLoadDataStore();
    const volumeKeySuffix = loadDataStore.dataIDToVolumeKeyUID[imageID];
    const vol = volumeKeySuffix && loadDataStore.loadedByBus[volumeKeySuffix].volumes[imageID];
    if (vol) {
      vol.wlConfigedByUser = true;
    }
  }
}
let mouseDown = false;
let mouseMoved = false;
onVTKEvent(view.interactor, 'onLeftButtonPress', () => {
  if (!wlToolEnabled.value) {
    return;
  }
  mouseDown = true;
  mouseMoved = false;
});
onVTKEvent(view.interactor, 'onMouseMove', () => {
  if (!wlToolEnabled.value) {
    return;
  }
  if (mouseDown) {
    mouseMoved = true;
  }
});
onVTKEvent(view.interactor, 'onLeftButtonRelease', () => {
  if (!wlToolEnabled.value) {
    return;
  }
  mouseDown = false;
  if (mouseMoved) {
    handleUserMouseInteraction();
  }
  mouseMoved = false;
});
</script>

<template><slot></slot></template>
