<template>
  <div id="dicom-labeling-details" class="fill-height d-flex flex-column">
    <div class="position-relative labeling-fill">
      <transition name="labeling-status-fade">
        <div v-if="mutationStatus" class="labeling-status-overlay pa-2">
          <v-alert
            :type="
              mutationStatus.type === 'error'
                ? 'error'
                : mutationStatus.type === 'success'
                  ? 'success'
                  : 'info'
            "
            variant="tonal"
            density="compact"
            class="labeling-status-alert"
          >
            {{ mutationStatus.text }}
          </v-alert>
        </div>
      </transition>
      <div
        class="position-absolute top-0 left-0 w-100 h-100 pa-2 overflow-auto labeling-details-panel"
      >
        <div
          v-if="showNoSliceState"
          class="empty-state labeling-empty-state ma-4 text-center"
        >
          <v-icon size="28" color="medium-emphasis" class="mb-2"
            >mdi-image-off-outline</v-icon
          >
          <div class="text-subtitle-2 mb-1">No DICOM Slice Selected</div>
          <div class="text-body-2 text-medium-emphasis">
            Load a DICOM series or move to a slice to view labeling details
            here.
          </div>
        </div>

        <div
          v-else-if="!currentSliceLabeling?.matched"
          class="pa-2 d-flex flex-column ga-3"
        >
          <v-card variant="tonal" color="info">
            <v-card-text class="pa-3">
              <div class="d-flex align-center ga-2 mb-2">
                <v-icon color="info">mdi-label-off-outline</v-icon>
                <div class="text-subtitle-2">No Labeling Linked</div>
              </div>
              <div class="text-body-2 text-medium-emphasis">
                The current slice does not map to a labeled item yet.
              </div>
            </v-card-text>
          </v-card>

          <v-card variant="outlined">
            <v-card-text class="pa-3">
              <div class="text-overline text-medium-emphasis mb-2">
                Current Slice
              </div>
              <div class="text-caption text-medium-emphasis mb-1">
                SOP Instance UID
              </div>
              <div class="text-body-2 labeling-text-break">
                {{
                  currentSliceMetadata.SOPInstanceUID ||
                  currentSliceLabeling?.currentSlice?.sopInstanceUID ||
                  'Unavailable'
                }}
              </div>
            </v-card-text>
          </v-card>
        </div>

        <div v-else class="pa-2 d-flex flex-column ga-3">
          <v-card variant="outlined" class="labeling-summary-card">
            <v-card-text class="pa-3">
              <div class="d-flex align-start ga-3">
                <div
                  class="labeling-summary-icon labeling-no-shrink d-flex align-center justify-center"
                >
                  <v-icon>mdi-file-image-outline</v-icon>
                </div>
                <div class="labeling-fill min-w-0">
                  <div class="d-flex align-start ga-2">
                    <div class="labeling-fill min-w-0">
                      <div class="text-overline text-medium-emphasis">
                        Current Slice
                      </div>
                      <div
                        class="text-subtitle-1 labeling-text-break font-weight-medium"
                      >
                        {{
                          currentSliceLabeling.itemName ||
                          currentSliceLabeling.instance?.fileName ||
                          'Current DICOM Instance'
                        }}
                      </div>
                    </div>
                    <v-chip
                      size="small"
                      variant="tonal"
                      color="primary"
                      @click="openLabelAssignment()"
                    >
                      {{ labelCountText }}
                    </v-chip>
                  </div>

                  <div
                    class="text-caption text-medium-emphasis labeling-text-break mt-1"
                  >
                    <small>{{
                      currentSliceLabeling.instance?.sopInstanceUID
                    }}</small>
                  </div>

                  <div class="d-flex flex-wrap ga-2 mt-3">
                    <v-chip size="small" variant="outlined" v-if="false">
                      {{ currentSliceLabeling.slot || 'instance' }}
                    </v-chip>
                    <v-chip
                      v-if="
                        currentSliceLabeling.instance?.instanceNumber != null
                      "
                      size="small"
                      variant="outlined"
                    >
                      Instance #{{
                        currentSliceLabeling.instance.instanceNumber
                      }}
                    </v-chip>
                    <v-chip
                      size="small"
                      variant="outlined"
                      v-if="currentSliceLabeling.labels?.length === 0"
                    >
                      {{
                        currentSliceLabeling.labels?.length
                          ? 'Linked'
                          : 'Unlabeled'
                      }}
                    </v-chip>
                  </div>
                </div>
              </div>
            </v-card-text>
          </v-card>

          <v-card
            v-if="!currentSliceLabeling.labels?.length"
            variant="tonal"
            color="info"
          >
            <v-card-text class="pa-4 text-center">
              <v-icon size="26" color="info" class="mb-2"
                >mdi-label-outline</v-icon
              >
              <div class="text-subtitle-2 mb-1">No Labels Assigned</div>
              <div class="text-body-2 text-medium-emphasis mb-3">
                <small style="font-size: smaller"
                  >Assign one or more labels to start attaching details to this
                  slice.</small
                >
              </div>
              <v-btn
                size="small"
                variant="text"
                color="primary"
                @click="openLabelAssignment()"
              >
                Assign Labels
              </v-btn>
            </v-card-text>
          </v-card>

          <div
            v-for="label in currentSliceLabeling.labels || []"
            :key="label.name"
            class="label-card-wrapper"
          >
            <v-card variant="outlined" class="label-card">
              <v-card-text class="pa-3">
                <div class="d-flex align-start ga-3 mb-3">
                  <span
                    class="label-swatch label-swatch-large mt-1"
                    :style="{ backgroundColor: label.color || '#888888' }"
                  />
                  <div class="labeling-fill min-w-0">
                    <div class="d-flex align-start ga-2">
                      <div class="labeling-fill min-w-0">
                        <div class="text-subtitle-2 labeling-text-break">
                          {{ label.name }}
                        </div>
                        <div class="d-flex flex-wrap ga-2 mt-2" v-if="false">
                          <v-chip
                            v-if="label.details?.description"
                            size="x-small"
                            variant="tonal"
                            >Noted</v-chip
                          >
                          <v-chip
                            v-if="metaEntries(label).length"
                            size="x-small"
                            variant="tonal"
                            >{{ metaEntries(label).length }} Meta</v-chip
                          >
                          <v-chip
                            v-if="fileEntries(label).length"
                            size="x-small"
                            variant="tonal"
                            >{{ fileEntries(label).length }} File{{
                              fileEntries(label).length === 1 ? '' : 's'
                            }}</v-chip
                          >
                          <v-chip
                            v-if="
                              !label.details?.description &&
                              !metaEntries(label).length &&
                              !fileEntries(label).length
                            "
                            size="x-small"
                            variant="outlined"
                            >No details yet</v-chip
                          >
                        </div>
                      </div>
                      <v-btn
                        size="small"
                        variant="text"
                        color="primary"
                        @click="openLabelDetails(label)"
                      >
                        Open Details
                      </v-btn>
                    </div>
                  </div>
                </div>

                <div class="mb-3">
                  <div class="text-caption text-medium-emphasis mb-1">
                    Description
                  </div>
                  <template
                    v-if="
                      label.details?.description && !isEditingDescription(label)
                    "
                  >
                    <div
                      class="labeling-section pa-3 text-body-2 whitespace-pre-wrap"
                    >
                      {{ label.details.description }}
                    </div>
                    <div class="d-flex justify-end mt-2 mb-n5">
                      <v-btn
                        size="small"
                        variant="text"
                        color="primary"
                        @click="startEditDescription(label)"
                      >
                        Edit Note
                      </v-btn>
                    </div>
                  </template>
                  <div
                    v-else-if="
                      !label.details?.description &&
                      !isEditingDescription(label)
                    "
                    class="labeling-section pa-3 d-flex align-center justify-space-between ga-3"
                  >
                    <div class="text-body-2 text-medium-emphasis">
                      No description yet.
                    </div>
                    <v-btn
                      size="small"
                      variant="text"
                      color="primary"
                      @click="startEditDescription(label)"
                    >
                      Add Note
                    </v-btn>
                  </div>
                  <div v-else class="labeling-section pa-3">
                    <v-textarea
                      v-model="descriptionDraft"
                      label="Description"
                      rows="4"
                      auto-grow
                      density="compact"
                      variant="outlined"
                      hide-details="auto"
                    />
                    <div class="d-flex justify-end ga-2 mt-3">
                      <v-btn
                        size="small"
                        variant="text"
                        @click="cancelEditDescription()"
                        >Cancel</v-btn
                      >
                      <v-btn
                        v-if="label.details?.description"
                        size="small"
                        variant="tonal"
                        color="error"
                        @click="clearDescription(label)"
                        >Clear</v-btn
                      >
                      <v-btn
                        size="small"
                        variant="tonal"
                        color="primary"
                        @click="saveDescription(label)"
                        >Save</v-btn
                      >
                    </div>
                  </div>
                </div>

                <div class="mb-3">
                  <div class="text-caption text-medium-emphasis mb-1">
                    Metadata
                  </div>
                  <div
                    v-if="
                      metaEntries(label).length && !isEditingMetadata(label)
                    "
                    class="labeling-section"
                  >
                    <div
                      v-for="([key, value], index) in metaEntries(label)"
                      :key="`${label.name}-meta-${index}`"
                      class="d-flex justify-space-between ga-3 text-body-2 px-3 py-2 labeling-row-divider"
                    >
                      <span class="font-weight-medium labeling-text-break">{{
                        key
                      }}</span>
                      <span
                        class="text-medium-emphasis text-right me-3 labeling-text-break"
                        >{{ formatMetaValue(value) }}</span
                      >
                    </div>
                  </div>
                  <div
                    v-else-if="
                      !metaEntries(label).length && !isEditingMetadata(label)
                    "
                    class="labeling-section pa-3 d-flex align-center justify-space-between ga-3"
                  >
                    <div class="text-body-2 text-medium-emphasis">
                      No metadata yet.
                    </div>
                    <v-btn
                      size="small"
                      variant="text"
                      color="primary"
                      @click="startEditMetadata(label)"
                    >
                      Add Meta
                    </v-btn>
                  </div>
                  <div v-else class="labeling-section pa-3">
                    <div
                      v-for="(row, index) in metadataDraftRows"
                      :key="`${label.name}-meta-edit-${index}`"
                      class="d-flex align-start ga-2 mb-2"
                    >
                      <v-text-field
                        v-model="row.key"
                        label="Key"
                        density="compact"
                        variant="outlined"
                        hide-details
                        class="labeling-fill"
                      />
                      <v-text-field
                        v-model="row.value"
                        label="Value"
                        density="compact"
                        variant="outlined"
                        hide-details
                        class="labeling-fill"
                      />
                      <v-btn
                        icon
                        size="small"
                        variant="text"
                        color="error"
                        @click="removeMetadataRow(index)"
                      >
                        <v-icon size="18">mdi-delete-outline</v-icon>
                      </v-btn>
                    </div>
                    <div
                      class="d-flex justify-space-between align-center mt-3 ga-2"
                    >
                      <v-btn
                        size="small"
                        variant="text"
                        color="primary"
                        @click="addMetadataRow()"
                        >Add Row</v-btn
                      >
                      <div class="d-flex ga-2">
                        <v-btn
                          size="small"
                          variant="text"
                          @click="cancelEditMetadata()"
                          >Cancel</v-btn
                        >
                        <v-btn
                          size="small"
                          variant="tonal"
                          color="primary"
                          @click="saveMetadata(label)"
                          >Save</v-btn
                        >
                      </div>
                    </div>
                  </div>
                </div>

                <div v-if="fileEntries(label).length" class="mb-3">
                  <div class="text-caption text-medium-emphasis mb-1">
                    Files
                  </div>
                  <div class="labeling-section">
                    <div
                      v-for="([path, file], index) in fileEntries(label)"
                      :key="`${label.name}-file-${index}`"
                      class="d-flex ga-3 pa-3 py-2 labeling-row-divider"
                    >
                      <v-icon
                        size="18"
                        class="mt-1 labeling-no-shrink"
                        :color="
                          filePathExists[path] === false
                            ? 'error'
                            : 'medium-emphasis'
                        "
                        >mdi-file-document-outline</v-icon
                      >
                      <div class="labeling-fill min-w-0">
                        <div
                          class="text-body-2 labeling-text-break"
                          :class="{
                            'text-error': filePathExists[path] === false,
                          }"
                        >
                          {{ file?.name || path }}
                        </div>
                        <div
                          class="text-caption labeling-text-break mt-1"
                          :class="
                            filePathExists[path] === false
                              ? 'text-error'
                              : 'text-medium-emphasis'
                          "
                        >
                          {{ path }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="d-flex justify-end ga-2 mt-1">
                  <v-btn
                    v-if="
                      !isEditingDescription(label) && !isEditingMetadata(label)
                    "
                    size="small"
                    variant="text"
                    color="error"
                    class="me-auto"
                    @click="removeLabelAssignment(label)"
                  >
                    Remove Label
                  </v-btn>
                  <v-btn
                    v-if="
                      !isEditingMetadata(label) && metaEntries(label).length
                    "
                    size="small"
                    variant="text"
                    color="primary"
                    @click="startEditMetadata(label)"
                  >
                    Edit Meta
                  </v-btn>
                </div>
              </v-card-text>
            </v-card>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useLoadDataStore } from '@/src/store/load-data';

const props = defineProps({
  modulePanelOpened: {
    type: Boolean,
    default: false,
  },
});

const loadDataStore = useLoadDataStore();

const currentSliceMetadata = computed(() => loadDataStore.currentSliceMetadata);
const currentSliceLabeling = computed(() => loadDataStore.currentSliceLabeling);
const showNoSliceState = computed(
  () =>
    !currentSliceMetadata.value ||
    currentSliceLabeling.value?.reason === 'tree-files-view'
);
const labelCountText = computed(() => {
  const count = currentSliceLabeling.value?.labels?.length || 0;
  return `${count} Label${count === 1 ? '' : 's'}`;
});
const editingDescriptionLabel = ref('');
const descriptionDraft = ref('');
const editingMetadataLabel = ref('');
const metadataDraftRows = ref([]);
const mutationStatus = ref(null);
const pendingMutation = ref(null);
let mutationStatusTimer = null;

// Track whether referenced file paths exist on disk.
const filePathExists = ref({});

function requestPathExistsViaParent(path) {
  return new Promise((resolve) => {
    const requestId = `volview-path-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const handler = (e) => {
      if (
        e.data?.type === 'volview:path-exists-result' &&
        e.data?.requestId === requestId
      ) {
        window.removeEventListener('message', handler);
        resolve(e.data.exists);
      }
    };
    window.addEventListener('message', handler);
    window.parent.postMessage(
      { type: 'volview:path-exists', requestId, path },
      '*'
    );
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 5000);
  });
}

async function checkFilePaths() {
  const pathsToCheck = new Set();
  const labels = currentSliceLabeling.value?.labels || [];
  for (const label of labels) {
    for (const [path] of fileEntries(label)) {
      if (path) pathsToCheck.add(path);
    }
  }
  if (!pathsToCheck.size) {
    filePathExists.value = {};
    return;
  }

  // Prefer direct electron API (standalone BrowserWindow mode).
  // Fall back to postMessage when running inside an iframe.
  const directExists = window.$electron?.pathExists;
  const results = {};
  for (const path of pathsToCheck) {
    if (directExists) {
      try {
        results[path] = await directExists(path);
        continue;
      } catch {
        // direct call failed, fall through to postMessage
      }
    }
    results[path] = await requestPathExistsViaParent(path);
  }
  filePathExists.value = results;
}

function metaEntries(label) {
  const meta = label?.details?.meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return [];
  }
  return Object.entries(meta);
}

function fileEntries(label) {
  const files = label?.details?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    return [];
  }
  return Object.entries(files);
}

function formatMetaValue(value) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value == null) {
    return '';
  }
  return String(value);
}

function cloneHostPayload(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function getCurrentSliceSnapshotKey() {
  const slice = currentSliceLabeling.value;
  if (!slice?.matched) {
    return 'unmatched';
  }
  return JSON.stringify({
    dataKey: slice.dataKey,
    labels: (slice.labels || []).map((label) => ({
      name: label.name,
      description: label.details?.description || null,
      meta: label.details?.meta || null,
      files: label.details?.files || null,
    })),
  });
}

function clearMutationStatusTimer() {
  if (mutationStatusTimer) {
    clearTimeout(mutationStatusTimer);
    mutationStatusTimer = null;
  }
}

function setMutationStatus(type, text, options = {}) {
  clearMutationStatusTimer();
  mutationStatus.value = { type, text };
  if (options.autoClearMs) {
    mutationStatusTimer = setTimeout(() => {
      mutationStatus.value = null;
      mutationStatusTimer = null;
    }, options.autoClearMs);
  }
}

function emitHostMessage(type, payload) {
  const message =
    payload === undefined ? type : { type, payload: cloneHostPayload(payload) };
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, '*');
    return;
  }
  window.$electron?.emitToOpener?.(message);
}

function openLabelDetails(label) {
  if (!currentSliceLabeling.value?.matched || !label?.name) {
    return;
  }
  emitHostMessage('volview:open-label-details', {
    root: currentSliceLabeling.value.root,
    keys: [...(currentSliceLabeling.value.keys || [])],
    slot: currentSliceLabeling.value.slot || 'instance',
    itemName:
      currentSliceLabeling.value.itemName ||
      currentSliceLabeling.value.instance?.fileName ||
      'Current DICOM Instance',
    label: label.name,
    color: label.color || '#888888',
  });
}

function openLabelAssignment() {
  if (!currentSliceLabeling.value?.matched) {
    return;
  }
  emitHostMessage('volview:open-label-assignment', {
    root: currentSliceLabeling.value.root,
    keys: [...(currentSliceLabeling.value.keys || [])],
    slot: currentSliceLabeling.value.slot || 'instance',
    itemName:
      currentSliceLabeling.value.itemName ||
      currentSliceLabeling.value.instance?.fileName ||
      'Current DICOM Instance',
  });
}

function queueMutation(type, payload, successText) {
  pendingMutation.value = {
    snapshotKey: getCurrentSliceSnapshotKey(),
    successText,
  };
  setMutationStatus('info', 'Saving changes...');
  emitHostMessage(type, payload);
  clearMutationStatusTimer();
  mutationStatusTimer = setTimeout(() => {
    if (pendingMutation.value) {
      pendingMutation.value = null;
      mutationStatus.value = {
        type: 'error',
        text: 'The change did not confirm yet. Please retry if needed.',
      };
    }
    mutationStatusTimer = null;
  }, 5000);
}

function isEditingDescription(label) {
  return editingDescriptionLabel.value === label?.name;
}

function isEditingMetadata(label) {
  return editingMetadataLabel.value === label?.name;
}

function startEditDescription(label) {
  editingDescriptionLabel.value = label?.name || '';
  descriptionDraft.value = label?.details?.description || '';
  cancelEditMetadata();
}

function startEditMetadata(label) {
  editingMetadataLabel.value = label?.name || '';
  metadataDraftRows.value = metaEntries(label).map(([key, value]) => ({
    key,
    value: value == null ? '' : String(value),
  }));
  if (!metadataDraftRows.value.length) {
    metadataDraftRows.value = [{ key: '', value: '' }];
  }
  cancelEditDescription();
}

function cancelEditDescription() {
  editingDescriptionLabel.value = '';
  descriptionDraft.value = '';
}

function cancelEditMetadata() {
  editingMetadataLabel.value = '';
  metadataDraftRows.value = [];
}

function addMetadataRow() {
  metadataDraftRows.value.push({ key: '', value: '' });
}

function removeMetadataRow(index) {
  metadataDraftRows.value.splice(index, 1);
  if (!metadataDraftRows.value.length) {
    metadataDraftRows.value.push({ key: '', value: '' });
  }
}

function saveDescription(label) {
  if (!currentSliceLabeling.value?.matched || !label?.name) {
    return;
  }
  const currentDescription = label?.details?.description || '';
  if (descriptionDraft.value === currentDescription) {
    setMutationStatus('info', 'No changes to save.', { autoClearMs: 1800 });
    cancelEditDescription();
    return;
  }
  queueMutation(
    'volview:save-label-description',
    {
      root: currentSliceLabeling.value.root,
      keys: [...(currentSliceLabeling.value.keys || [])],
      label: label.name,
      description: descriptionDraft.value,
    },
    'Note saved.'
  );
  cancelEditDescription();
}

function clearDescription(label) {
  if (!currentSliceLabeling.value?.matched || !label?.name) {
    return;
  }
  queueMutation(
    'volview:save-label-description',
    {
      root: currentSliceLabeling.value.root,
      keys: [...(currentSliceLabeling.value.keys || [])],
      label: label.name,
      description: '',
    },
    'Note cleared.'
  );
  cancelEditDescription();
}

function saveMetadata(label) {
  if (!currentSliceLabeling.value?.matched || !label?.name) {
    return;
  }
  const rows = metadataDraftRows.value
    .map((row) => ({
      key: `${row?.key ?? ''}`.trim(),
      value: `${row?.value ?? ''}`,
    }))
    .filter((row) => row.key);
  const currentRows = metaEntries(label).map(([key, value]) => ({
    key,
    value: value == null ? '' : String(value),
  }));
  if (JSON.stringify(rows) === JSON.stringify(currentRows)) {
    setMutationStatus('info', 'No metadata changes to save.', {
      autoClearMs: 1800,
    });
    cancelEditMetadata();
    return;
  }
  queueMutation(
    'volview:save-label-metadata',
    {
      root: currentSliceLabeling.value.root,
      keys: [...(currentSliceLabeling.value.keys || [])],
      label: label.name,
      rows,
    },
    rows.length ? 'Metadata saved.' : 'Metadata cleared.'
  );
  cancelEditMetadata();
}

function removeLabelAssignment(label) {
  if (!currentSliceLabeling.value?.matched || !label?.name) {
    return;
  }
  queueMutation(
    'volview:remove-label-assignment',
    {
      root: currentSliceLabeling.value.root,
      keys: [...(currentSliceLabeling.value.keys || [])],
      label: label.name,
    },
    `Removed label "${label.name}".`
  );
}

watch(getCurrentSliceSnapshotKey, (nextKey) => {
  if (!pendingMutation.value) {
    return;
  }
  if (nextKey !== pendingMutation.value.snapshotKey) {
    const successText = pendingMutation.value.successText || 'Changes saved.';
    pendingMutation.value = null;
    setMutationStatus('success', successText, { autoClearMs: 2000 });
  }
});

watch(
  () => currentSliceLabeling.value?.dataKey,
  () => {
    cancelEditDescription();
    cancelEditMetadata();
    pendingMutation.value = null;
    clearMutationStatusTimer();
    mutationStatus.value = null;
    checkFilePaths();
  }
);

watch(
  () => props.modulePanelOpened,
  (opened) => {
    if (!opened) {
      cancelEditDescription();
      cancelEditMetadata();
      pendingMutation.value = null;
      clearMutationStatusTimer();
      mutationStatus.value = null;
    }
  }
);

watch(
  () => {
    const labels = currentSliceLabeling.value?.labels || [];
    return labels
      .map((label) =>
        fileEntries(label)
          .map(([path]) => path)
          .join(',')
      )
      .join('|');
  },
  () => {
    checkFilePaths();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  clearMutationStatusTimer();
});
</script>

<style scoped>
.label-swatch {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  display: inline-block;
  flex: 0 0 auto;
}

.label-swatch-large {
  width: 14px;
  height: 14px;
}

.label-card {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-color: rgba(var(--v-theme-on-surface), 0.12);
}

.label-card-wrapper + .label-card-wrapper {
  margin-top: 4px;
}

.labeling-fill {
  flex: 1 1 auto;
}

.labeling-no-shrink {
  flex-shrink: 0;
}

.labeling-empty-state {
  padding-top: 32px;
  padding-bottom: 32px;
}

.labeling-status-overlay {
  position: absolute;
  bottom: 0;
  right: 0;
  z-index: 2;
  width: min(360px, calc(100% - 16px));
  pointer-events: none;
}

.labeling-status-alert {
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
}

.labeling-details-panel {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.labeling-summary-card {
  background: rgba(var(--v-theme-surface), 0.55);
}

.labeling-summary-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgba(var(--v-theme-neutral), 0.12);
  color: rgb(255, 255, 255, 0.88);
}

.labeling-section {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 8px;
  overflow: hidden;
  background: rgba(var(--v-theme-surface), 0.32);
}

.labeling-row-divider {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.labeling-row-divider:last-child {
  border-bottom: none;
}

.labeling-text-break {
  overflow-wrap: anywhere;
  word-break: break-word;
  user-select: text;
}

.whitespace-pre-wrap {
  white-space: pre-wrap;
}

.labeling-status-fade-enter-active,
.labeling-status-fade-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.labeling-status-fade-enter-from,
.labeling-status-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
