<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import {
  useWindowingStore,
  defaultWindowLevelConfig,
} from '@/src/store/view-configs/windowing';
import { useViewStore } from '@/src/store/views';
import { WLAutoRanges, WLPresetsCT } from '@/src/constants';
import { getWindowLevels, useDICOMStore } from '@/src/store/datasets-dicom';
import { isDicomImage } from '@/src/utils/dataSelection';

export default defineComponent({
  setup() {
    const { currentImageID } = useCurrentImage();
    const windowingStore = useWindowingStore();
    const viewStore = useViewStore();
    const dicomStore = useDICOMStore();
    const panel = ref(['tags', 'presets', 'auto']);

    // Get the relevant view ids
    const viewIDs = computed(() =>
      viewStore.viewIDs.filter(
        (viewID) =>
          currentImageID.value &&
          !!windowingStore.getConfig(viewID, currentImageID.value)
      )
    );

    function parseLabel(text: string) {
      return text.replace(/([A-Z])/g, ' $1').trim();
    }

    // --- CT Preset Options --- //

    const modality = computed(() => {
      if (currentImageID.value && isDicomImage(currentImageID.value)) {
        const volKey = currentImageID.value;
        const { Modality } = dicomStore.volumeInfo[volKey];
        return Modality;
      }
      return '';
    });

    const ctTags = ['ct', 'ctprotocol'];
    const showCtPresets = computed(() => {
      if (currentImageID.value && !isDicomImage(currentImageID.value)) {
        return true;
      }
      return modality.value && ctTags.includes(modality.value.toLowerCase());
    });

    // --- UI Selection Management --- //

    type AutoRangeKey = keyof typeof WLAutoRanges;
    type PresetValue = { width: number; level: number };

    const wlConfig = computed(() => {
      // All views will have the same settings, just grab the first
      const viewID = viewIDs.value[0];
      const imageID = currentImageID.value;
      if (!imageID || !viewID) return defaultWindowLevelConfig();
      return (
        windowingStore.getConfig(viewID, imageID)?.value ??
        defaultWindowLevelConfig()
      );
    });

    const wlWidth = computed(() => wlConfig.value.width);
    const wlLevel = computed(() => wlConfig.value.level);

    const wlOptions = computed({
      get() {
        const config = wlConfig.value;
        if (config.useAuto) {
          return config.auto;
        }
        // Otherwise, a specific W/L is active (from preset or manual adjustment).
        return { width: wlWidth.value, level: wlLevel.value };
      },
      set(selection: AutoRangeKey | PresetValue) {
        const imageID = currentImageID.value;
        // All views will be synchronized, just set the first
        const viewID = viewIDs.value[0];
        if (!imageID || !viewID) {
          return;
        }

        if (typeof selection === 'object') {
          windowingStore.updateConfig(
            viewID,
            imageID,
            {
              width: selection.width,
              level: selection.level,
            },
            true
          );
          return;
        }

        windowingStore.updateConfig(
          viewID,
          imageID,
          {
            auto: selection,
          },
          true
        );
      },
    });

    // --- Tag WL Options --- //
    const tags = computed(() => {
      if (currentImageID.value && isDicomImage(currentImageID.value)) {
        const volKey = currentImageID.value;
        return getWindowLevels(dicomStore.volumeInfo[volKey]);
      }
      return [];
    });

    return {
      parseLabel,
      wlOptions,
      WLPresetsCT,
      showCtPresets,
      tags,
      panel,
      WLAutoRanges,
    };
  },
});
</script>

<template>
  <v-card dark>
    <v-card-text>
      <v-expansion-panels v-model="panel" multiple>
        <v-expansion-panel value="tags" v-if="tags.length">
          <v-expansion-panel-title>
            File Specific Presets
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-radio-group v-model="wlOptions" hide-details>
              <v-radio
                v-for="(value, idx) in tags"
                :key="idx"
                :label="`Tag ${idx + 1} [W:${value.width},L:${value.level}]`"
                :value="value"
                density="compact"
              />
            </v-radio-group>
          </v-expansion-panel-text>
        </v-expansion-panel>
        <v-expansion-panel v-if="showCtPresets" value="presets">
          <v-expansion-panel-title>CT Presets</v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-radio-group v-model="wlOptions" hide-details>
              <div v-for="(wl, name) in WLPresetsCT" :key="name">
                <v-radio
                  :key="name"
                  :label="parseLabel(name)"
                  :value="wl"
                  density="compact"
                  class="ml-3"
                />
              </div>
            </v-radio-group>
          </v-expansion-panel-text>
        </v-expansion-panel>
        <v-expansion-panel value="auto">
          <v-expansion-panel-title>Auto Window/Level</v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-radio-group v-model="wlOptions" hide-details>
              <v-radio
                v-for="(value, key) in WLAutoRanges"
                :key="key"
                :label="parseLabel(key)"
                :value="key"
                density="compact"
              >
                <v-tooltip activator="parent" location="bottom">
                  {{
                    value
                      ? `Remove the top and bottom ${value} percent of data`
                      : 'Use the full data range'
                  }}
                </v-tooltip>
              </v-radio>
            </v-radio-group>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.v-card {
  max-width: 300px;
}
.v-expansion-panel-title {
  min-height: auto;
}
.v-expansion-panel-text:deep() .v-expansion-panel-text__wrapper {
  padding: 4px 6px 8px;
}

.v-selection-control:deep() .v-selection-control__input > .v-icon {
  font-size: 18px;
  align-self: center;
}
</style>
