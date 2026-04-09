<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  store: {
    activeLabel: string | undefined;
    labels: Record<string, any>;
    updateLabel: (id: string, patch: any) => void;
  };
}>();

const activeLabelData = computed(() => {
  const id = props.store.activeLabel;
  if (!id) return null;
  return props.store.labels[id] ?? null;
});

const fillEnabled = computed({
  get() {
    const fc = activeLabelData.value?.fillColor;
    return !!fc && fc !== 'transparent';
  },
  set(val: boolean) {
    const id = props.store.activeLabel;
    if (!id) return;
    if (val) {
      // Default fill color to the label's stroke color
      const baseColor = activeLabelData.value?.color ?? '#FF0000';
      props.store.updateLabel(id, {
        fillColor: baseColor,
        fillOpacity: 0.3,
      });
    } else {
      props.store.updateLabel(id, {
        fillColor: 'transparent',
        fillOpacity: 0,
      });
    }
  },
});

const fillColor = computed({
  get() {
    const fc = activeLabelData.value?.fillColor ?? 'transparent';
    return fc === 'transparent' ? '#000000' : fc;
  },
  set(val: string) {
    const id = props.store.activeLabel;
    if (!id) return;
    props.store.updateLabel(id, { fillColor: val });
  },
});

const fillOpacity = computed({
  get() {
    return Math.round((activeLabelData.value?.fillOpacity ?? 0) * 100);
  },
  set(val: number) {
    const id = props.store.activeLabel;
    if (!id) return;
    props.store.updateLabel(id, { fillOpacity: val / 100 });
  },
});
</script>

<template>
  <v-card class="pt-2">
    <v-card-subtitle>Fill Color</v-card-subtitle>
    <v-container class="py-0">
      <v-switch
        v-model="fillEnabled"
        label="Enable fill"
        density="compact"
        hide-details
        color="primary"
      />
      <div v-if="fillEnabled" class="d-flex align-center mt-n1 mb-2">
        <v-menu :close-on-content-click="false">
          <template #activator="{ props: menuProps }">
            <div
              v-bind="menuProps"
              class="fill-color-swatch flex-shrink-0"
              :style="{
                backgroundColor: fillColor,
                opacity: fillOpacity / 100,
              }"
            />
          </template>
          <v-color-picker
            :model-value="fillColor"
            @update:model-value="fillColor = $event"
            mode="rgb"
            hide-inputs
          />
        </v-menu>
        <v-slider
          v-model="fillOpacity"
          :min="1"
          :max="100"
          :step="1"
          density="compact"
          hide-details
          thumb-label
          class="flex-grow-1 ml-3"
        />
        <span class="text-caption ml-2 flex-shrink-0" style="min-width: 30px">
          {{ fillOpacity }}%
        </span>
      </div>
    </v-container>
  </v-card>
</template>

<style scoped>
.fill-color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  cursor: pointer;
}
</style>
