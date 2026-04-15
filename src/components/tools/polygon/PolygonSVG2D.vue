<template>
  <g>
    <circle
      v-for="({ point: [x, y], radius }, index) in handlePoints"
      :key="index"
      :cx="x"
      :cy="y"
      :stroke="color"
      :stroke-width="strokeWidth"
      fill="transparent"
      :r="radius"
      :visibility="index === 0 ? firstHandleVisibility : handleVisibility"
    />
    <polygon
      :points="linePoints"
      stroke="none"
      :fill="fillColor"
      :fill-opacity="fillOpacity"
    />
    <polyline
      :points="linePoints"
      :stroke="color"
      :stroke-width="strokeWidth"
      fill="none"
    />
    <!-- Measurement overlay -->
    <g v-if="measurements && handlePoints.length >= 3 && !placing">
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
import type { Vector2, Vector3 } from '@kitware/vtk.js/types';
import {
  computePolygonMeasurements,
  type PolygonMeasurements,
} from '@/src/utils/roiStats';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  PropType,
  defineComponent,
  toRefs,
  ref,
  watch,
  inject,
  computed,
} from 'vue';
import { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useResizeObserver } from '@vueuse/core';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';

const POINT_RADIUS = ANNOTATION_TOOL_HANDLE_RADIUS;
const FINISHABLE_POINT_RADIUS = POINT_RADIUS;

function fmtNum(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  return n.toFixed(decimals);
}

function buildPolygonStatsLines(m: PolygonMeasurements): string[] {
  return [
    `Mean: ${fmtNum(m.mean)} Median: ${fmtNum(m.median)}`,
    `SDev: ${fmtNum(m.sdev)} Sum: ${fmtNum(m.sum, 0)}`,
    `Max: ${fmtNum(m.max, 0)} Min: ${fmtNum(m.min, 0)}`,
    `P: ${fmtNum(m.perimeter)} mm`,
    `Area: ${fmtNum(m.area)} mm\u00B2`,
  ];
}

export default defineComponent({
  props: {
    points: {
      type: Array as PropType<Array<Vector3>>,
      required: true,
    },
    color: String,
    strokeWidth: Number,
    movePoint: {
      type: Array as unknown as PropType<Maybe<Vector3>>,
    },
    placing: {
      type: Boolean,
      default: false,
    },
    finishable: {
      type: Boolean,
      default: false,
    },
    showHandles: {
      type: Boolean,
      default: false,
    },
    fillColor: {
      type: String,
      default: 'transparent',
    },
    fillOpacity: {
      type: Number,
      default: 0,
    },
    imageId: {
      type: String as PropType<Maybe<string>>,
      default: undefined,
    },
  },
  setup(props) {
    const { points, movePoint, placing, finishable, showHandles, imageId } =
      toRefs(props);

    const view = inject(VtkViewContext);
    if (!view) throw new Error('No VtkView');

    const finishPossible = computed(() => {
      return points.value.length > 0 && placing.value && finishable.value;
    });

    const handleVisibility = computed(() => {
      return showHandles.value ? 'visible' : 'hidden';
    });
    const firstHandleVisibility = computed(() => {
      if (finishPossible.value) {
        return 'visible';
      }
      return handleVisibility.value;
    });

    type SVGPoint = { point: Vector2; radius: number };
    const handlePoints = ref<Array<SVGPoint>>([]);
    const linePoints = ref<string>('');

    const updatePoints = () => {
      const viewRenderer = view.renderer;
      const svgPoints = points.value.map((point) => {
        const point2D = worldToSVG(point, viewRenderer);
        return {
          point: point2D ?? ([0, 0] as Vector2),
          radius: POINT_RADIUS,
        };
      });

      // Indicate finishable
      if (finishPossible.value) {
        svgPoints[0].radius = FINISHABLE_POINT_RADIUS;
      }

      // Show point under mouse if one point placed
      if (svgPoints.length > 0 && placing.value && movePoint.value) {
        const moveHandlePoint =
          worldToSVG(movePoint.value, viewRenderer) ?? ([0, 0] as Vector2);
        svgPoints.push({
          point: moveHandlePoint,
          radius: POINT_RADIUS,
        });
      }

      handlePoints.value = svgPoints;

      const lines = handlePoints.value.map(({ point }) => point?.join(','));
      if (!placing.value) {
        // Close the polygon
        lines.push(lines[0]);
      }
      linePoints.value = lines.join(' ');
    };

    const camera = vtkFieldRef(view.renderer, 'activeCamera');
    onVTKEvent(camera, 'onModified', updatePoints);

    watch([points, movePoint, placing], updatePoints, {
      deep: true,
      immediate: true,
    });

    // --- resize --- //

    const container = vtkFieldRef(view.renderWindowView, 'container');
    useResizeObserver(container, () => {
      updatePoints();
    });

    // --- measurements --- //

    const imageCacheStore = useImageCacheStore();

    const measurements = computed<PolygonMeasurements | null>(() => {
      if (points.value.length < 3 || placing.value) return null;
      const image = imageCacheStore.getVtkImageData(imageId.value);
      return computePolygonMeasurements(image, points.value);
    });

    const statsLines = computed(() => {
      if (!measurements.value) return [];
      return buildPolygonStatsLines(measurements.value);
    });

    const statsBox = computed(() => {
      if (!measurements.value || handlePoints.value.length < 3) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      // Find rightmost point for positioning
      let maxX = -Infinity;
      let maxXY = 0;
      for (const { point } of handlePoints.value) {
        if (point[0] > maxX) {
          maxX = point[0];
          maxXY = point[1];
        }
      }
      const lineCount = statsLines.value.length;
      return {
        x: maxX + 6,
        y: maxXY,
        width: 220,
        height: lineCount * 14 + 6,
      };
    });

    return {
      devicePixelRatio,
      handlePoints,
      linePoints,
      firstHandleVisibility,
      handleVisibility,
      measurements,
      statsLines,
      statsBox,
    };
  },
});
</script>
