<template>
  <v-card>
    <v-card-title class="d-flex flex-row align-center">
      Save Segment Group
    </v-card-title>
    <v-card-text>
      <v-form v-model="valid" @submit.prevent="saveSegmentGroup">
        <v-text-field
          v-model="fileName"
          :hint="roiMode ? 'Filename to save.' : 'Filename that will appear in downloads.'"
          label="Filename"
          :rules="[validFileName]"
          required
          id="filename"
        />

        <v-select
          label="Format"
          v-model="fileFormat"
          :items="EXTENSIONS"
          :readonly="roiMode"
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
import { onKeyDown, useUrlSearchParams } from '@vueuse/core';
import { saveAs } from 'file-saver';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { writeImage } from '@/src/io/readWriteImage';
import { useErrorMessage } from '@/src/composables/useErrorMessage';
import { useLoadDataStore } from '@/src/store/load-data';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';

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
].slice(2, 4);

const props = defineProps<{
  id: string;
}>();

const emit = defineEmits(['done']);

const query = useUrlSearchParams();
const roiMode = computed(() => query.roi === 'true' || query.roi === '1');
const labelmapFormat = computed(() => query.labelmapFormat && query.labelmapFormat.toString().toLowerCase());

const fileName = ref('');
const valid = ref(true);
const saving = ref(false);
const fileFormat = ref(EXTENSIONS[0]);

const loadDataStore = useLoadDataStore();
const segmentGroupStore = useSegmentGroupStore();

async function saveSegmentGroup() {
  if (fileName.value.trim().length === 0) {
    return;
  }

  saving.value = true;
  await useErrorMessage('Failed to save segment group', async () => {
    const parentImageID = segmentGroupStore.metadataByID[props.id].parentImage;
    const image = segmentGroupStore.dataIndex[props.id];
    const serialized = await writeImage(fileFormat.value, image);
    if (roiMode.value && (fileFormat.value in FILE_EXT_TO_MIME)) {
      const formData = new FormData();
      const fileContent = new Blob([serialized], { type: FILE_EXT_TO_MIME[fileFormat.value] });
      formData.append('fileContent', fileContent);
      formData.set('fileName', `${fileName.value.replaceAll(' ', '_')}.${fileFormat.value}`);
      formData.set('fileType', fileFormat.value);
      formData.set('pipelineId', query.pipelineId?.toString() || '');
      if (query.manualNodeId) {
        formData.set('meta', JSON.stringify({
          manualNodeId: query.manualNodeId,
          batch: query.pipelineEmbedded === 'embedded' ? true : undefined,
        }));
      }
      formData.set('type', 'segmentation');
      const res = await fetch('connect://localhost/api/volview/sessions', { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        console.log(data);
        const emitter = loadDataStore.$bus.emitter;
        emitter?.emit('savesegmentation', {
          uid: loadDataStore.dataIDToVolumeKeyUID[parentImageID],
          data,
        });
      } else {
        console.error(res.status, res.statusText);
      }
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
  if (labelmapFormat.value && EXTENSIONS.includes(labelmapFormat.value)) {
    fileFormat.value = labelmapFormat.value;
  }
});

onKeyDown('Enter', () => {
  saveSegmentGroup();
});

function validFileName(name: string) {
  return name.trim().length > 0 || 'Required';
}
</script>
