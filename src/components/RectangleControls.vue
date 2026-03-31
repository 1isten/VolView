<script setup lang="ts">
import { useRectangleStore } from '@/src/store/tools/rectangles';
import LabelControls from '@/src/components/LabelControls.vue';
import FillColorControls from '@/src/components/FillColorControls.vue';

const activeToolStore = useRectangleStore();
</script>

<template>
  <label-controls :labels-store="activeToolStore" />
  <fill-color-controls :store="activeToolStore" />
</template>
