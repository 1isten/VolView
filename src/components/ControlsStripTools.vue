<template>
  <item-group
    mandatory
    :model-value="currentTool"
    @update:model-value="setCurrentTool($event)"
  >
    <div class="my-1 tool-separator" />
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.WindowLevel"
    >
      <v-tooltip
        :text="windowingUnavailableReason"
        :disabled="!windowingUnavailableReason"
        location="right"
      >
        <template #activator="{ props: tooltipProps }">
          <span
            v-bind="tooltipProps"
            :tabindex="windowingUnavailableReason ? 0 : undefined"
            data-testid="windowing-tool"
          >
            <menu-control-button
              icon="mdi-circle-half-full"
              :name="`Window & Level [${nameToShortcut['Window & Level']}]`"
              :active="active"
              :disabled="!!windowingUnavailableReason"
              @click="toggle"
            >
              <window-level-controls />
            </menu-control-button>
          </span>
        </template>
      </v-tooltip>
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Pan">
      <control-button
        icon="mdi-cursor-move"
        :name="'Pan' + '' || ` [${nameToShortcut['Pan']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Zoom">
      <control-button
        icon="mdi-magnify-plus-outline"
        :name="'Zoom' + '' || ` [${nameToShortcut['Zoom']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.Crosshairs"
    >
      <control-button
        icon="mdi-crosshairs"
        :name="'Crosshairs' + '' || ` [${nameToShortcut['Crosshairs']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="
          noCurrentImage ||
          isObliqueLayout ||
          isDisallowedOnCine(Tools.Crosshairs)
        "
        @click="toggle"
      />
    </groupable-item>
    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Select">
      <control-button
        icon="mdi-cursor-default"
        :name="'Select' + '' || ` [${nameToShortcut['Select']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Paint">
      <control-button
        icon="mdi-brush"
        :name="'Paint' + '' || ` [${nameToShortcut['Paint']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="!!paintUnavailableReason"
        @click="toggle"
      ></control-button>
    </groupable-item>

    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.Rectangle"
    >
      <control-button
        icon="mdi-vector-square"
        :name="`Rectangle [${nameToShortcut['Rectangle']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Circle">
      <control-button
        icon="mdi-circle-outline"
        :name="`Circle [${nameToShortcut['Circle']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Polygon">
      <control-button
        icon="mdi-pentagon-outline"
        :name="`Polygon [${nameToShortcut['Polygon']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Ruler">
      <control-button
        icon="mdi-ruler"
        :name="`Ruler [${nameToShortcut['Ruler']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      />
    </groupable-item>

    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Crop">
      <menu-control-button
        icon="mdi-crop"
        :name="'Crop' + '' || ` [${nameToShortcut['Crop']}]`"
        :active="active"
        :disabled="
          noCurrentImage || isObliqueLayout || isDisallowedOnCine(Tools.Crop)
        "
        @click="toggle"
      >
        <crop-controls />
      </menu-control-button>
    </groupable-item>
    <div class="my-1 tool-separator" />
    <reset-views />
  </item-group>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch, onMounted } from 'vue';
import { useDisplay } from 'vuetify';
import { onKeyDown } from '@vueuse/core';
import { isCineImage } from '@/src/core/cine/isCineImage';
import { Tools } from '@/src/store/tools/types';
import ControlButton from '@/src/components/ControlButton.vue';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import { useToolStore, isToolAllowedFor } from '@/src/store/tools';
import { useEffectiveView } from '@/src/composables/useEffectiveView';
import { toRef } from 'vue';
import MenuControlButton from '@/src/components/MenuControlButton.vue';
import CropControls from '@/src/components/tools/crop/CropControls.vue';
import ResetViews from '@/src/components/tools/ResetViews.vue';
import WindowLevelControls from '@/src/components/tools/windowing/WindowLevelControls.vue';
import {
  actionToKey,
  readableBinding,
  useActionHeld,
} from '@/src/composables/useKeyboardShortcuts';
import {
  useCurrentImage,
  getImageMetadata,
} from '@/src/composables/useCurrentImage';
import { useViewStore } from '@/src/store/views';
import { getHoveredAnnotation } from '@/src/composables/annotationTool';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import {
  useAnnotationToolStore,
  AnnotationToolStoreMap,
} from '@/src/store/tools';
import { AnnotationToolType } from '@/src/store/tools/types';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { get2DViewingVectors } from '@/src/utils/getViewingVectors';
import { useFrameOfReference } from '@/src/composables/useFrameOfReference';
import { ToolID } from '@/src/types/annotation-tool';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import { vec3 } from 'gl-matrix';
import type { LPSAxis, LPSDirections } from '@/src/types/lps';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';

type CopiedAnnotation = {
  type: AnnotationToolType;
  data: Record<string, any>;
  // 2D screen offsets (in mm) from the source image center, along camera right/up
  canvasPoints: { key: string; index?: number; dx: number; dy: number }[];
};

// Get camera right and up world-space vectors for a given view orientation.
// Right = screen X direction, Up = VTK screen up direction.
function getCameraVectors(viewOrientation: LPSAxis, lpsDirs: LPSDirections) {
  switch (viewOrientation) {
    case 'Axial':
      return { right: lpsDirs.Left as vec3, up: lpsDirs.Anterior as vec3 };
    case 'Coronal':
      return { right: lpsDirs.Left as vec3, up: lpsDirs.Superior as vec3 };
    case 'Sagittal':
      return { right: lpsDirs.Posterior as vec3, up: lpsDirs.Superior as vec3 };
    default:
      return { right: lpsDirs.Left as vec3, up: lpsDirs.Anterior as vec3 };
  }
}

let annotationClipboard: CopiedAnnotation[] = [];

export default defineComponent({
  components: {
    ControlButton,
    MenuControlButton,
    ItemGroup,
    GroupableItem,
    CropControls,
    ResetViews,
    WindowLevelControls,
  },
  props: {
    defaultTool: {
      type: String,
    },
  },
  setup(props) {
    // const dataStore = useDatasetStore();
    const toolStore = useToolStore();
    const viewStore = useViewStore();

    const { currentImageID, currentImageData, currentImageMetadata } =
      useCurrentImage();
    const noCurrentImage = computed(() => !currentImageID.value);
    const currentTool = computed(() => toolStore.currentTool);

    const windowingUnavailableReason = computed(() => {
      if (!currentImageID.value) return 'Load an image to adjust window/level.';
      const scalars = currentImageData.value?.getPointData().getScalars();
      if (!scalars) return 'The image must finish loading first.';
      if (isCineImage(currentImageID.value))
        return 'Cine images already contain display-encoded pixels.';
      const components = scalars.getNumberOfComponents();
      if (components === 3 || components === 4)
        return 'RGB and RGBA images use their original colors.';
      return '';
    });

    const activeViewRef = toRef(viewStore, 'activeView');
    const activeEffective = useEffectiveView(
      computed(() => activeViewRef.value ?? '')
    );

    // The rendered viewer is decided by effective kind, not stored slot type:
    // a cine clip dropped into an Oblique slot still renders as cine, so the
    // toolbar should treat it as cine, not Oblique.
    const isObliqueLayout = computed(
      () => activeEffective.value?.kind === 'oblique'
    );

    const isCineActive = computed(() => activeEffective.value?.kind === 'cine');
    const isDisallowedOnCine = (tool: Tools) =>
      isCineActive.value && !isToolAllowedFor(tool, activeEffective.value);

    const paintUnavailableReason = computed(
      () => toolStore.paintUnavailableReason
    );

    const paintMenu = ref(false);
    const cropMenu = ref(false);
    const windowingMenu = ref(false);

    onKeyDown('Escape', () => {
      paintMenu.value = false;
      cropMenu.value = false;
      windowingMenu.value = false;

      // Cancel in-progress annotation drawing
      const tool = currentTool.value as string;
      if (tool in AnnotationToolStoreMap) {
        const store = useAnnotationToolStore(tool as AnnotationToolType);
        store.cancelPlacing();
      }
    });

    onKeyDown(['Backspace', 'Delete'], () => {
      // Delete selected annotations first
      const selectionStore = useToolSelectionStore();
      if (selectionStore.selection.length > 0) {
        [...selectionStore.selection].forEach(({ id, type }) => {
          const store = useAnnotationToolStore(type);
          store.removeTool(id);
        });
        return;
      }
      // Otherwise delete the hovered annotation
      const { toolID, toolStore: hoveredStore } = getHoveredAnnotation();
      if (toolID && hoveredStore) {
        hoveredStore.removeTool(toolID);
      }
    });

    onKeyDown('a', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const selectionStore = useToolSelectionStore();
      const imageID = currentImageID.value;
      if (!imageID) return;

      // Only select annotations visible on the active view's current slice
      const activeViewID = viewStore.activeView;
      if (!activeViewID) return;
      const activeView = viewStore.getView(activeViewID);
      if (!activeView || activeView.type !== '2D') return;

      const { orientation } = activeView.options;
      const { slice } = useSliceConfig(activeViewID, imageID);
      const currentSlice = slice.value;
      const metadata = currentImageMetadata.value;

      (
        Object.entries(AnnotationToolStoreMap) as [
          AnnotationToolType,
          () => any,
        ][]
      ).forEach(([type, useStore]) => {
        const store = useStore();
        store.finishedTools
          .filter((tool: any) => {
            if (tool.imageID !== imageID) return false;
            const axisInfo = frameOfReferenceToImageSliceAndAxis(
              tool.frameOfReference,
              metadata
            );
            if (!axisInfo) return false;
            return axisInfo.axis === orientation && tool.slice === currentSlice;
          })
          .forEach((tool: any) => selectionStore.addSelection(tool.id, type));
      });
    });

    // Copy selected annotations (Ctrl+C / Cmd+C)
    onKeyDown('c', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const selectionStore = useToolSelectionStore();
      if (selectionStore.selection.length === 0) return;
      e.preventDefault();
      annotationClipboard = selectionStore.selection
        .map(({ id, type }) => {
          const store = useAnnotationToolStore(type);
          const tool = store.toolByID[id] as any;
          if (!tool) return null;
          const data = JSON.parse(JSON.stringify(tool));
          delete data.id;
          delete data.placing;

          // Determine source view orientation from the tool's frameOfReference
          const srcMeta = getImageMetadata(data.imageID);
          const srcAxisInfo = frameOfReferenceToImageSliceAndAxis(
            data.frameOfReference,
            srcMeta,
            { allowOutOfBoundsSlice: true, allowNonIntegralSlice: true }
          );
          if (!srcAxisInfo) return null;

          // Get camera right/up vectors to decompose world offset from image center
          const { right: srcRight, up: srcUp } = getCameraVectors(
            srcAxisInfo.axis,
            srcMeta.lpsOrientation
          );
          const srcCenter = vtkBoundingBox.getCenter(srcMeta.worldBounds);

          const canvasPoints: CopiedAnnotation['canvasPoints'] = [];
          const toCanvas = (worldPt: number[]) => {
            const offset: vec3 = [
              worldPt[0] - srcCenter[0],
              worldPt[1] - srcCenter[1],
              worldPt[2] - srcCenter[2],
            ];
            return {
              dx: vec3.dot(offset, srcRight),
              dy: vec3.dot(offset, srcUp),
            };
          };
          if (data.firstPoint) {
            canvasPoints.push({
              key: 'firstPoint',
              ...toCanvas(data.firstPoint),
            });
          }
          if (data.secondPoint) {
            canvasPoints.push({
              key: 'secondPoint',
              ...toCanvas(data.secondPoint),
            });
          }
          if (data.points) {
            data.points.forEach((pt: number[], i: number) => {
              canvasPoints.push({ key: 'points', index: i, ...toCanvas(pt) });
            });
          }

          return { type, data, canvasPoints } as CopiedAnnotation;
        })
        .filter((item): item is CopiedAnnotation => item !== null);
    });

    // Paste annotations (Ctrl+V / Cmd+V)
    onKeyDown('v', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (annotationClipboard.length === 0) return;
      e.preventDefault();

      const imageID = currentImageID.value;
      if (!imageID) return;

      // Get current slice/frameOfReference from the active view
      const activeViewID = viewStore.activeView;
      if (!activeViewID) return;
      const activeView = viewStore.getView(activeViewID);
      if (!activeView || activeView.type !== '2D') return;

      const { orientation } = activeView.options;
      const { viewDirection } = get2DViewingVectors(orientation);
      const { slice } = useSliceConfig(activeViewID, imageID);
      const frameOfReference = useFrameOfReference(
        viewDirection,
        slice,
        currentImageMetadata
      );

      // Target camera vectors and image center
      const tgtMeta = currentImageMetadata.value;
      const { right: tgtRight, up: tgtUp } = getCameraVectors(
        orientation,
        tgtMeta.lpsOrientation
      );
      const tgtCenter = vtkBoundingBox.getCenter(tgtMeta.worldBounds);

      // Compute slice offset: shift from image center's slice to the target slice
      const planeNormal = frameOfReference.value.planeNormal;
      const planeOrigin = frameOfReference.value.planeOrigin;
      const sliceShift = vec3.dot(
        [
          planeOrigin[0] - tgtCenter[0],
          planeOrigin[1] - tgtCenter[1],
          planeOrigin[2] - tgtCenter[2],
        ],
        planeNormal
      );

      const selectionStore = useToolSelectionStore();
      selectionStore.clearSelection();

      annotationClipboard.forEach(({ type, data, canvasPoints }) => {
        const store = useAnnotationToolStore(type);
        const remappedData = { ...data };

        // Rebuild world points: imageCenter + dx*right + dy*up + sliceShift*normal
        const toWorld = (dx: number, dy: number) => {
          const w: [number, number, number] = [
            tgtCenter[0] +
              dx * tgtRight[0] +
              dy * tgtUp[0] +
              sliceShift * planeNormal[0],
            tgtCenter[1] +
              dx * tgtRight[1] +
              dy * tgtUp[1] +
              sliceShift * planeNormal[1],
            tgtCenter[2] +
              dx * tgtRight[2] +
              dy * tgtUp[2] +
              sliceShift * planeNormal[2],
          ];
          return w;
        };

        canvasPoints.forEach(({ key, index, dx, dy }) => {
          const worldPt = toWorld(dx, dy);
          if (key === 'points' && index !== undefined) {
            if (!remappedData.points) remappedData.points = [];
            remappedData.points[index] = worldPt;
          } else {
            remappedData[key] = worldPt;
          }
        });

        const newId = store.addTool({
          ...remappedData,
          imageID,
          slice: slice.value,
          frameOfReference: frameOfReference.value,
          placing: false,
        }) as ToolID;
        selectionStore.addSelection(newId, type);
      });
    });

    const enableTempCrosshairs = useActionHeld('temporaryCrosshairs');

    watch(enableTempCrosshairs, (enable) => {
      if (enable) toolStore.activateTemporaryCrosshairs();
      else toolStore.deactivateTemporaryCrosshairs();
    });

    // Rename the computed property to map tool names to their keyboard shortcuts
    const nameToShortcut = computed(() => {
      const keyMap = actionToKey.value;
      return {
        'Window & Level': readableBinding(keyMap.windowLevel),
        Pan: readableBinding(keyMap.pan),
        Zoom: readableBinding(keyMap.zoom),
        Crosshairs: readableBinding(keyMap.crosshairs),
        Select: readableBinding(keyMap.select),
        Paint: readableBinding(keyMap.paint),
        Rectangle: readableBinding(keyMap.rectangle),
        Circle: readableBinding(keyMap.circle),
        Polygon: readableBinding(keyMap.polygon),
        Ruler: readableBinding(keyMap.ruler),
        Crop: readableBinding(keyMap.crop),
      };
    });

    onMounted(() => {
      if (props.defaultTool) {
        const tool = props.defaultTool as Tools;
        if (tool in Tools) {
          setTimeout(() => {
            toolStore.setCurrentTool(tool);
          }, 100);
        }
      }
    });

    const display = useDisplay();

    return {
      isMobile: display.mobile,

      currentTool,
      currentToolIsMeasurement: computed(() =>
        [Tools.Ruler, Tools.Rectangle, Tools.Circle, Tools.Polygon].includes(
          currentTool.value
        )
      ),
      setCurrentTool: toolStore.setCurrentTool,
      noCurrentImage,
      windowingUnavailableReason,
      isObliqueLayout,
      isDisallowedOnCine,
      paintUnavailableReason,
      Tools,
      nameToShortcut,
    };
  },
});
</script>

<style>
.tool-btn-selected {
  background-color: rgb(var(--v-theme-primary-darken-1));
  color: rgb(var(--v-theme-on-primary-darken-1));
}

.v-list-item--variant-text:not(.tool-list-item-selected) .v-list-item__overlay {
  background-color: rgb(var(--v-theme-selection-bg-color), 0.3);
}
.v-list-item--variant-text.tool-list-item-selected .v-list-item__overlay {
  background-color: rgb(var(--v-theme-selection-bg-color));
  opacity: 0.7;
  z-index: 0;
}
.v-list-item--variant-text.tool-list-item-selected:hover .v-list-item__overlay {
  opacity: 1;
}
.v-list-item--variant-text.tool-list-item-selected .v-list-item__overlay ~ * {
  z-index: 1;
}
</style>

<style scoped>
.tool-separator {
  width: 75%;
  height: 1px;
  border: none;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.3);
}
</style>
