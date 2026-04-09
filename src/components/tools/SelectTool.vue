<script setup lang="ts">
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { WIDGET_PRIORITY } from '@kitware/vtk.js/Widgets/Core/AbstractWidget/Constants';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { useToolStore, useAnnotationToolStore } from '@/src/store/tools';
import { Tools, AnnotationToolType } from '@/src/store/tools/types';
import { vtkAnnotationToolWidget } from '@/src/vtk/ToolWidgetUtils/types';
import { inject, toRefs, computed } from 'vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import { ToolID } from '@/src/types/annotation-tool';
import { useViewStore } from '@/src/store/views';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { doesToolFrameMatchViewAxis } from '@/src/composables/annotationTool';
import { useSliceInfo } from '@/src/composables/useSliceInfo';
import type { LPSAxis } from '@/src/types/lps';

const props = defineProps<{
  viewId: string;
  imageId?: string | null;
}>();

const { viewId, imageId } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const selectionStore = useToolSelectionStore();
const toolStore = useToolStore();
const viewStore = useViewStore();
const { currentImageMetadata } = useCurrentImage();

const viewAxis = computed(() => {
  const v = viewStore.getView(viewId.value);
  return v?.type === '2D' ? (v.options as { orientation: LPSAxis }).orientation : null;
});
const sliceInfo = useSliceInfo(viewId, imageId);
const currentSlice = computed(() => sliceInfo.value?.slice);

const PLACING_TOOLS = [Tools.Ruler, Tools.Rectangle, Tools.Circle, Tools.Polygon];

const isToolPlacing = (id: ToolID, type: AnnotationToolType) => {
  try {
    const store = useAnnotationToolStore(type);
    return store.toolByID[id]?.placing ?? false;
  } catch {
    return false;
  }
};

const isToolVisibleInView = (id: ToolID, type: AnnotationToolType) => {
  try {
    const store = useAnnotationToolStore(type);
    const tool = store.toolByID[id];
    if (!tool) return false;
    if (viewAxis.value && !doesToolFrameMatchViewAxis(viewAxis.value, tool, currentImageMetadata)) return false;
    if (currentSlice.value != null && tool.slice !== currentSlice.value) return false;
    return true;
  } catch {
    return false;
  }
};

// When the GPU picker returns a tool not visible on the current slice,
// find a visible tool of the same type at this slice (same canvas position).
const findVisibleToolAtSamePosition = (pickedId: ToolID, type: AnnotationToolType): ToolID | null => {
  try {
    const store = useAnnotationToolStore(type);
    const pickedTool = store.toolByID[pickedId] as any;
    if (!pickedTool) return null;
    const tools = store.tools as any[];
    for (const t of tools) {
      if (t.id === pickedId) continue;
      if (t.placing || t.hidden) continue;
      if (!isToolVisibleInView(t.id, type)) continue;
      // Same type, visible on this slice — must be the one under the cursor
      return t.id as ToolID;
    }
    return null;
  } catch {
    return null;
  }
};

onVTKEvent(
  view.interactor,
  'onLeftButtonPress',
  (event: any) => {
    const isPlacing = PLACING_TOOLS.includes(toolStore.currentTool);
    const withModifiers = !!(event.shiftKey || event.controlKey);
    const selectedData = view.widgetManager.getSelectedData();
    let handled = false;
    if ('widget' in selectedData) {
      const widget = selectedData.widget as vtkAnnotationToolWidget;
      const widgetState = widget.getWidgetState();
      let id = widgetState.getId() as ToolID;
      const type = widgetState.getToolType();
      // Don't select the tool currently being placed
      if (isToolPlacing(id, type)) return;
      // If picked tool is not visible in this view, find the visible one
      if (!isToolVisibleInView(id, type)) {
        const visibleId = findVisibleToolAtSamePosition(id, type);
        if (visibleId) {
          id = visibleId;
        }
      }
      if (isToolVisibleInView(id, type)) {
        handled = true;
        if (withModifiers) {
          selectionStore.toggleSelection(id, type);
        } else {
          selectionStore.clearSelection();
          selectionStore.addSelection(id, type);
        }
      }
    }
    if (!handled && !withModifiers && !isPlacing) {
      selectionStore.clearSelection();
    }
  },
  {
    // capture all events by calling handler before widgets
    priority: WIDGET_PRIORITY + 1,
  }
);

const render = () => {};
</script>

<template>
  <render />
</template>
