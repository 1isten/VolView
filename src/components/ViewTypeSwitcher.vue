<script setup lang="ts">
import { useViewStore } from '@/src/store/views';
import { Maybe } from '@/src/types';
import { computed, toRefs } from 'vue';

const props = defineProps<{
  viewId: string;
  imageId: Maybe<string>;
}>();
const { viewId, imageId } = toRefs(props);

const viewStore = useViewStore();

const viewName = computed(() => {
  const viewInfo = viewStore.getView(viewId.value);
  return viewInfo?.name ?? '';
});

const availableViewNames = computed(() => {
  const viewNames = viewStore.availableViewsForSwitcher.map((v) => v.type === '3D' ? v.type : v.name).reverse();
  return [
    ...viewNames,
    'Remove',
  ];
});

function updateView(newViewName: string) {
  if (newViewName === 'Remove') {
    viewStore.setDataForView(viewId.value, null);
    return;
  }
  const selectedView = viewStore.availableViewsForSwitcher.find((v) => {
    if (newViewName === '3D') {
      return v.type === '3D';
    }
    return v.name === newViewName;
  });
  if (!selectedView) return;
  viewStore.replaceView(viewId.value, {
    ...selectedView,
    dataID: imageId.value,
  });
}
</script>

<template>
  <v-select
    :model-value="viewName"
    @update:model-value="updateView($event)"
    :items="availableViewNames"
    :menu-props="{ location: 'bottom end' }"
    :list-props="{ nav: true, density: 'compact' }"
    density="compact"
    hide-details
    variant="outlined"
    class="pointer-events-all view-type-select"
  >
    <template v-slot:selection="{ item }">
      {{ item.title === 'Volume' ? '3D' : item.value }}
    </template>
    <template v-slot:item="{ props: itemProps, item }">
      <template v-if="item.title === 'Remove'">
        <v-divider></v-divider>
        <v-list-item v-bind="itemProps" :title="item.title" :class="{ 'text-error': item.title === 'Remove' }"></v-list-item>
      </template>
      <template v-else>
        <v-list-item v-bind="itemProps" :title="item.title"></v-list-item>
      </template>
    </template>
  </v-select>
</template>

<style scoped>
.view-type-select {
  max-width: fit-content;
  font-size: 0.8125rem;
  margin-left: auto;
}

.view-type-select :deep(.v-field__input) {
  padding: 2px 4px;
  min-height: 20px;
  text-align: right;
  font-size: 0.625rem;
  font-weight: 500;
}

.view-type-select :deep(.v-field) {
  padding-right: 0;
  min-height: 20px;
}

.view-type-select :deep(.v-field__append-inner) {
  padding-top: 0;
  padding-right: 2px;
  margin-left: -6px;
}

.view-type-select :deep(.v-input__control) {
  min-height: 20px;
}

.view-type-select :deep(.v-field__overlay) {
  background-color: transparent;
}

.view-type-select :deep(.v-icon) {
  font-size: 0.875rem;
}

.view-type-select :deep(.v-field__outline) {
  --v-field-border-opacity: 0.2;
}
</style>
