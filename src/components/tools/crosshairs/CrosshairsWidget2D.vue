<script lang="ts">
import {
  defineComponent,
  PropType,
  ref,
  toRefs,
  watch,
  watchEffect,
  computed,
  inject,
  onUnmounted,
  onMounted,
} from 'vue';
import { useResizeObserver } from '@vueuse/core';
import type { Vector3 } from '@kitware/vtk.js/types';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { LPSAxisDir } from '@/src/types/lps';
import { useImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { useCrosshairsToolStore } from '@/src/store/tools/crosshairs';
import { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useSliceInfo } from '@/src/composables/useSliceInfo';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { worldToSVG } from '@/src/utils/vtk-helpers';

export default defineComponent({
  name: 'CrosshairsWidget2D',
  props: {
    viewId: {
      type: String,
      required: true,
    },
    viewDirection: {
      type: String as PropType<LPSAxisDir>,
      required: true,
    },
    imageId: String as PropType<Maybe<string>>,
  },
  setup(props) {
    const { viewDirection, imageId, viewId } = toRefs(props);

    const view = inject(VtkViewContext);
    if (!view) throw new Error('No VtkView');

    const sliceInfo = useSliceInfo(viewId, imageId);
    const slice = computed(() => {
      return sliceInfo.value?.slice;
    });

    const crosshairsStore = useCrosshairsToolStore();
    const factory = crosshairsStore.getWidgetFactory();
    const widget = view.widgetManager.addWidget(factory)!;

    onUnmounted(() => {
      view.widgetManager.removeWidget(factory);
    });

    // --- interaction --- //

    // Only the widget the drag happened in fires this, which is what tells the
    // store which image the picked point belongs to.
    const handle = factory.getWidgetState().getHandle();
    onVTKEvent(widget, 'onInteractionEvent', () => {
      const origin = handle.getOrigin();
      if (origin) crosshairsStore.setPosition(origin, viewId.value);
    });

    // --- manipulator --- //

    const manipulator = vtkPlaneManipulator.newInstance();
    widget.setManipulator(manipulator);
    onUnmounted(() => manipulator.delete());

    const { metadata: imageMetadata } = useImage(imageId);
    watchEffect(() => {
      if (slice.value == null) return;
      updatePlaneManipulatorFor2DView(
        manipulator,
        viewDirection.value,
        slice.value,
        imageMetadata.value
      );
    });

    // --- visibility --- //

    widget.setVisibility(true);

    // --- crosshair overlay --- //
    // The crosshairs tool has no vtk representations of its own: reference
    // lines are what other views draw. A PMTaro standalone/single-view window
    // has no peer view, so draw the crosshair in this view too.
    const handleOrigin = ref<Vector3 | null>(
      (handle.getOrigin() as Vector3 | null) ?? null
    );
    const screenPoint = ref<{ x: number; y: number } | null>(null);

    const camera = vtkFieldRef(view.renderer, 'activeCamera');
    const updatePoint = () => {
      const origin = handleOrigin.value;
      if (!origin) {
        screenPoint.value = null;
        return;
      }
      const point = worldToSVG(origin, view.renderer);
      screenPoint.value = point ? { x: point[0], y: point[1] } : null;
    };

    onVTKEvent(handle, 'onModified', () => {
      handleOrigin.value = (handle.getOrigin() as Vector3 | null) ?? null;
      updatePoint();
    });
    onVTKEvent(camera, 'onModified', updatePoint);
    watch(handleOrigin, updatePoint);

    const container = view.renderWindowView.getContainer();
    useResizeObserver(container, updatePoint);

    // --- focus and rendering --- //

    onMounted(() => {
      // Start at the image center when the crosshair has never been placed.
      if (!handle.getOrigin() && imageMetadata.value) {
        const bounds = imageMetadata.value.worldBounds;
        handle.setOrigin([
          (bounds[0] + bounds[1]) / 2,
          (bounds[2] + bounds[3]) / 2,
          (bounds[4] + bounds[5]) / 2,
        ]);
      }
      handleOrigin.value = (handle.getOrigin() as Vector3 | null) ?? null;
      updatePoint();
      view.widgetManager.renderWidgets();
    });

    return { screenPoint };
  },
});
</script>

<template>
  <svg class="overlay-no-events crosshair-overlay" width="100%" height="100%">
    <template v-if="screenPoint">
      <line
        :x1="screenPoint.x"
        y1="0"
        :x2="screenPoint.x"
        y2="100%"
        stroke="#ffff00"
        stroke-width="1"
      />
      <line
        x1="0"
        :y1="screenPoint.y"
        x2="100%"
        :y2="screenPoint.y"
        stroke="#ffff00"
        stroke-width="1"
      />
    </template>
  </svg>
</template>

<style scoped>
.crosshair-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
