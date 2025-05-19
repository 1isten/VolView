<template>
  <v-card>
    <v-card-title class="d-flex flex-row align-center">
      Saving Session State
    </v-card-title>
    <v-card-text>
      <v-form v-model="valid" @submit.prevent="saveSession">
        <v-text-field
          v-model="fileName"
          hint="The filename to use for the session state file."
          label="Session State Filename"
          :rules="[validFileName]"
          required
          id="session-state-filename"
          hide-details
        />
        <v-checkbox
          v-if="hasProjectPort"
          v-model="saveAsHyperLink"
          label="Save to Report"
          density="compact"
          hide-details
          class="ms-n1 mt-3"
        />
      </v-form>
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn
        :loading="saving"
        color="secondary"
        @click="saveSession"
        :disabled="!valid"
      >
        <v-icon class="mr-2">mdi-content-save-all</v-icon>
        <span data-testid="save-session-confirm-button">Save</span>
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref, computed } from 'vue';
import { saveAs } from 'file-saver';
import { onKeyDown, useUrlSearchParams } from '@vueuse/core';
import { useDatasetStore } from '@/src/store/datasets';
import { useLoadDataStore } from '@/src/store/load-data';
import { serialize } from '../io/state-file';

const DEFAULT_FILENAME = 'session.volview.zip';

export default defineComponent({
  props: {
    close: {
      type: Function,
      required: true,
    },
  },
  setup(props) {
    const fileName = ref('');
    const valid = ref(true);
    const saving = ref(false);

    const query = useUrlSearchParams();
    const datasetStore = useDatasetStore();
    const loadDataStore = useLoadDataStore();
    const hasProjectPort = computed(() => loadDataStore.hasProjectPort);
    const saveAsHyperLink = ref(false);

    // eslint-disable-next-line consistent-return
    async function saveSession() {
      if (fileName.value.trim().length >= 0) {
        saving.value = true;
        if (hasProjectPort.value) {
          let sid = '';
          let oid = '';
          if (datasetStore.primarySelection) {
            const volumeKeySuffix = loadDataStore.dataIDToVolumeKeyUID[datasetStore.primarySelection]
            if (volumeKeySuffix && volumeKeySuffix.split('-').length === 5) {
              if (volumeKeySuffix.length === 36) {
                sid = volumeKeySuffix; // uuid
              } else {
                oid = volumeKeySuffix; // orthanc uid
              }
            }
          }
          const blob = await serialize();
          const formData = new FormData();
          formData.append('fileContent', blob);
          formData.set('fileName', fileName.value);
          formData.set('fileType', 'zip');
          formData.set('type', 'session');
          if (oid) {
            formData.set('oid', oid);
          }
          if (sid) {
            formData.set('seriesId', sid);
          }
          if (query.projectId) {
            formData.set('projectId', query.projectId.toString());
          }
          if (query.datasetId) {
            formData.set('datasetId', query.datasetId.toString());
          }
          return fetch('connect://localhost/api/volview/sessions', { method: 'POST', body: formData }).then(async res => {
            if (res.ok) {
              const data = await res.json();
              if (data && data.id && data.filePath) {
                if (saveAsHyperLink.value) {
                  const emitter = loadDataStore.$bus.emitter;
                  emitter?.emit('savesession', { data });
                }
                saving.value = false;
                props.close();
              }
            }
          }).catch(err => {
            console.error(err);
          });
        }
        try {
          const blob = await serialize();
          saveAs(blob, fileName.value);
          props.close();
        } finally {
          saving.value = false;
        }
      }
    }

    onMounted(() => {
      // triggers form validation check so can immediately save with default value
      fileName.value = DEFAULT_FILENAME.replace('volview', Date.now().toString());
    });

    onKeyDown('Enter', () => {
      saveSession();
    });

    function validFileName(name: string) {
      return name.trim().length > 0 || 'Required';
    }

    return {
      hasProjectPort,
      saveAsHyperLink,
      saving,
      saveSession,
      fileName,
      validFileName,
      valid,
    };
  },
});
</script>
