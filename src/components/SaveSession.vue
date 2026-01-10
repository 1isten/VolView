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
import { onKeyDown } from '@vueuse/core';
import { useLoadDataStore } from '@/src/store/load-data';
import { useViewStore } from '@/src/store/views';
import { serialize } from '../io/state-file/serialize';
import { Manifest } from '../io/state-file/schema';

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

    const loadDataStore = useLoadDataStore();
    const hasProjectPort = computed(() => loadDataStore.hasProjectPort);
    const pickAndSkipData = ref(false);
    const saveAsHyperLink = ref(false);

    async function saveSession() {
      if (fileName.value.trim().length >= 0) {
        saving.value = true;
        if (hasProjectPort.value) {
          const viewStore = useViewStore();
          const view = viewStore.activeView ? viewStore.getView(viewStore.activeView) : null;
          const dataID = view?.dataID;
          const volumeKeySuffix = dataID ? loadDataStore.dataIDToVolumeKeyUID[dataID] : '';
          const uid = volumeKeySuffix && volumeKeySuffix.split('-').length === 5 ? (
            volumeKeySuffix.length === 36
              ? volumeKeySuffix // uuid
              : volumeKeySuffix // orthanc uid
          ) : '';

          if (pickAndSkipData.value) {
            // TODO: implement PMT custom export/import state logic
            // ...
          }

          // @ts-ignore
          const [blob, manifest]: [Blob, Manifest] = await serialize({ returnWithManifest: true });
          const meta: any = {};
          if (manifest) {
            if (manifest.tools?.current) {
              meta.tool = manifest.tools.current;
              switch (meta.tool) {
                case 'Paint': {
                  // @ts-ignore
                  const roiHistogramData = document.getElementById('roi-histogram')?.roi_histogram;
                  if (roiHistogramData) {
                    meta.paint = roiHistogramData;
                  }
                  break;
                }
                case 'Rectangle': {
                  if (manifest.tools.rectangles?.tools) {
                    meta.rectangles = JSON.parse(JSON.stringify(manifest.tools.rectangles?.tools));
                  }
                  break;
                }
                case 'Polygon': {
                  if (manifest.tools.polygons?.tools) {
                    meta.polygons = JSON.parse(JSON.stringify(manifest.tools.polygons?.tools));
                  }
                  break;
                }
                case 'Ruler': {
                  if (manifest.tools.rulers?.tools) {
                    meta.rulers = JSON.parse(JSON.stringify(manifest.tools.rulers?.tools));
                  }
                  break;
                }
                default: {
                  break;
                }
              }
            }
          }
          const emitter = loadDataStore.$bus.emitter;
          emitter?.emit('savesession', {
            uid,
            fileContent: blob,
            fileName: fileName.value,
            fileType: 'zip',
            toReport: saveAsHyperLink.value,
            meta: meta.tool ? meta : undefined,
          });
          props.close();
          saving.value = false;
          return;
        }
        try {
          const blob = await serialize();
          saveAs(blob as Blob, fileName.value);
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
