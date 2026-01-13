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
          :disabled="hasProjectPort"
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
import { defineComponent, onMounted, ref, computed, watch } from 'vue';
import { saveAs } from 'file-saver';
import { onKeyDown } from '@vueuse/core';
import { useLoadDataStore } from '@/src/store/load-data';
import { useViewStore } from '@/src/store/views';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { serialize } from '../io/state-file/serialize';
import { Manifest } from '../io/state-file/schema';

// import { usePaintToolStore } from '@/src/store/tools/paint';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRulerStore } from '@/src/store/tools/rulers';

import { useImageCacheStore } from '@/src/store/image-cache';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import {
  // worldToSVG,
  normalizeIJKCoords,
} from '@/src/utils/vtk-helpers';

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
    const saveAsHyperLink = ref(false);
    watch(saveAsHyperLink, saveToReport => {
      if (saveToReport) {
        fileName.value = fileName.value.replace('session.', 'report.');
      } else {
        fileName.value = fileName.value.replace('report.', 'session.');
      }
    });

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
          const stateIDToStoreID: Record<string, string> = dataID ? { [dataID]: dataID } : {};
          const meta: any = saveAsHyperLink.value ? {} : (dataID && stateIDToStoreID[dataID] ? { stateIDToStoreID } : {});
          // @ts-ignore
          const [blob, manifest]: [Blob, Manifest] = await serialize({
            stateIDToStoreID: meta.stateIDToStoreID,
            returnWithManifest: true,
          });
          if (saveAsHyperLink.value) {
            if (manifest.tools?.current) {
              meta.tool = manifest.tools.current;
            }
            switch (meta.tool) {
              case 'Paint': {
                // @ts-ignore
                const roiHistogramData = document.getElementById('roi-histogram')?.roi_histogram;
                if (roiHistogramData) {
                  const { mean, min, max } = roiHistogramData;
                  meta.measure = `mean: ${(mean || 0).toFixed(0)}, min: ${(min || 0).toFixed(0)}, max: ${(max || 0).toFixed(0)}`;
                }
                break;
              }
              case 'Rectangle': {
                const tools = manifest.tools!.rectangles?.tools;
                if (tools?.length) {
                  const toolId = tools.filter((t: any) => t.imageID === dataID && !t.placing).pop()?.id;
                  if (toolId) {
                    const rectangleStore = useRectangleStore();
                    const tool = rectangleStore.toolByID[toolId];
                    if (tool && tool.placing === false) {
                      const image = useImageCacheStore().imageById[tool.imageID];
                      if (image?.vtkImageData?.value && image?.imageMetadata?.value) {
                        const { firstPoint, secondPoint } = tool;
                        const {
                          Sagittal,
                          Coronal,
                          // Axial,
                        } = image.imageMetadata.value.lpsOrientation;
                        const x1 = firstPoint[Sagittal];
                        const y1 = firstPoint[Coronal];
                        // const z1 = firstPoint[Axial];
                        const x2 = secondPoint[Sagittal];
                        const y2 = secondPoint[Coronal];
                        // const z2 = secondPoint[Axial];
                        const {
                          x,
                          y,
                          // z,
                        } = {
                          x: Math.abs(x1 - x2),
                          y: Math.abs(y1 - y2),
                          // z: Math.abs(z1 - z2),
                        };
                        meta.measure = `${x.toFixed(2)}mm × ${y.toFixed(2)}mm`;
                      }
                    }
                  }
                }
                break;
              }
              case 'Polygon': {
                const tools = manifest.tools!.polygons?.tools;
                if (tools?.length) {
                  const toolId = tools.filter((t: any) => t.imageID === dataID && !t.placing).pop()?.id;
                  if (toolId) {
                    const polygonStore = usePolygonStore();
                    const tool = polygonStore.toolByID[toolId];
                    if (tool && tool.placing === false) {
                      const image = useImageCacheStore().imageById[tool.imageID];
                      if (image?.vtkImageData?.value && image?.imageMetadata?.value) {
                        const { frameOfReference, slice } = tool;
                        const { Sagittal, Coronal, Axial } = image.imageMetadata.value.lpsOrientation;
                        const toolAxis = frameOfReferenceToImageSliceAndAxis(frameOfReference, image.imageMetadata.value, { allowOutOfBoundsSlice: true });
                        const points = tool.points.map((point) => {
                          const xyz = [
                            point[Sagittal],
                            point[Coronal],
                            point[Axial],
                          ];
                          if (!!toolAxis && toolAxis.axis) {
                            const ijk = image.vtkImageData.value.worldToIndex([xyz[0], xyz[1], xyz[2]]); // px
                            const slicingMode = { 'Sagittal': 'I', 'Coronal': 'J', 'Axial': 'K' }[toolAxis.axis] // 'I' | 'J' | 'K'
                            let { ijk: [i, j, k] } = normalizeIJKCoords([ijk[0], ijk[1], ijk[2]], slicingMode, slice, image.vtkImageData.value.getExtent());
                            xyz[0] = i;
                            xyz[1] = j;
                            xyz[2] = k;
                          }
                          return {
                            x: xyz[0],
                            y: xyz[1],
                            // x: xyz[0] + 1,
                            // y: xyz[1] + 1,
                            // z: xyz[2],
                          };
                        }).filter((point, index, arr) => {
                          // filter some middle points when the number of points is larger than 10 to only keep about 10 points
                          if (arr.length > 10 && index !== 0 && index !== arr.length - 1) {
                            return index % Math.ceil(arr.length / 10) === 0;
                          }
                          return !!point;
                        });
                        meta.measure = points.map(({ x, y }) => `(${x.toFixed(0)},${y.toFixed(0)})`).join(' ');
                      }
                    }
                  }
                }
                break;
              }
              case 'Ruler': {
                const tools = manifest.tools!.rulers?.tools;
                if (tools?.length) {
                  const toolId = tools.filter((t: any) => t.imageID === dataID && !t.placing).pop()?.id;
                  if (toolId) {
                    const rulerStore = useRulerStore();
                    const tool = rulerStore.toolByID[toolId];
                    if (tool && tool.placing === false) {
                      const lengthByID = rulerStore.lengthByID;
                      const length = lengthByID[tool.id];
                      if (length) {
                        meta.measure = `${length.toFixed(2)}mm`;
                      }
                    }
                  }
                }
                break;
              }
              default: {
                break;
              }
            }
          } else if (meta.stateIDToStoreID) {
            if (manifest.activeView && manifest.viewByID?.[manifest.activeView]) {
              const viewSliceConfig = manifest.viewByID[manifest.activeView]?.config?.[dataID!]?.slice || useViewSliceStore().getConfig(manifest.activeView, dataID);
              if (viewSliceConfig) {
                meta.activeView = manifest.activeView;
                meta.slice = viewSliceConfig.slice;
              }
            }
          }
          const emitter = loadDataStore.$bus.emitter;
          emitter?.emit('savesession', {
            uid,
            fileContent: blob,
            fileName: fileName.value,
            fileType: 'zip',
            meta: Object.values(meta).length > 0 ? meta : undefined,
            toReport: saveAsHyperLink.value,
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
