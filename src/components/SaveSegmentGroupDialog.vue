<template>
  <v-card>
    <v-card-title class="d-flex flex-row align-center">
      Save Segment Group
    </v-card-title>
    <v-card-text>
      <v-form v-model="valid" @submit.prevent="saveSegmentGroup">
        <v-text-field
          v-model="fileName"
          :hint="
            roiMode
              ? 'Filename to save.'
              : 'Filename that will appear in downloads.'
          "
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
import { writeSegmentation } from '@/src/io/readWriteImage';
import { useErrorMessage } from '@/src/composables/useErrorMessage';
import { useLoadDataStore } from '@/src/store/load-data';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { sanitizeSegmentGroupFileStem } from '@/src/io/state-file/segmentGroupArchivePath';

const EXTENSIONS = [
  'seg.nrrd',
  'nrrd',
  'nii',
  'nii.gz',
  'dcm',
  'hdf5',
  'tif',
  'mha',
  'vtk',
  'iwi.cbor',
].filter((ext) =>
  [
    'nii.gz',
    'dcm',
    // ... only allow above formats for manual ROI mask
  ].includes(ext)
);

const props = defineProps<{
  id: string;
}>();

const emit = defineEmits(['done']);

const query = useUrlSearchParams();
const manualInputId = computed(() => `${query.manualInputId || ''}`);
const roiMode = computed(() => query.roi === 'true' || query.roi === '1');
const labelmapFormat = computed(
  () => query.labelmapFormat && query.labelmapFormat.toString().toLowerCase()
);

const fileNameValue = ref('');
const valid = ref(true);
const saving = ref(false);
const fileFormat = ref(EXTENSIONS[0]);

const loadDataStore = useLoadDataStore();
const segmentGroupStore = useSegmentGroupStore();
const fileName = computed({
  get: () => fileNameValue.value,
  set: (value: string) => {
    fileNameValue.value = sanitizeSegmentGroupFileStem(value, '');
  },
});

async function saveSegmentGroup() {
  if (fileName.value.trim().length === 0) {
    return;
  }

  saving.value = true;
  await useErrorMessage('Failed to save segment group', async () => {
    const sanitizedFileName = sanitizeSegmentGroupFileStem(fileName.value);
    fileNameValue.value = sanitizedFileName;
    const serialized = await writeSegmentation(
      fileFormat.value,
      segmentGroupStore.dataIndex[props.id],
      segmentGroupStore.metadataByID[props.id],
      fileFormat.value !== 'dcm' // Explicit VR Little Endian (1.2.840.10008.1.2.1)
    );
    if (roiMode.value && fileFormat.value in FILE_EXT_TO_MIME) {
      if ('$electron' in window && manualInputId.value) {
        const emitter = loadDataStore.$bus.emitter;
        emitter?.emit('savesegmentation', {
          manualInputId: manualInputId.value,
          fileContent: serialized,
          fileName: `${sanitizedFileName}.${fileFormat.value}`,
          fileType: fileFormat.value,
          fileMime: FILE_EXT_TO_MIME[fileFormat.value],
          createdAt: Date.now(),
        });
        return;
      }
    }
    saveAs(new Blob([serialized]), `${sanitizedFileName}.${fileFormat.value}`);
  });
  saving.value = false;
  emit('done');
}

onMounted(() => {
  // trigger form validation check so can immediately save with default value
  fileNameValue.value = sanitizeSegmentGroupFileStem(
    segmentGroupStore.metadataByID[props.id].name
  );
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
