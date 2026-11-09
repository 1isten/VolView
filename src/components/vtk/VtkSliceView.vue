<script setup lang="ts">
import {
  computed,
  ref,
  toRefs,
  provide,
  markRaw,
  effectScope,
  onUnmounted,
} from 'vue';
import { storeToRefs } from 'pinia';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import { useVtkView } from '@/src/core/vtk/useVtkView';
import { useImage } from '@/src/composables/useCurrentImage';
import { useVtkInteractorStyle } from '@/src/core/vtk/useVtkInteractorStyle';
import { LPSAxisDir } from '@/src/types/lps';
import { useResizeObserver, watchImmediate } from '@vueuse/core';
import { resetCameraToImage, resizeToFitImage } from '@/src/utils/camera';
import { usePersistCameraConfig } from '@/src/composables/usePersistCameraConfig';
import { useAutoFitState } from '@/src/composables/useAutoFitState';
import { Maybe } from '@/src/types';
import { VtkViewApi } from '@/src/types/vtk-types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useViewCameraStore } from '@/src/store/view-configs/camera';
import { useLoadDataStore } from '@/src/store/load-data';

type Props = {
  viewId: string;
  imageId: Maybe<string>;
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
};

const props = defineProps<Props>();
const {
  viewId: viewID,
  imageId: imageID,
  viewDirection,
  viewUp,
} = toRefs(props);

const loadDataStore = useLoadDataStore();
const volCameraInfo = computed(() => {
  if (imageID.value && viewID.value) {
    const volumeKeySuffix = loadDataStore.dataIDToVolumeKeyUID[imageID.value];
    const vol =
      volumeKeySuffix &&
      loadDataStore.loadedByBus[volumeKeySuffix].volumes[imageID.value];
    if (vol) {
      return vol.camera || null;
    }
  }
  return null;
});

const vtkContainerRef = ref<HTMLElement>();
const viewCameraStore = useViewCameraStore();
const { disableCameraAutoReset } = storeToRefs(viewCameraStore);

const { metadata: imageMetadata, imageData } = useImage(imageID);

// use a detached scope so that actors can be removed from
// the renderer before the renderer is deleted.
const scope = effectScope(true);
const view = scope.run(() =>
  useVtkView(vtkContainerRef, {
    separateImageLayer: true,
    clippingBounds: computed(() => imageMetadata.value.worldBounds),
  })
)!;

onUnmounted(() => {
  scope.stop();
});

view.renderer.setBackground(0, 0, 0);
view.renderer.getActiveCamera().setParallelProjection(true);

// setup interactor style
const { interactorStyle } = useVtkInteractorStyle(
  vtkInteractorStyleManipulator,
  view
);
// Camera manipulators fit clipping to image bounds; widgets pick the upper layer.
interactorStyle.setFocusedRenderer(view.imageRenderer);

// bind slice and window configs
// resizeToFit camera controls
const autoFitEnabled = computed({
  get: () =>
    viewCameraStore.getConfig(viewID.value, imageID.value)?.autoFit ?? true,
  set: (autoFit) => {
    if (imageID.value) {
      viewCameraStore.updateConfig(viewID.value, imageID.value, { autoFit });
    }
  },
});

const autoFit = useAutoFitState(
  view.renderer.getActiveCamera(),
  autoFitEnabled
);

function autoFitImage() {
  if (!autoFit.autoFit.value) return;
  autoFit.withPaused(() => {
    resizeToFitImage(
      view,
      imageMetadata.value,
      viewDirection.value,
      viewUp.value
    );
  });
}

useResizeObserver(vtkContainerRef, () => {
  if (disableCameraAutoReset.value) return;
  autoFitImage();
});

function resetCamera() {
  const cameraInfo =
    volCameraInfo.value?.[viewID.value as keyof typeof volCameraInfo.value];

  autoFit.autoFit.value = true;
  autoFit.withPaused(() => {
    resetCameraToImage(
      view,
      imageMetadata.value,
      cameraInfo?.viewDirection || viewDirection.value,
      cameraInfo?.viewUp || viewUp.value
    );
    autoFitImage();
  });
}

watchImmediate(
  // PMT-ONLY: `imageData` is null until the image has renderable pixels
  // (progressive DICOM chunks are registered before their data arrives).
  // Waiting for it avoids fitting the camera to the placeholder 1x1x1
  // metadata, which would leave the slice outside the view and render black.
  // Keep `imageData` in the dependency list when merging upstream.
  [viewID, imageID, disableCameraAutoReset, imageData],
  ([viewID_, imageID_, noAutoReset, data]) => {
    if (
      imageID_ &&
      data &&
      !viewCameraStore.isCameraInitialized(viewID_, imageID_) &&
      !noAutoReset
    ) {
      resetCamera();
      viewCameraStore.markCameraAsInitialized(viewID_, imageID_);
    }
  }
);

// PMT-ONLY: restore the persisted camera when the view remounts (layout
// change, maximize). The persistence composable below only writes; without
// restoring, a remounted view keeps VTK's default camera and renders black
// (and the persisted autoFit=false suppresses the resize fit that used to
// hide it).
watchImmediate([viewID, imageID], () => {
  if (!imageID.value) return;
  if (!viewCameraStore.isCameraInitialized(viewID.value, imageID.value)) {
    return;
  }
  const config = viewCameraStore.getConfig(viewID.value, imageID.value);
  if (!config) return;
  const camera = view.renderer.getActiveCamera();
  if (config.position) {
    camera.setPosition(...(config.position as [number, number, number]));
  }
  if (config.focalPoint) {
    camera.setFocalPoint(...(config.focalPoint as [number, number, number]));
  }
  if (config.viewUp) {
    camera.setViewUp(...(config.viewUp as [number, number, number]));
  }
  if (typeof config.parallelScale === 'number') {
    camera.setParallelScale(config.parallelScale);
  }
  if (imageMetadata.value?.worldBounds) {
    view.renderer.resetCameraClippingRange(imageMetadata.value.worldBounds);
  }
  view.renderWindow.render();
});

// Must run before the clipping-range watcher below: resetCameraClippingRange
// computes near/far from the camera's current position, so on remount the
// saved position must be restored first or the slice falls outside the clip
// volume and the canvas goes black.
//
// PMT-ONLY: persistence is gated on the camera being initialized for this
// image. Before that the camera still holds the VTK default (or a placeholder
// fit), and saving it would make a remount restore a camera looking at the
// origin. Keep the `enabled` option when merging upstream.
usePersistCameraConfig(viewID, imageID, view.renderer.getActiveCamera(), {
  enabled: computed(() =>
    viewCameraStore.isCameraInitialized(viewID.value, imageID.value)
  ),
});

watchImmediate([imageMetadata, disableCameraAutoReset], () => {
  if (
    viewCameraStore.isCameraInitialized(viewID.value, imageID.value) ||
    disableCameraAutoReset.value
  ) {
    view.renderer.resetCameraClippingRange(imageMetadata.value.worldBounds);
  }
});

// exposed API
const api: VtkViewApi = markRaw({
  ...view,
  interactorStyle,
  resetCamera,
});

defineExpose(api);
provide(VtkViewContext, api);

function onPointerDown() {
  autoFit.resume();
}

function onPointerUp() {
  autoFit.pause();
}
</script>

<template>
  <div>
    <div
      ref="vtkContainerRef"
      class="view"
      @pointerdown.capture="onPointerDown"
      @pointerup.capture="onPointerUp"
    />
    <slot></slot>
  </div>
</template>

<style scoped>
.view {
  width: 100%;
  height: 100%;
}
</style>
