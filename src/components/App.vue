<template>
  <drag-and-drop :enabled="!disableDnD" @drop-files="loadFiles" id="app-container">
    <template v-slot="{ dragHover }">
      <v-app>
        <app-bar v-if="false" @click:left-menu="leftSideBar = !leftSideBar"></app-bar>
        <v-navigation-drawer
          v-if="!liteMode"
          v-model="leftSideBar"
          app
          clipped
          touchless
          :width="drawerWidth"
          id="left-nav"
          location="end"
          :mobile-breakpoint="0"
          disable-resize-watcher
          disable-route-watcher
          :temporary="temporaryDrawer"
          :style="isDrawerResizing ? 'transition: none !important;' : ''"
        >
          <module-panel :left-side-bar="leftSideBar" @close="leftSideBar = false" />
        </v-navigation-drawer>
        <div ref="drawerResizeHandle" id="drawer-resize-handle" :class="{ 'drawer-resize-handle-disabled': !leftSideBar }" :style="`width: ${drawerResizerWidth}px; ${drawerResizeHandleStyle}`" @dblclick="resetDrawerWidth">
          <!-- <div style="width: 2px; background-color: rgb(var(--v-theme-primary), 0.5);"></div> -->
        </div>
        <v-main id="content-main">
          <div class="fill-height d-flex flex-row flex-grow-1">
            <controls-strip :has-data="hasData" :left-menu="leftSideBar" @click:left-menu="leftSideBar = !leftSideBar" @click:close="closeApp"></controls-strip>
            <div class="d-flex flex-column flex-grow-1">
              <VtkRenderWindowParent>
                <layout-grid v-show="hasData" :layout="layout" />
              </VtkRenderWindowParent>
              <welcome-page
                v-if="!hasData"
                :loading="showLoading"
                class="clickable"
                @click="loadUserPromptedFiles"
              >
              </welcome-page>
            </div>
          </div>
        </v-main>
        <controls-modal />
      </v-app>
      <persistent-overlay
        :disabled="!dragHover"
        color="#000"
        :opacity="0.3"
        :z-index="2000"
        class="text-center"
      >
        <div class="d-flex flex-column align-center justify-center h-100">
          <div class="dnd-prompt">
            <v-icon size="4.75rem">mdi-download</v-icon>
            <div class="text-h2 font-weight-bold">Drop your files to open</div>
          </div>
        </div>
      </persistent-overlay>
    </template>
  </drag-and-drop>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref, MaybeRefOrGetter, useTemplateRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { UrlParams, useUrlSearchParams, useDraggable, useLocalStorage } from '@vueuse/core';
import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';
import { useDisplay } from 'vuetify';
import { useLoadDataStore, type Events as EventHandlers, type LoadEvent } from '@/src/store/load-data';
import { useDatasetStore } from '@/src/store/datasets';
import { useViewStore } from '@/src/store/views';
import useRemoteSaveStateStore from '@/src/store/remote-save-state';
import AppBar from '@/src/components/AppBar.vue';
import ControlsStrip from '@/src/components/ControlsStrip.vue';
import {
  loadFiles,
  loadUserPromptedFiles,
  loadUrls,
} from '@/src/actions/loadUserFiles';
import WelcomePage from '@/src/components/WelcomePage.vue';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import LayoutGrid from '@/src/components/LayoutGrid.vue';
import ModulePanel from '@/src/components/ModulePanel.vue';
import DragAndDrop from '@/src/components/DragAndDrop.vue';
import PersistentOverlay from '@/src/components/PersistentOverlay.vue';
import ControlsModal from '@/src/components/ControlsModal.vue';
import { useImageStore } from '@/src/store/datasets-images';
import { useServerStore } from '@/src/store/server';
import { useGlobalErrorHook } from '@/src/composables/useGlobalErrorHook';
// import { useKeyboardShortcuts } from '@/src/composables/useKeyboardShortcuts';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import {
  populateAuthorizationToken,
  stripTokenFromUrl,
} from '@/src/utils/token';
import { defaultImageMetadata } from '@/src/core/progressiveImage';
import VtkRenderWindowParent from '@/src/components/vtk/VtkRenderWindowParent.vue';
import { useSyncWindowing } from '@/src/composables/useSyncWindowing';
import { normalizeUrlParams } from '@/src/utils/urlParams';
import { normalize as normalizePath } from '@/src/utils/path';

import { useEventBus } from '@/src/composables/useEventBus';

export default defineComponent({
  name: 'App',

  components: {
    ControlsStrip,
    LayoutGrid,
    DragAndDrop,
    ModulePanel,
    PersistentOverlay,
    ControlsModal,
    WelcomePage,
    AppBar,
    VtkRenderWindowParent,
  },

  setup() {
    const imageStore = useImageStore();
    const dicomStore = useDICOMStore();

    useGlobalErrorHook();
    // useKeyboardShortcuts();

    // --- sync handling --- //

    useSyncWindowing();

    // --- file handling --- //

    const loadDataStore = useLoadDataStore();
    const hasData = computed(
      () =>
        loadDataStore.isBusUnselected || loadDataStore.isLoadingByBus ? false :
        imageStore.idList.length > 0 ||
        Object.keys(dicomStore.volumeInfo).length > 0
    );
    // show loading if actually loading or has any data,
    // since the welcome screen shouldn't be visible when
    // a dataset is opened.
    const showLoading = computed(
      () => loadDataStore.isLoading || loadDataStore.isLoadingByBus || hasData.value
    );

    const isInsideIframe = computed(() => loadDataStore.isInsideIframe);
    const hasProjectPort = computed(() => loadDataStore.hasProjectPort);

    const { currentImageID, currentImageMetadata, isImageLoading } = useCurrentImage();
    const defaultImageMetadataName = defaultImageMetadata().name;
    watch(currentImageMetadata, (newMetadata) => {
      let prefix = '';
      if (
        newMetadataNameTitle.value &&
        newMetadata?.name &&
        // wait until we get a real name, but if we never do, show default name
        (newMetadata.name !== defaultImageMetadataName || !isImageLoading)
      ) {
        prefix = `${newMetadata.name} - `;
      }
      if (isInsideIframe.value) {
        window.parent.postMessage({
          type: 'volview:changetitle',
          payload: { title: `${prefix}VolView` },
        }, '*');
      }
      document.title = `${prefix}VolView`;
    });

    // --- event handling --- //
    /*
    $bus.emitter.emit('load', {
      urlParams: { urls: ['./.tmp/8e532b9d-737ec192-1a85bc02-edd7971b-1d3f07b3.zip'], names: ['archive.zip'] },
      uid: '8e532b9d-737ec192-1a85bc02-edd7971b-1d3f07b3',
      n: 1,
    });
    */

    const viewStore = useViewStore();
    const datasetStore = useDatasetStore();
    const { emitter } = useEventBus(({
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      onloading(payload?: any) {
        loadDataStore.setIsLoadingByBus(true);
      },
      onload(payload: LoadEvent) {
        const { urlParams, ...options } = payload;

        if ('open-folder' in options) {
          const openFolder = (options['open-folder'] || '') as string;
          if (openFolder) {
            options.openFolder = normalizePath(decodeURIComponent(window.atob(openFolder)));
            delete options['open-folder'];
            if ('open-file' in options) {
              const openFile = (options['open-file'] || '') as string;
              if (openFile) {
                options.openFile = decodeURIComponent(window.atob(openFile));
                delete options['open-file'];
              }
            }
            options.uid = window.btoa(encodeURIComponent(options.openFolder));
            urlParams.urls = [];
            urlParams.names = [];
          }
        } else if (!urlParams || !urlParams.urls || !urlParams.urls.length) {
          return;
        }
        if (options.atob && options.uid) {
          if (urlParams.urls.length > 1) {
            if (Array.isArray(options.uid)) {
              options.uid = `[${options.uid[0]}]`;
            }
            const decodedPaths = window.atob(options.uid.startsWith('[') && options.uid.endsWith(']') ? options.uid.slice(1, -1) : options.uid.toString()).split(' ');
            // console.warn('[atob]', options.uid, '->', decodedPaths);
            urlParams.urls = decodedPaths.map(path => `h3://localhost/file/${decodeURIComponent(path)}`);

          } else {
            const decodedPath = decodeURIComponent(window.atob(options.uid.toString()));
            // console.warn('[atob]', options.uid, '->', decodedPath);
            const qs = urlParams.urls[0]?.split('?')[1];
            urlParams.urls = [`h3://localhost/file/${decodedPath}` + (qs ? `?${qs}` : '')];
          }
        }

        // make use of volumeKeyUID (if any) as volumeKeySuffix (if it is not specified)
        const volumeKeyUID = options.volumeKeyUID || options.uid;
        if (volumeKeyUID) {
          if (!('volumeKeySuffix' in options)) options.volumeKeySuffix = volumeKeyUID;
          delete options.uid;
        }

        loadUrls(payload.urlParams, options);
      },
      onunload() {
        datasetStore.removeAll();
      },
      onunselect() {
        if (currentImageID.value) {
          viewStore.removeDataFromViews(currentImageID.value);
        }
        loadDataStore.isBusUnselected = true;
      },
    } as unknown as EventHandlers), loadDataStore);

    watch(currentImageID, async (primarySelection) => {
      if (primarySelection) {
        const volumeKey = primarySelection;
        const volumeKeySuffix = loadDataStore.dataIDToVolumeKeyUID[volumeKey] || dicomStore.volumeKeyGetSuffix(volumeKey);
        if (volumeKeySuffix) {
          const { volumes, options } = loadDataStore.loadedByBus[volumeKeySuffix] || {};
          const vol = volumes?.[volumeKey];
          if (vol) {
            if (!vol.cached) {
              vol.cached = true;
            } else {
              // return;
            }
            if (!layoutNameSettled.value && options.changeLayout !== false && vol?.layoutName) {
              viewStore.setLayoutByName(vol.layoutName, true);
            }
          }
        }
      }
    });

    // --- parse URL -- //
    // http://localhost:8043/?names=[archive.zip]&urls=[./.tmp/8e532b9d-737ec192-1a85bc02-edd7971b-1d3f07b3.zip]&uid=8e532b9d-737ec192-1a85bc02-edd7971b-1d3f07b3&s=0
    // http://localhost:8043/?names=[archive.zip]&urls=[./.tmp/ec780211-db457dfe-ca89dfa0-aae410f6-e5938432.zip]&uid=ec780211-db457dfe-ca89dfa0-aae410f6-e5938432&i=0

    populateAuthorizationToken();
    stripTokenFromUrl();

    let urlParams: ReturnType<typeof normalizeUrlParams>;
    try {
      urlParams = normalizeUrlParams(
        vtkURLExtract.extractURLParameters() as UrlParams
      );
    } catch (error) {
      console.error('Failed to parse URL parameters:', error);
      urlParams = {};
    }

    const query = useUrlSearchParams();
    const newMetadataNameTitle = computed(() => !!query.changeTitle);
    const layoutNameSettled = computed(() => !!query.layoutName);
    const liteMode = computed(() => query.uiMode === 'lite');
    const disableDnD = computed(() => query.dnd === 'false' || query.dnd === '0' || isInsideIframe.value || hasProjectPort.value);

    onMounted(() => {
      const params = urlParams as any;
      if (params.urls?.length > 0) {
        if (params.atob && params.uid) {
          if (params.urls.length > 1) {
            if (Array.isArray(params.uid)) {
              params.uid = `[${params.uid[0]}]`;
            }
            const decodedPaths = window.atob(params.uid.startsWith('[') && params.uid.endsWith(']') ? params.uid.slice(1, -1) : params.uid.toString()).split(' ');
            // console.warn('[atob]', params.uid, '->', decodedPaths);
            params.urls = decodedPaths.map(path => `h3://localhost/file/${decodeURIComponent(path)}`);
          } else {
            const decodedPath = decodeURIComponent(window.atob(params.uid.toString()));
            // console.warn('[atob]', params.uid, '->', decodedPath);
            const qs = params.urls[0]?.split('?')[1];
            params.urls = [`h3://localhost/file/${decodedPath}` + (qs ? `?${qs}` : '')];
          }
        }
      } else if ('open-folder' in params) {
        const openFolder = params['open-folder'] || '';
        if (openFolder) {
          params.openFolder = normalizePath(decodeURIComponent(window.atob(openFolder)));
          const openFile = params['open-file'] || '';
          if (openFile) {
            params.openFile = decodeURIComponent(window.atob(openFile));
          }
          params.uid = window.btoa(encodeURIComponent(params.openFolder));
          params.urls = [];
          params.names = [];
        }
      } else {
        return;
      }
      const volumeKeyUID = params.volumeKeyUID || params.uid;
      if (volumeKeyUID) {
        const options = JSON.parse(JSON.stringify({
          volumeKeySuffix: volumeKeyUID as string,
          ...(params.openFolder ? {
            openFolder: params.openFolder ?? undefined,
            openFile: params.openFile ?? undefined,
          } : {
            s: params.s ?? undefined,
            n: params.n ?? undefined,
            i: params.i ?? undefined,
          }),
        }));
        if (params.prefetch) {
          options.prefetchFiles = true;
        }
        loadUrls(urlParams, options);
        return;
      }
      
      loadUrls(urlParams);
    });

    // --- remote save state URL --- //

    if (import.meta.env.VITE_ENABLE_REMOTE_SAVE && urlParams.save) {
      const url = Array.isArray(urlParams.save)
        ? urlParams.save[0]
        : urlParams.save;
      useRemoteSaveStateStore().setSaveUrl(url);
    }

    // --- remote server --- //

    const serverStore = useServerStore();
    onMounted(() => {
      serverStore.connect();
    });

    // --- layout --- //

    const { visibleLayout } = storeToRefs(viewStore);

    // --- //

    const display = useDisplay();

    const noDrawer = computed(() => query.drawer === 'none' || query.drawer === 'hidden');
    const permanentDrawer = computed(() => noDrawer.value || query.drawer === 'permanent');
    const temporaryDrawer = computed(() => permanentDrawer.value ? false : display.xlAndDown.value);
    const leftSideBar = ref(false);

    const drawerWidthMin = 350;
    const drawerWidthMax = 1024;
    const drawerWidth = useLocalStorage('vv-drawer-width', drawerWidthMin);
    const drawerResizerWidth = 8;
    const drawerResizerInitialX = computed(() => display.width.value - drawerWidthMin - (drawerResizerWidth / 2));
    const drawerResizerFinalX = computed(() => display.width.value - drawerWidthMax - (drawerResizerWidth / 2));
    const drawerResizeHandle = useTemplateRef('drawerResizeHandle') as MaybeRefOrGetter<HTMLElement>;
    const { x: drawerResizeHandleX, style: drawerResizeHandleStyle, isDragging: isDrawerResizing } = useDraggable(drawerResizeHandle, {
      axis: 'x',
      initialValue: { x: drawerResizerInitialX.value, y: 0 },
      preventDefault: true,
    });
    watch(display.width, (dw) => {
      if (dw > 0) {
        drawerResizeHandleX.value = dw - drawerWidth.value - (drawerResizerWidth / 2);
      }
    }, {
      immediate: true,
      once: false,
    });
    function resetDrawerWidth() {
      drawerWidth.value = drawerWidthMin;
      drawerResizeHandleX.value = drawerResizerInitialX.value;
    }

    watch(drawerResizeHandleX, (x: number) => {
      if (x > drawerResizerInitialX.value) {
        drawerResizeHandleX.value = drawerResizerInitialX.value;
      } else if (x < drawerResizerFinalX.value) {
        drawerResizeHandleX.value = drawerResizerFinalX.value;
      }
      drawerWidth.value = Math.round(display.width.value - drawerResizeHandleX.value - (drawerResizerWidth / 2));
    });

    watch(display.mobile, (isMobile) => {
      if (noDrawer.value) {
        leftSideBar.value = false;
      } else if (!isMobile && !leftSideBar.value) {
        leftSideBar.value = !temporaryDrawer.value;
      }
    }, {
      immediate: !display.mobile.value,
      once: true,
    });

    return {
      emitter,
      closeApp: () => {
        emitter.emit('unselect');
        setTimeout(() => {
          emitter.emit('close');
        }, 100);
      },
      temporaryDrawer,
      leftSideBar,
      drawerWidth,
      drawerResizeHandle,
      drawerResizerWidth,
      drawerResizeHandleStyle,
      isDrawerResizing,
      resetDrawerWidth,

      loadUserPromptedFiles,
      loadFiles,
      hasData,
      showLoading,
      layout: visibleLayout,

      liteMode,
      disableDnD,
    };
  },
});
</script>

<style>
#content-main {
  /* disable v-content transition when we resize our app drawer */
  transition: initial;
  width: 100%;
  height: 100%;
  position: fixed;
}

#left-nav {
  border-right: 1px solid rgb(var(--v-theme-background));
}

#content-main > .v-content__wrap {
  display: flex;
}

#module-switcher .v-input__prepend-inner {
  /* better icon alignment */
  margin-top: 15px;
}

.alert > .v-snack__wrapper {
  /* transition background color */
  transition: background-color 0.25s;
}
</style>

<style src="@/src/components/styles/utils.css"></style>

<style scoped>
#app-container {
  width: 100%;
  height: 100%;
}

.dnd-prompt {
  background: rgba(0, 0, 0, 0.4);
  color: white;
  border-radius: 8px;
  box-shadow: 0px 0px 10px 5px rgba(0, 0, 0, 0.4);
  padding: 64px;
  visibility: hidden;
}

#drawer-resize-handle {
  position: fixed;
  z-index: 1005;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  cursor: ew-resize;
}
#drawer-resize-handle.drawer-resize-handle-disabled {
  display: none !important;
  cursor: default !important;
  pointer-events: none !important;
}
</style>
