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
      <menu-control-button
        icon="mdi-circle-half-full"
        :name="'Window & Level' + '' || ` [${nameToShortcut['Window & Level']}]`"
        :active="active"
        :disabled="noCurrentImage"
        @click="toggle"
      >
        <window-level-controls />
      </menu-control-button>
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
        :disabled="noCurrentImage || isObliqueLayout"
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
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      ></control-button>
    </groupable-item>
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.Rectangle"
    >
      <menu-control-button
        icon="mdi-vector-square"
        :name="'Rectangle' + '' || ` [${nameToShortcut['Rectangle']}]`"
        :mobileOnlyMenu="true"
        :active="active"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      >
        <rectangle-controls />
      </menu-control-button>
    </groupable-item>
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.Circle"
    >
      <menu-control-button
        icon="mdi-circle-outline"
        :name="'Circle' + '' || ` [${nameToShortcut['Circle']}]`"
        :mobileOnlyMenu="true"
        :active="active"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      >
        <circle-controls />
      </menu-control-button>
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Polygon">
      <menu-control-button
        icon="mdi-pentagon-outline"
        :name="'Polygon' + '' || ` [${nameToShortcut['Polygon']}]`"
        :mobileOnlyMenu="true"
        :active="active"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      >
        <polygon-controls />
      </menu-control-button>
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Ruler">
      <menu-control-button
        icon="mdi-ruler"
        :name="'Ruler' + '' || ` [${nameToShortcut['Ruler']}]`"
        :mobileOnlyMenu="true"
        :active="active"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      >
        <ruler-controls />
      </menu-control-button>
    </groupable-item>

    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Crop">
      <menu-control-button
        icon="mdi-crop"
        :name="'Crop' + '' || ` [${nameToShortcut['Crop']}]`"
        :active="active"
        :disabled="noCurrentImage || isObliqueLayout"
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
// import { storeToRefs } from 'pinia';
import { onKeyDown, useMagicKeys } from '@vueuse/core';
import { Tools } from '@/src/store/tools/types';
import ControlButton from '@/src/components/ControlButton.vue';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import { useToolStore } from '@/src/store/tools';
import MenuControlButton from '@/src/components/MenuControlButton.vue';
import CropControls from '@/src/components/tools/crop/CropControls.vue';
import ResetViews from '@/src/components/tools/ResetViews.vue';
import RulerControls from '@/src/components/RulerControls.vue';
import RectangleControls from '@/src/components/RectangleControls.vue';
import CircleControls from '@/src/components/CircleControls.vue';
import PolygonControls from '@/src/components/PolygonControls.vue';
import WindowLevelControls from '@/src/components/tools/windowing/WindowLevelControls.vue';
import { actionToKey } from '@/src/composables/useKeyboardShortcuts';
import { useCurrentImage, getImageMetadata } from '@/src/composables/useCurrentImage';
import { useViewStore } from '@/src/store/views';
import { getHoveredAnnotation } from '@/src/composables/annotationTool';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { useAnnotationToolStore, AnnotationToolStoreMap } from '@/src/store/tools';
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
    RulerControls,
    RectangleControls,
    CircleControls,
    PolygonControls,
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

    const { currentImageID, currentImageMetadata } = useCurrentImage();
    const noCurrentImage = computed(() => !currentImageID.value);
    const currentTool = computed(() => toolStore.currentTool);
    const isObliqueLayout = computed(() => {
      if (!viewStore.activeView) return false;
      const view = viewStore.viewByID[viewStore.activeView];
      return view.type === 'Oblique';
    });

    const paintMenu = ref(false);
    const cropMenu = ref(false);
    const windowingMenu = ref(false);

    onKeyDown('Escape', () => {
      paintMenu.value = false;
      cropMenu.value = false;
      windowingMenu.value = false;
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
      (Object.entries(AnnotationToolStoreMap) as [AnnotationToolType, () => any][]).forEach(
        ([type, useStore]) => {
          const store = useStore();
          store.finishedTools
            .filter((tool: any) => tool.imageID === imageID)
            .forEach((tool: any) => selectionStore.addSelection(tool.id, type));
        }
      );
    });

    // Copy selected annotations (Ctrl+C / Cmd+C)
    onKeyDown('c', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const selectionStore = useToolSelectionStore();
      if (selectionStore.selection.length === 0) return;
      e.preventDefault();
      annotationClipboard = selectionStore.selection.map(({ id, type }) => {
        const store = useAnnotationToolStore(type);
        const tool = store.toolByID[id] as any;
        if (!tool) return null;
        const { id: _id, placing: _placing, ...data } = JSON.parse(JSON.stringify(tool)); // eslint-disable-line @typescript-eslint/no-unused-vars

        // Determine source view orientation from the tool's frameOfReference
        const srcMeta = getImageMetadata(data.imageID);
        const srcAxisInfo = frameOfReferenceToImageSliceAndAxis(
          data.frameOfReference, srcMeta,
          { allowOutOfBoundsSlice: true, allowNonIntegralSlice: true }
        );
        if (!srcAxisInfo) return null;

        // Get camera right/up vectors to decompose world offset from image center
        const { right: srcRight, up: srcUp } = getCameraVectors(srcAxisInfo.axis, srcMeta.lpsOrientation);
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
          canvasPoints.push({ key: 'firstPoint', ...toCanvas(data.firstPoint) });
        }
        if (data.secondPoint) {
          canvasPoints.push({ key: 'secondPoint', ...toCanvas(data.secondPoint) });
        }
        if (data.points) {
          data.points.forEach((pt: number[], i: number) => {
            canvasPoints.push({ key: 'points', index: i, ...toCanvas(pt) });
          });
        }

        return { type, data, canvasPoints } as CopiedAnnotation;
      }).filter((item): item is CopiedAnnotation => item !== null);
    });

    // Paste annotations (Ctrl+V / Cmd+V)
    onKeyDown('v', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (annotationClipboard.length === 0) return;
      e.preventDefault();

      const imageID = currentImageID.value;
      if (!imageID) return;

      // Get current slice/frameOfReference from the active view
      const activeViewId = viewStore.activeView;
      if (!activeViewId) return;
      const activeView = viewStore.getView(activeViewId);
      if (!activeView || activeView.type !== '2D') return;

      const { orientation } = activeView.options;
      const { viewDirection } = get2DViewingVectors(orientation);
      const { slice } = useSliceConfig(activeViewId, imageID);
      const frameOfReference = useFrameOfReference(
        viewDirection,
        slice,
        currentImageMetadata
      );

      // Target camera vectors and image center
      const tgtMeta = currentImageMetadata.value;
      const { right: tgtRight, up: tgtUp } = getCameraVectors(orientation, tgtMeta.lpsOrientation);
      const tgtCenter = vtkBoundingBox.getCenter(tgtMeta.worldBounds);

      // Compute slice offset: shift from image center's slice to the target slice
      const planeNormal = frameOfReference.value.planeNormal;
      const planeOrigin = frameOfReference.value.planeOrigin;
      const sliceShift = vec3.dot(
        [planeOrigin[0] - tgtCenter[0], planeOrigin[1] - tgtCenter[1], planeOrigin[2] - tgtCenter[2]],
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
            tgtCenter[0] + dx * tgtRight[0] + dy * tgtUp[0] + sliceShift * planeNormal[0],
            tgtCenter[1] + dx * tgtRight[1] + dy * tgtUp[1] + sliceShift * planeNormal[1],
            tgtCenter[2] + dx * tgtRight[2] + dy * tgtUp[2] + sliceShift * planeNormal[2],
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

    const keys = useMagicKeys();
    const enableTempCrosshairs = computed(
      () => keys[actionToKey.value.temporaryCrosshairs].value
    );
    watch(enableTempCrosshairs, (enable) => {
      if (enable) toolStore.activateTemporaryCrosshairs();
      else toolStore.deactivateTemporaryCrosshairs();
    });

    // Rename the computed property to map tool names to their keyboard shortcuts
    const nameToShortcut = computed(() => {
      const keyMap = actionToKey.value;
      return {
        'Window & Level': keyMap.windowLevel,
        Pan: keyMap.pan,
        Zoom: keyMap.zoom,
        Crosshairs: keyMap.crosshairs,
        Select: keyMap.select,
        Paint: keyMap.paint,
        Rectangle: keyMap.rectangle,
        Circle: keyMap.circle,
        Polygon: keyMap.polygon,
        Ruler: keyMap.ruler,
        Crop: keyMap.crop,
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

    return {
      currentTool,
      setCurrentTool: toolStore.setCurrentTool,
      noCurrentImage,
      isObliqueLayout,
      Tools,
      paintMenu,
      cropMenu,
      windowingMenu,
      nameToShortcut,
    };
  },
});
</script>

<style>
.tool-btn-selected {
  background-color: rgb(var(--v-theme-selection-bg-color));
}
</style>

<style scoped>
.menu-more {
  position: absolute;
  right: -10%;
}

.tool-separator {
  width: 75%;
  height: 1px;
  border: none;
  border-top: 1px solid rgb(112, 112, 112);
}

.popup-menu {
  max-width: 400px; /* a little less than v-navigation-drawer in App.vue */
}
</style>
