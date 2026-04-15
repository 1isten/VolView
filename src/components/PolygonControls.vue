<script setup lang="ts">
import { usePolygonStore } from '@/src/store/tools/polygons';
import LabelControls from '@/src/components/LabelControls.vue';
import FillColorControls from '@/src/components/FillColorControls.vue';

const activeToolStore = usePolygonStore();
</script>

<template>
  <label-controls :labels-store="activeToolStore" />
  <fill-color-controls :store="activeToolStore" />
</template>
