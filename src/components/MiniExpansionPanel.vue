<template>
  <div class="text-body-2">
    <div class="d-flex flex-wrap align-center justify-space-between">
      <div class="d-flex">
        <slot name="title"> </slot>
      </div>
      <v-btn
        variant="plain"
        class="pa-0"
        style="font-size: smaller"
        @click="toggleInstructions"
      >
        <span>{{ label }}</span>
        <span v-if="!showInstructions">▼</span>
        <span v-else>▲</span>
      </v-btn>
    </div>
    <v-expand-transition>
      <div v-if="showInstructions" class="mt-2">
        <slot></slot>
      </div>
    </v-expand-transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

withDefaults(
  defineProps<{
    label?: string;
  }>(),
  {
    label: 'More info',
  }
);

const showInstructions = ref(false);

const toggleInstructions = () => {
  showInstructions.value = !showInstructions.value;
};
</script>
