<template>
  <div id="dicom-tag-module" class="fill-height d-flex flex-column">
    <div class="position-relative flex-shrink-0 pa-1 d-flex">
      <div class="w-100 px-1 my-auto d-flex align-center">
        <v-text-field
          :placeholder="'Search...'"
          density="compact"
          variant="underlined"
          hide-details
          single-line
          class="dicom-tags-quick-search mt-n2 mb-1"
          clearable
          @keydown.esc="$event.target.blur()"
        ></v-text-field>
      </div>
    </div>
    <div class="position-relative flex-grow-1">
      <div class="position-absolute top-0 left-0 w-100 h-100 pa-1 overflow-hidden border-t">
        <template v-if="true">
          <dicom-tag-table :tags="tags" />
        </template>
        <template v-else>
          <div class="empty-state ma-4 text-center">No data loaded</div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { shallowRef, computed } from 'vue';
import { watchDebounced } from '@vueuse/core';
import { useLoadDataStore } from '@/src/store/load-data';
import DicomTagTable from './DicomTagTable.vue';

const loadDataStore = useLoadDataStore();

const tags = shallowRef(null);

const currentSliceMetadata = computed(() => loadDataStore.currentSliceMetadata);
watchDebounced(currentSliceMetadata, async (currSliceMetadata, prevSliceMetadata) => {
  const dcmjs = window.dcmjs;
  if (!dcmjs?.$utils) {
    return;
  }
  if (currSliceMetadata) {
    if (currSliceMetadata?.file instanceof File) {
      const arrayBuffer = await currSliceMetadata.file.arrayBuffer();
      const DicomDict = dcmjs.data.DicomMessage.readFile(arrayBuffer);
      if (DicomDict) {
        if (currSliceMetadata.SOPInstanceUID === DicomDict.dict['00080018']?.Value?.[0]) {
          try {
            tags.value = dcmjs.$utils.getTagsFromDicomDict(DicomDict);
            console.log(currSliceMetadata.slice, tags.value);
          } catch (error) {
            tags.value = null;
            console.error(error);
          }
        }
      }
    } else if (prevSliceMetadata) {
      // tags.value = tags.value;
    }
  } else {
    tags.value = null;
  }
}, {
  debounce: 100,
  immediate: true,
});
</script>

<style>
.dicom-tags-quick-search input::placeholder {
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.425;
  letter-spacing: 0.0178571429em;
}
</style>
