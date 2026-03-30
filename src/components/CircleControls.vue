<script setup lang="ts">
import { useCircleStore } from '@/src/store/tools/circles';
import LabelControls from '@/src/components/LabelControls.vue';

const activeToolStore = useCircleStore();
</script>

<template>
  <label-controls :labels-store="activeToolStore" />
</template>
