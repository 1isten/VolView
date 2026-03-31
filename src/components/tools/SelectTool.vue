<script setup lang="ts">
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { WIDGET_PRIORITY } from '@kitware/vtk.js/Widgets/Core/AbstractWidget/Constants';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { useToolStore, useAnnotationToolStore } from '@/src/store/tools';
import { Tools, AnnotationToolType } from '@/src/store/tools/types';
import { vtkAnnotationToolWidget } from '@/src/vtk/ToolWidgetUtils/types';
import { inject } from 'vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import { ToolID } from '@/src/types/annotation-tool';

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const selectionStore = useToolSelectionStore();
const toolStore = useToolStore();

const PLACING_TOOLS = [Tools.Ruler, Tools.Rectangle, Tools.Circle, Tools.Polygon];

const isToolPlacing = (id: ToolID, type: AnnotationToolType) => {
  try {
    const store = useAnnotationToolStore(type);
    return store.toolByID[id]?.placing ?? false;
  } catch {
    return false;
  }
};

onVTKEvent(
  view.interactor,
  'onLeftButtonPress',
  (event: any) => {
    const isPlacing = PLACING_TOOLS.includes(toolStore.currentTool);
    const withModifiers = !!(event.shiftKey || event.controlKey);
    const selectedData = view.widgetManager.getSelectedData();
    if ('widget' in selectedData) {
      const widget = selectedData.widget as vtkAnnotationToolWidget;
      const widgetState = widget.getWidgetState();
      const id = widgetState.getId();
      const type = widgetState.getToolType();
      // Don't select the tool currently being placed
      if (isToolPlacing(id, type)) return;
      if (withModifiers) {
        selectionStore.toggleSelection(id, type);
      } else {
        selectionStore.clearSelection();
        selectionStore.addSelection(id, type);
      }
    } else if (!withModifiers && !isPlacing) {
      // if no modifiers and not placing, then deselect
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
