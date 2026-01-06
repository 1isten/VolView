<script setup lang="ts">
import { toRefs, computed, watch } from 'vue';
import { watchDebounced } from '@vueuse/core';
import { Maybe } from '@/src/types';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useImageCacheStore } from '@/src/store/image-cache';
import { getROIStats } from '@/src/utils/roi';

type SliceRepresentationType = ReturnType<typeof useSliceRepresentation>;

const props = defineProps<{
  viewId: string;
  imageId: Maybe<string>;
  baseRep: SliceRepresentationType;
  layerReps: SliceRepresentationType[];
  segmentGroupsReps: SliceRepresentationType[];
  slicingMode?: string;
  slice: number;
  hover: boolean;
}>();

const { viewId: viewID, imageId: imageID, slicingMode, slice, hover } = toRefs(props);

const paintStore = usePaintToolStore();
const segmentGroupID = computed(() => paintStore.activeSegmentGroupID);

const segmentGroupStore = useSegmentGroupStore();
const segmentGroupData = computed(() => segmentGroupID.value ? segmentGroupStore.dataIndex[segmentGroupID.value] : null);

const imageCacheStore = useImageCacheStore();
const parentImageID = computed(() => segmentGroupID.value && segmentGroupStore.metadataByID[segmentGroupID.value]?.parentImage || imageID.value || null);
const parentImageMetaData = computed(() => parentImageID.value && imageCacheStore.getImageMetadata(parentImageID.value) || null);
const parentImageData = computed(() => parentImageID.value && imageCacheStore.getVtkImageData(parentImageID.value) || null);

const newPointsCount = computed(() => paintStore.strokePoints.length);
watchDebounced(newPointsCount, points => {
  // eslint-disable-next-line no-use-before-define
  return points ? handlePaint() : removePaint();
}, {
  debounce: 500,
  immediate: true,
});

function handlePaint() {
  // if (!hover.value) return;
  if (!parentImageData.value || !segmentGroupData.value) {
    return;
  }
  const roiHistogramEl = document.getElementById('roi-histogram');
  if (roiHistogramEl && 'createHistogramWithNormalFit' in roiHistogramEl && typeof roiHistogramEl.createHistogramWithNormalFit === 'function') {
    const stats = getROIStats(segmentGroupData.value, parentImageData.value, parentImageMetaData.value, viewID.value, slicingMode?.value, slice.value);
    roiHistogramEl.createHistogramWithNormalFit(stats);
  }
}

function removePaint() {
  const roiHistogramEl = document.getElementById('roi-histogram');
  if (roiHistogramEl && 'deleteHistogram' in roiHistogramEl && typeof roiHistogramEl.deleteHistogram === 'function') {
    roiHistogramEl.deleteHistogram();
  }
}

watch(hover, hovered => {
  if (hovered) {
    //
  } else {
    // removePaint();
  }
});
</script>

<template><slot></slot></template>
