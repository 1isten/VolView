<template>
  <g>
    <rect
      :x="rectangle.x"
      :y="rectangle.y"
      :width="rectangle.width"
      :height="rectangle.height"
      :stroke="color"
      :stroke-width="strokeWidth"
      :fill="fillColor"
      :fill-opacity="fillOpacity"
    />
    <circle
      v-if="first"
      :cx="first.x"
      :cy="first.y"
      :stroke="color"
      :stroke-width="strokeWidth"
      fill="transparent"
      :r="ANNOTATION_TOOL_HANDLE_RADIUS"
    />
    <circle
      v-if="second"
      :cx="second.x"
      :cy="second.y"
      :stroke="color"
      :stroke-width="strokeWidth"
      fill="transparent"
      :r="ANNOTATION_TOOL_HANDLE_RADIUS"
    />
    <!-- Measurement overlay -->
    <g v-if="measurements && first && second">
      <rect
        :x="statsBox.x"
        :y="statsBox.y"
        :width="statsBox.width"
        :height="statsBox.height"
        fill="rgba(0,0,0,0.7)"
        rx="3"
        ry="3"
      />
      <text
        v-for="(line, idx) in statsLines"
        :key="idx"
        :x="statsBox.x + 4"
        :y="statsBox.y + 12 + idx * 14"
        fill="white"
        font-size="11px"
        font-family="monospace"
      >
        {{ line }}
      </text>
    </g>
  </g>
</template>

<script lang="ts">
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { ANNOTATION_TOOL_HANDLE_RADIUS } from '@/src/constants';
import { worldToSVG } from '@/src/utils/vtk-helpers';
import type { Vector3 } from '@kitware/vtk.js/types';
import {
  computeRectangleMeasurements,
  type RectangleMeasurements,
} from '@/src/utils/roiStats';
import { useImageCacheStore } from '@/src/store/image-cache';

import {
  PropType,
  computed,
  defineComponent,
  toRefs,
  unref,
  ref,
  watch,
  inject,
} from 'vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { useResizeObserver } from '@vueuse/core';
import type { Maybe } from '@/src/types';

type SVGPoint = {
  x: number;
  y: number;
};

function fmtNum(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  return n.toFixed(decimals);
}

function buildRectStatsLines(m: RectangleMeasurements): string[] {
  return [
    `Mean: ${fmtNum(m.mean)} Median: ${fmtNum(m.median)}`,
    `SDev: ${fmtNum(m.sdev)} Sum: ${fmtNum(m.sum, 0)}`,
    `Max: ${fmtNum(m.max, 0)} Min: ${fmtNum(m.min, 0)}`,
    `P: ${fmtNum(m.perimeter)} mm`,
    `Area: ${fmtNum(m.area)} mm\u00B2`,
    `W: ${fmtNum(m.width)} mm H: ${fmtNum(m.height)} mm`,
  ];
}

export default defineComponent({
  props: {
    point1: Array as PropType<Array<number>>,
    point2: Array as PropType<Array<number>>,
    color: String,
    fillColor: String,
    fillOpacity: Number,
    strokeWidth: Number,
    imageId: {
      type: String as PropType<Maybe<string>>,
      default: undefined,
    },
  },
  setup(props) {
    const { point1, point2, imageId } = toRefs(props);
    const firstPoint = ref<SVGPoint | null>();
    const secondPoint = ref<SVGPoint | null>();

    const view = inject(VtkViewContext);
    if (!view) throw new Error('No VtkView');

    const imageCacheStore = useImageCacheStore();

    const updatePoints = () => {
      const viewRenderer = view.renderer;
      const pt1 = unref(point1) as Vector3 | undefined;
      const pt2 = unref(point2) as Vector3 | undefined;
      if (pt1) {
        const point2D = worldToSVG(pt1, viewRenderer);
        if (point2D) {
          firstPoint.value = {
            x: point2D[0],
            y: point2D[1],
          };
        }
      } else {
        firstPoint.value = null;
      }

      if (pt2) {
        const point2D = worldToSVG(pt2, viewRenderer);
        if (point2D) {
          secondPoint.value = {
            x: point2D[0],
            y: point2D[1],
          };
        }
      } else {
        secondPoint.value = null;
      }
    };

    const rectangle = computed(() => {
      const [firstX, firstY] = [
        firstPoint.value?.x ?? 0,
        firstPoint.value?.y ?? 0,
      ];
      const [secondX, secondY] = [
        secondPoint.value?.x ?? firstX,
        secondPoint.value?.y ?? firstY,
      ];
      return {
        x: Math.min(firstX, secondX),
        y: Math.min(firstY, secondY),
        width: Math.abs(firstX - secondX),
        height: Math.abs(firstY - secondY),
      };
    });

    // --- measurements --- //

    const measurements = computed<RectangleMeasurements | null>(() => {
      const p1 = unref(point1) as Vector3 | undefined;
      const p2 = unref(point2) as Vector3 | undefined;
      if (!p1 || !p2) return null;
      const image = imageCacheStore.getVtkImageData(imageId.value);
      return computeRectangleMeasurements(image, p1, p2);
    });

    const statsLines = computed(() => {
      if (!measurements.value) return [];
      return buildRectStatsLines(measurements.value);
    });

    const statsBox = computed(() => {
      const rect = rectangle.value;
      const x = rect.x + rect.width + 6;
      const y = rect.y;
      const lineCount = statsLines.value.length;
      return {
        x,
        y,
        width: 220,
        height: lineCount * 14 + 6,
      };
    });

    const camera = vtkFieldRef(view.renderer, 'activeCamera');
    onVTKEvent(camera, 'onModified', updatePoints);

    watch([point1, point2], updatePoints, {
      deep: true,
      immediate: true,
    });

    // --- resize --- //

    const container = vtkFieldRef(view.renderWindowView, 'container');
    useResizeObserver(container, () => {
      updatePoints();
    });

    return {
      first: firstPoint,
      second: secondPoint,
      rectangle,
      measurements,
      statsLines,
      statsBox,
      ANNOTATION_TOOL_HANDLE_RADIUS,
    };
  },
});
</script>
