<script setup lang="ts">
import { computed, onBeforeMount } from 'vue';
import { useLoadDataStore } from '@/src/store/load-data';
import { useViewStore } from '@/src/store/views';
import LayoutGridEditor from './LayoutGridEditor.vue';

const props = defineProps({
  defaultLayoutName: {
    type: String,
    default: '',
  },
});

const viewStore = useViewStore();

const layoutGridSize = computed({
  get: () => [0, 0] as [number, number],
  set: (size: [number, number]) => {
    viewStore.setLayoutFromGrid(size);
  },
});

const namedLayoutsList = computed(() => {
  return Object.keys(viewStore.namedLayouts);
});

const selectNamedLayout = (name: string) => {
  viewStore.switchToNamedLayout(name);
  viewStore.prevLayoutName = '';
  requestAnimationFrame(() => {
    if (name.endsWith(' Only')) {
      return;
    }
    const dataID = viewStore.getView(viewStore.activeView)?.dataID;
    if (dataID) {
      const loadDataStore = useLoadDataStore();
      const volumeKeySuffix = loadDataStore.dataIDToVolumeKeyUID[dataID];
      const vol = volumeKeySuffix && loadDataStore.loadedByBus[volumeKeySuffix].volumes[dataID];
      if (vol && vol.layoutName) {
        const viewID = viewStore.getViewsForData(dataID).find((v) => v.name === vol.layoutName?.replace(' Only', ''))?.id;
        if (viewID) {
          viewStore.setActiveView(viewID);
        }
      }
    }
    document.querySelectorAll('button.slice-viewer-reset-camera').forEach(el => {
      const button = el as HTMLButtonElement;
      requestAnimationFrame(() => {
        button?.click();
      });
    });
  });
};

onBeforeMount(() => {
  if (props.defaultLayoutName && namedLayoutsList.value.includes(props.defaultLayoutName)) {
    viewStore.switchToNamedLayout(props.defaultLayoutName);
  }
})
</script>

<template>
  <div>
    <div v-if="namedLayoutsList.length > 0" class="named-layouts">
      <v-list density="compact">
        <v-list-item
          v-for="name in namedLayoutsList"
          :key="name"
          :active="viewStore.currentLayoutName === name && false"
          @click="selectNamedLayout(name)"
        >
          <v-list-item-title>{{ name.replace(' Only', '') }}</v-list-item-title>
        </v-list-item>
      </v-list>
      <!-- <v-divider class="my-2" /> -->
    </div>
    <div class="grid-editor">
      <LayoutGridEditor v-model="layoutGridSize" />
    </div>
  </div>
</template>

<style scoped>
.named-layouts {
  padding-bottom: 8px;

  padding: 0 !important;
  margin: -12px -8px !important;
}

.grid-editor {
  padding: 16px;
  display: flex;
  justify-content: center;
  align-items: center;

  display: none !important;
}
</style>
