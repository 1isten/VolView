import { computed } from 'vue';
import { watchDebounced } from '@vueuse/core';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useSliceInfo } from '@/src/composables/useSliceInfo';
import { useMaskRevision } from '@/src/segmentation/composables/useMaskRevision';
import { listMasks, maskScalars } from '@/src/segmentation/model';
import type { LabelmapBinding } from '@/src/segmentation/model';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useViewStore } from '@/src/store/views';
import type { RGBAColor } from '@kitware/vtk.js/types';

type Emitter = {
  emit: (type: string, payload?: unknown) => void;
};

type SegmentationRecord = ReturnType<
  ReturnType<typeof useSegmentationStore>['getSegmentationForImage']
>;

type SegmentTarget = {
  dataID: string;
  segmentId: string;
  segmentation: NonNullable<SegmentationRecord>;
  binding: LabelmapBinding;
};

type SliceContext = {
  slice: number;
  axisIndex: number;
  xAxis: number;
  yAxis: number;
  width: number;
  height: number;
  dimensions: number[];
  values: ArrayLike<number>;
  components: number;
  component: number;
};

function toByteColor(color?: RGBAColor | null): number[] {
  const channels = color ?? [1, 0, 0, 1];
  return [0, 1, 2, 3].map((index) =>
    Math.round(Math.max(0, Math.min(1, channels[index] ?? 1)) * 255)
  );
}

function inExtent(ijk: number[], extent: number[]) {
  return (
    ijk[0] >= extent[0] &&
    ijk[0] <= extent[1] &&
    ijk[1] >= extent[2] &&
    ijk[1] <= extent[3] &&
    ijk[2] >= extent[4] &&
    ijk[2] <= extent[5]
  );
}

function maskOffset(ijk: number[], extent: number[], dims: number[]) {
  return (
    ijk[0] -
    extent[0] +
    (ijk[1] - extent[2]) * dims[0] +
    (ijk[2] - extent[4]) * dims[0] * dims[1]
  );
}

function imageOffset(context: SliceContext, ijk: number[]) {
  const { dimensions, components, component } = context;
  return (
    ((ijk[2] * dimensions[1] + ijk[1]) * dimensions[0] + ijk[0]) * components +
    component
  );
}

function statsFor(values: number[]) {
  const count = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((acc, value) => acc + value, 0) / count;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const value of values) {
    const d = value - mean;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= count;
  m3 /= count;
  m4 /= count;
  const std = Math.sqrt(m2);
  const skewness = m2 > 0 ? m3 / Math.pow(m2, 1.5) : null;
  const kurtosis = m2 > 0 ? m4 / (m2 * m2) - 3 : null;
  const median =
    count % 2 === 1
      ? sorted[(count - 1) / 2]
      : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;
  return {
    count,
    min: sorted[0],
    max: sorted[count - 1],
    median,
    mean,
    std,
    skewness,
    kurtosis,
  };
}

function similarityLabel(skewness: number, kurtosis: number) {
  if (skewness <= 0.5 && kurtosis <= 0.5) return 'Excellent';
  if (skewness <= 1 && kurtosis <= 1) return 'Good';
  if (skewness <= 1.5 && kurtosis <= 1.5) return 'Fair';
  return 'Poor';
}

function similarityFor(skewness: number | null, kurtosis: number | null) {
  if (skewness === null || kurtosis === null) return 'N/A';
  if (!Number.isFinite(skewness) || !Number.isFinite(kurtosis)) {
    return 'N/A';
  }
  return similarityLabel(Math.abs(skewness), Math.abs(kurtosis));
}

function collectValues(context: SliceContext, target: SegmentTarget) {
  const { extent } = target.binding;
  const dims = [
    extent[1] - extent[0] + 1,
    extent[3] - extent[2] + 1,
    extent[5] - extent[4] + 1,
  ];
  if (dims.some((dim) => dim <= 0)) return [];
  if (
    context.slice < extent[context.axisIndex * 2] ||
    context.slice > extent[context.axisIndex * 2 + 1]
  ) {
    return [];
  }

  const scalars = maskScalars(target.binding.image);
  const values: number[] = [];
  const ijk = [0, 0, 0];
  for (let y = 0; y < context.height; y += 1) {
    for (let x = 0; x < context.width; x += 1) {
      ijk[context.axisIndex] = context.slice;
      ijk[context.xAxis] = x;
      ijk[context.yAxis] = y;
      if (!inExtent(ijk, extent)) continue;
      if (!scalars[maskOffset(ijk, extent, dims)]) continue;
      const value = Number(context.values[imageOffset(context, ijk)]);
      if (Number.isFinite(value) && value !== 0) values.push(value);
    }
  }
  return values;
}

/**
 * PMT-ONLY: emits the histogram payload for the active segment after its mask
 * changes. The host renders it; VolView itself draws no chart.
 */
export function useSegmentationHistogram(emitter?: Emitter | null) {
  const segmentationStore = useSegmentationStore();
  const registry = useSegmentStore().segments;
  const viewStore = useViewStore();
  const { currentImageID, currentImageData } = useCurrentImage();
  const sliceInfo = useSliceInfo(
    computed(() => viewStore.activeView ?? ''),
    currentImageID
  );
  const revision = useMaskRevision(() => currentImageID.value);

  const sliceContext = computed<SliceContext | null>(() => {
    const image = currentImageData.value;
    const info = sliceInfo.value;
    if (!image || !info) return null;
    const scalars = image.getPointData().getScalars();
    const dimensions = image.getDimensions();
    const values = scalars?.getData();
    if (!scalars || !values?.length || dimensions.some((dim) => dim <= 0)) {
      return null;
    }
    const axisIndex = info.axisIndex;
    const xAxis = (axisIndex + 1) % 3;
    const yAxis = (axisIndex + 2) % 3;
    return {
      slice: info.slice,
      axisIndex,
      xAxis,
      yAxis,
      width: dimensions[xAxis],
      height: dimensions[yAxis],
      dimensions,
      values,
      components: scalars.getNumberOfComponents(),
      component: 0,
    };
  });

  function resolveTarget(): SegmentTarget | null {
    const dataID = currentImageID.value;
    if (!dataID) return null;
    const segmentId = registry.selectedSegmentId.value;
    if (!segmentId) return null;
    const segmentation = segmentationStore.getSegmentationForImage(dataID);
    if (!segmentation) return null;
    const binding = segmentationStore.maskFor(dataID, segmentId)
      ?.representations.labelmap;
    if (!binding) return null;
    return { dataID, segmentId, segmentation, binding };
  }

  function segmentInfo(segmentId: string) {
    const segment = registry.getSegment(segmentId);
    return {
      name: segment?.name ?? '',
      color: toByteColor(segment?.color),
    };
  }

  function viewInfo(viewID: string) {
    const view = viewID ? viewStore.getView(viewID) : null;
    return {
      name: view?.name ?? '',
      orientation:
        (view?.options as { orientation?: string } | undefined)?.orientation ??
        null,
    };
  }

  function segmentValue(
    segmentation: NonNullable<SegmentationRecord>,
    segmentId: string
  ) {
    return (
      listMasks(segmentation).findIndex(
        (mask) => mask.segmentId === segmentId
      ) + 1
    );
  }

  function buildPayload() {
    const target = resolveTarget();
    const context = sliceContext.value;
    if (!target || !context) return null;
    const values = collectValues(context, target);
    if (values.length === 0) return null;

    const stats = statsFor(values);
    const viewID = viewStore.activeView ?? '';
    const segment = segmentInfo(target.segmentId);
    const view = viewInfo(viewID);

    return {
      type: 'segmentationhistogram',
      version: 1,
      createdAt: Date.now(),
      imageId: target.dataID,
      viewId: viewID,
      viewName: view.name,
      orientation: view.orientation,
      axis: context.axisIndex,
      slice: context.slice,
      source: 'current-slice',
      segmentId: target.segmentId,
      segmentValue: segmentValue(target.segmentation, target.segmentId),
      segmentName: segment.name,
      segmentColor: segment.color,
      count: stats.count,
      data: values,
      min: stats.min,
      max: stats.max,
      median: stats.median,
      mean: stats.mean,
      std: stats.std,
      skewness: stats.skewness,
      kurtosis: stats.kurtosis,
      similarity: similarityFor(stats.skewness, stats.kurtosis),
    };
  }

  function emitHistogram() {
    const payload = buildPayload();
    if (!payload) return;
    if (window.parent === window || !emitter) {
      console.log(
        `[segmentationhistogram] segment=${payload.segmentValue} slice=${payload.slice} count=${payload.count} mean=${payload.mean.toFixed(3)}`
      );
      console.log('[segmentationhistogram] payload', payload);
      return;
    }
    emitter.emit('segmentationhistogram', payload);
  }

  watchDebounced(
    [revision, registry.selectedSegmentId],
    () => emitHistogram(),
    { debounce: 300 }
  );
}
