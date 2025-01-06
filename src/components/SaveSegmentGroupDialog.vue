<template>
  <v-card>
    <v-card-title class="d-flex flex-row align-center">
      Save Segment Group
    </v-card-title>
    <v-card-text>
      <v-form v-model="valid" @submit.prevent="saveSegmentGroup">
        <v-text-field
          v-model="fileName"
          :hint="saveToRemote ? 'Filename to save.' : 'Filename that will appear in downloads.'"
          label="Filename"
          :rules="[validFileName]"
          required
          id="filename"
        />

        <v-select
          label="Format"
          v-model="fileFormat"
          :items="EXTENSIONS"
          :readonly="saveToRemote"
        ></v-select>
      </v-form>
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn
        :loading="saving"
        color="secondary"
        @click="saveSegmentGroup"
        :disabled="!valid"
      >
        <v-icon class="mr-2">mdi-content-save</v-icon>
        <span data-testid="save-confirm-button">Save</span>
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { onKeyDown } from '@vueuse/core';
import { saveAs } from 'file-saver';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { writeImage } from '@/src/io/readWriteImage';
import { useErrorMessage } from '@/src/composables/useErrorMessage';
import { useLoadDataStore } from '@/src/store/load-data';

const EXTENSIONS = [
  'nrrd',
  'nii',
  'nii.gz',
  'dcm',
  'hdf5',
  'tif',
  'mha',
  'vtk',
  'iwi.cbor',
];

const props = defineProps<{
  id: string;
}>();

const emit = defineEmits(['done']);

const fileName = ref('');
const valid = ref(true);
const saving = ref(false);
const fileFormat = ref(EXTENSIONS[0]);
const saveToRemote = computed(() => fileFormat.value === 'nii.gz' || fileFormat.value === 'nii');

const loadDataStore = useLoadDataStore();
const segmentGroupStore = useSegmentGroupStore();

async function saveSegmentGroup() {
  if (fileName.value.trim().length === 0) {
    return;
  }

  saving.value = true;
  await useErrorMessage('Failed to save segment group', async () => {
    const image = segmentGroupStore.dataIndex[props.id];
    const serialized = await writeImage(fileFormat.value, image);
    if (saveToRemote.value) {
      const formData = new FormData();
      const fileContent = new Blob([serialized], { type: 'application/vnd.unknown.nifti-1' });
      formData.append('fileContent', fileContent);
      formData.set('fileExtension', fileFormat.value);
      formData.set('oid', 'test-oid');
      formData.set('pipelineId', 'test-pipeline-id');
      formData.set('projectId', 'test-project-id');
      formData.set('datasetId', 'test-dataset-id');
      const res = await fetch('connect://localhost/api/volview/create-segmentation', { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        console.log(data);
      } else {
        console.error(res.status, res.statusText);
      }
      const emitter = loadDataStore.$bus.emitter;
      emitter?.emit('savesegmentation', {
        manualNodeId: 'test-manual-node-id',
        slotIndex: 0,
        path: '/some/path/labelmap.nii.gz',
      });
      return;
    }
    saveAs(new Blob([serialized]), `${fileName.value}.${fileFormat.value}`);
  });
  saving.value = false;
  emit('done');
}

onMounted(() => {
  // trigger form validation check so can immediately save with default value
  fileName.value = segmentGroupStore.metadataByID[props.id].name;
  fileFormat.value = 'nii.gz';
});

onKeyDown('Enter', () => {
  saveSegmentGroup();
});

function validFileName(name: string) {
  return name.trim().length > 0 || 'Required';
}
</script>
