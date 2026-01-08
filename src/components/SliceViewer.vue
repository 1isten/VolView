<template>
  <div
    class="vtk-container-wrapper"
    tabindex="0"
    @pointerenter="hover = true"
    @pointerleave="hover = false"
    @focusin="hover = true"
    @focusout="hover = false"
  >
    <div class="vtk-gutter">
      <v-btn dark icon size="medium" variant="text" class="slice-viewer-reset-camera" @click="resetCamera" @dblclick.stop>
        <v-icon size="medium" class="py-1">mdi-camera-flip-outline</v-icon>
        <v-tooltip
          location="right"
          activator="parent"
          transition="slide-x-transition"
        >
          Reset Camera
        </v-tooltip>
      </v-btn>
      <slice-slider
        v-model="currentSlice"
        class="slice-slider"
        :min="sliceRange[0]"
        :max="sliceRange[1]"
        :step="1"
        :handle-height="20"
      />
      <template v-if="isViewMaximized">
        <v-btn dark icon size="medium" variant="text" class="mt-1" @click="flip(true, true)" @dblclick.stop>
          <v-icon icon="mdi-flip-vertical" size="medium" class="py-1" />
          <v-tooltip
            location="right"
            activator="parent"
            transition="slide-x-transition"
          >
            Flip Vertical
          </v-tooltip>
        </v-btn>
        <v-btn dark icon size="medium" variant="text" class="mt-1" @click="flip(true, false)" @dblclick.stop>
          <v-icon icon="mdi-flip-horizontal" size="medium" class="py-1" />
          <v-tooltip
            location="right"
            activator="parent"
            transition="slide-x-transition"
          >
            Flip Horizontal
          </v-tooltip>
        </v-btn>
        <v-btn dark icon size="medium" variant="text" class="mt-1 mb-2" @click="rotate()" @dblclick.stop>
          <v-icon icon="mdi-rotate-right" size="medium" class="py-1" />
          <v-tooltip
            location="right"
            activator="parent"
            transition="slide-x-transition"
          >
            Rotate 90°
          </v-tooltip>
        </v-btn>
      </template>
    </div>
    <div class="vtk-container" data-testid="two-view-container">
      <v-progress-linear
        v-if="isImageLoading"
        indeterminate
        class="loading-indicator"
        height="2"
        color="grey"
      />
      <div class="vtk-sub-container">
        <vtk-slice-view
          class="vtk-view"
          ref="vtkView"
          data-testid="vtk-view vtk-two-view"
          :view-id="viewId"
          :image-id="currentImageID"
          :view-direction="viewDirection"
          :view-up="viewUp"
        >
          <vtk-mouse-interaction-manipulator
            v-if="currentTool === Tools.Pan"
            :manipulator-constructor="vtkMouseCameraTrackballPanManipulator"
            :manipulator-props="{ button: 1 }"
          ></vtk-mouse-interaction-manipulator>
          <vtk-mouse-interaction-manipulator
            :manipulator-constructor="vtkMouseCameraTrackballPanManipulator"
            :manipulator-props="{ button: 1, shift: true }"
          ></vtk-mouse-interaction-manipulator>
          <vtk-mouse-interaction-manipulator
            :manipulator-constructor="vtkMouseCameraTrackballPanManipulator"
            :manipulator-props="{ button: 2 }"
          ></vtk-mouse-interaction-manipulator>
          <vtk-mouse-interaction-manipulator
            v-if="currentTool === Tools.Zoom"
            :manipulator-constructor="
              vtkMouseCameraTrackballZoomToMouseManipulator
            "
            :manipulator-props="{ button: 1 }"
          ></vtk-mouse-interaction-manipulator>
          <vtk-mouse-interaction-manipulator
            :manipulator-constructor="
              vtkMouseCameraTrackballZoomToMouseManipulator
            "
            :manipulator-props="{ button: 3 }"
          ></vtk-mouse-interaction-manipulator>
          <vtk-slice-view-slicing-manipulator
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="viewDirection"
          ></vtk-slice-view-slicing-manipulator>
          <vtk-slice-view-slicing-key-manipulator
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="viewDirection"
          ></vtk-slice-view-slicing-key-manipulator>
          <vtk-slice-view-window-manipulator
            :view-id="viewId"
            :image-id="currentImageID"
            :manipulator-config="windowingManipulatorProps"
          ></vtk-slice-view-window-manipulator>
          <slice-viewer-overlay
            :view-id="viewId"
            :image-id="currentImageID"
            :current-image-data="currentImageData"
            :base-rep="baseSliceRep"
            :slicing-mode="currentSlicingMode"
            :hover="hover"
          ></slice-viewer-overlay>
          <vtk-base-slice-representation
            ref="baseSliceRep"
            :view-id="viewId"
            :image-id="currentImageID"
            :axis="viewAxis"
          ></vtk-base-slice-representation>
          <vtk-segmentation-slice-representation
            v-for="segId in segmentations"
            :key="`seg-${segId}`"
            :view-id="viewId"
            :segmentation-id="segId"
            :axis="viewAxis"
            ref="segSliceReps"
          ></vtk-segmentation-slice-representation>
          <template v-if="currentImageID">
            <vtk-layer-slice-representation
              v-for="layer in currentLayers"
              :key="`layer-${layer.id}`"
              ref="layerSliceReps"
              :view-id="viewId"
              :layer-id="layer.id"
              :parent-id="currentImageID"
              :axis="viewAxis"
            ></vtk-layer-slice-representation>
          </template>
          <crop-tool :view-id="viewId" :image-id="currentImageID" />
          <crosshairs-tool
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="viewDirection"
          />
          <paint-tool
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="viewDirection"
          />
          <polygon-tool
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="viewDirection"
          />
          <ruler-tool
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="viewDirection"
          />
          <rectangle-tool
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="viewDirection"
          />
          <select-tool />
          <svg class="overlay-no-events">
            <bounding-rectangle :points="selectionPoints" />
          </svg>
          <scalar-probe
            :base-rep="baseSliceRep"
            :layer-reps="layerSliceReps"
            :segment-groups-reps="segSliceReps"
          ></scalar-probe>
          <segment-plot
            :view-id="viewId"
            :image-id="currentImageID"
            :base-rep="baseSliceRep"
            :layer-reps="layerSliceReps"
            :segment-groups-reps="segSliceReps"
            :slicing-mode="currentSlicingMode"
            :slice="currentSlice"
            :hover="hover"
          ></segment-plot>
          <slot></slot>
        </vtk-slice-view>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, Ref, toRefs, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { resetCameraToImage, resizeToFitImage } from '@/src/utils/camera';
import VtkSliceView from '@/src/components/vtk/VtkSliceView.vue';
import { VtkViewApi } from '@/src/types/vtk-types';
import { Tools } from '@/src/store/tools/types';
import VtkBaseSliceRepresentation from '@/src/components/vtk/VtkBaseSliceRepresentation.vue';
import VtkSegmentationSliceRepresentation from '@/src/components/vtk/VtkSegmentationSliceRepresentation.vue';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import VtkLayerSliceRepresentation from '@/src/components/vtk/VtkLayerSliceRepresentation.vue';
import { useViewAnimationListener } from '@/src/composables/useViewAnimationListener';
import CropTool from '@/src/components/tools/crop/CropTool.vue';
import CrosshairsTool from '@/src/components/tools/crosshairs/CrosshairsTool.vue';
import PaintTool from '@/src/components/tools/paint/PaintTool.vue';
import PolygonTool from '@/src/components/tools/polygon/PolygonTool.vue';
import RulerTool from '@/src/components/tools/ruler/RulerTool.vue';
import RectangleTool from '@/src/components/tools/rectangle/RectangleTool.vue';
import SelectTool from '@/src/components/tools/SelectTool.vue';
import ScalarProbe from '@/src/components/tools/ScalarProbe.vue';
import SegmentPlot from '@/src/components/SegmentPlot.vue';
import BoundingRectangle from '@/src/components/tools/BoundingRectangle.vue';
import SliceSlider from '@/src/components/SliceSlider.vue';
import SliceViewerOverlay from '@/src/components/SliceViewerOverlay.vue';
import { useViewStore } from '@/src/store/views';
import { useLoadDataStore } from '@/src/store/load-data';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { useAnnotationToolStore, useToolStore } from '@/src/store/tools';
import { doesToolFrameMatchViewAxis } from '@/src/composables/annotationTool';
import { useWebGLWatchdog } from '@/src/composables/useWebGLWatchdog';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import VtkSliceViewWindowManipulator from '@/src/components/vtk/VtkSliceViewWindowManipulator.vue';
import VtkSliceViewSlicingManipulator from '@/src/components/vtk/VtkSliceViewSlicingManipulator.vue';
import VtkSliceViewSlicingKeyManipulator from '@/src/components/vtk/VtkSliceViewSlicingKeyManipulator.vue';
import VtkMouseInteractionManipulator from '@/src/components/vtk/VtkMouseInteractionManipulator.vue';
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator';
import vtkMouseCameraTrackballZoomToMouseManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomToMouseManipulator';
import { SlicingMode } from '@kitware/vtk.js/Rendering/Core/ImageMapper/Constants';
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import type { LPSAxis, LPSAxisDir } from '@/src/types/lps';
import { get2DViewingVectors } from '@/src/utils/getViewingVectors';

import { mat4, vec3 } from 'gl-matrix';

interface Props {
  viewId: string;
}

interface SliceViewerOptions {
  orientation: LPSAxis;
}

const vtkView = ref<VtkViewApi>();
const baseSliceRep = ref();
const layerSliceReps = ref([]);
const segSliceReps = ref([]);

const props = defineProps<Props>();
const { viewId } = toRefs(props);

const viewStore = useViewStore();
const isViewMaximized = computed(() => viewStore.isActiveViewMaximized || viewStore.currentLayoutName?.endsWith(' Only'));

const viewInfo = computed(() => viewStore.getView(viewId.value)!);
const viewOptions = computed(
  () => viewInfo.value.options as SliceViewerOptions
);

const viewingVectors = computed(() =>
  get2DViewingVectors(viewOptions.value.orientation)
);
const viewDirection = computed(() => viewingVectors.value.viewDirection);
const viewUp = computed(() => viewingVectors.value.viewUp);
const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

const hover = ref(false);

function resetCamera() {
  vtkView.value?.resetCamera();
  resetFlipAndRotateState();
}

useResetViewsEvents().onClick(resetCamera);

useWebGLWatchdog(vtkView);
useViewAnimationListener(vtkView, viewId, '2D');

// active tool
const { currentTool } = storeToRefs(useToolStore());
const windowingManipulatorProps = computed(() =>
  currentTool.value === Tools.WindowLevel ? { button: 1 } : { button: -1 }
);

// base image
const {
  currentImageID,
  currentLayers,
  currentImageMetadata,
  currentImageData,
  isImageLoading,
} = useCurrentImage();
const { slice: currentSlice, range: sliceRange } = useSliceConfig(
  viewId,
  currentImageID
);

const currentSlicingMode = computed(() => {
  if (currentImageMetadata.value) {
    const { lpsOrientation } = currentImageMetadata.value;
    const ijkIndex = lpsOrientation[viewAxis.value];
    const mode = [SlicingMode.I, SlicingMode.J, SlicingMode.K][ijkIndex];
    return ['I', 'J', 'K'][mode] as 'I' | 'J' | 'K';
  }
  return undefined;
});

onVTKEvent(currentImageData, 'onModified', () => {
  vtkView.value?.requestRender();
});

const segmentations = computed(() => {
  if (!currentImageID.value) return [];
  const store = useSegmentGroupStore();
  return store.orderByParent[currentImageID.value];
});

// --- selection points --- //

const selectionStore = useToolSelectionStore();
const selectionPoints = computed(() => {
  return selectionStore.selection
    .map((sel) => {
      const store = useAnnotationToolStore(sel.type);
      return { store, tool: store.toolByID[sel.id] };
    })
    .filter(
      ({ tool }) =>
        tool.slice === currentSlice.value &&
        !tool.hidden &&
        doesToolFrameMatchViewAxis(viewAxis, tool, currentImageMetadata)
    )
    .flatMap(({ store, tool }) => store.getPoints(tool.id));
});

// --- Custom support for flipping and rotating the view --- //

const loadDataStore = useLoadDataStore();
const volCameraInfo = computed(() => {
  if (currentImageID.value && viewId.value) {
    const volumeKeySuffix = loadDataStore.dataIDToVolumeKeyUID[currentImageID.value];
    const vol = volumeKeySuffix && loadDataStore.loadedByBus[volumeKeySuffix].volumes[currentImageID.value];
    if (vol) {
      return vol.camera || null;
    }
  }
  return null;
});

const flipDirection: Ref<LPSAxisDir | undefined> = ref();
const flipUp: Ref<LPSAxisDir | undefined> = ref();
function flip(h = true, v = false) {
  if (!vtkView.value) return;
  const viewName = viewStore.getView(viewId.value)?.name as 'Axial' | 'Sagittal' | 'Coronal' | undefined;
  switch (viewName) {
    case 'Axial': {
      if (h) {
        flipDirection.value = flipDirection.value || volCameraInfo?.value?.Axial?.viewDirection || viewDirection.value;
        flipDirection.value = flipDirection.value === 'Superior' ? 'Inferior' : 'Superior';
      }
      if (v) {
        flipUp.value = flipUp.value || volCameraInfo?.value?.Axial?.viewUp || viewUp.value;
        flipUp.value = flipUp.value === 'Anterior' ? 'Posterior' : 'Anterior';
      }
      break;
    }
    case 'Sagittal': {      
      if (h) {
        flipDirection.value = flipDirection.value || volCameraInfo?.value?.Sagittal?.viewDirection || viewDirection.value;
        flipDirection.value = flipDirection.value === 'Right' ? 'Left' : 'Right';
      }
      if (v) {
        flipUp.value = flipUp.value || volCameraInfo?.value?.Sagittal?.viewUp || viewUp.value;
        flipUp.value = flipUp.value === 'Superior' ? 'Inferior' : 'Superior';
      }
      break;
    }
    case 'Coronal': {
      if (h) {
        flipDirection.value = flipDirection.value || volCameraInfo?.value?.Coronal?.viewDirection || viewDirection.value;
        flipDirection.value = flipDirection.value === 'Posterior' ? 'Anterior' : 'Posterior';
      }
      if (v) {
        flipUp.value = flipUp.value || volCameraInfo?.value?.Coronal?.viewUp || viewUp.value;
        flipUp.value = flipUp.value === 'Superior' ? 'Inferior' : 'Superior';
      }
      break;
    }
    default: {
      break;
    }
  }
  if (viewName) {
    resetCameraToImage(
      vtkView.value,
      currentImageMetadata.value,
      flipDirection.value || volCameraInfo?.value?.[viewName]?.viewDirection || viewDirection.value,
      flipUp.value || volCameraInfo?.value?.[viewName]?.viewUp || viewUp.value
    );
    resizeToFitImage(
      vtkView.value,
      currentImageMetadata.value,
      flipDirection.value || volCameraInfo?.value?.[viewName]?.viewDirection || viewDirection.value,
      flipUp.value || volCameraInfo?.value?.[viewName]?.viewUp || viewUp.value
    );
  }
}

const rotateDegrees: Ref<number> = ref(0);
const rotate = () => {
  if (!vtkView.value) return;
  const camera = vtkView.value.renderer.getActiveCamera();

  const rotationMatrix = mat4.create();
  mat4.fromRotation(rotationMatrix, (Math.PI / 2) * -1, camera.getDirectionOfProjection()); // rotate 90 degrees clockwise

  const newViewUp = vec3.create();
  vec3.transformMat4(newViewUp, camera.getViewUp(), rotationMatrix);

  camera.setViewUp(newViewUp[0], newViewUp[1], newViewUp[2]);
  vtkView.value.requestRender();

  rotateDegrees.value = (rotateDegrees.value + 90) % 360;
};

function resetFlipAndRotateState() {
  flipDirection.value = undefined;
  flipUp.value = undefined;
  rotateDegrees.value = 0;
}
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>
