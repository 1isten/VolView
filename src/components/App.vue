<template>
  <drag-and-drop enabled @drop-files="loadFiles" id="app-container">
    <template v-slot="{ dragHover }">
      <v-layout class="position-relative w-100 h-100 overflow-hidden">
        <app-bar @click:left-menu="leftSideBar = !leftSideBar"></app-bar>
        <v-navigation-drawer
          v-model="leftSideBar"
          app
          absolute
          clipped
          touchless
          width="450"
          id="left-nav"
        >
          <module-panel @close="leftSideBar = false" />
        </v-navigation-drawer>
        <v-main id="content-main">
          <div class="fill-height d-flex flex-row flex-grow-1">
            <controls-strip :has-data="hasData"></controls-strip>
            <div class="position-relative d-flex flex-column flex-grow-1 overflow-hidden">
              <layout-grid v-show="hasData" :layout="layout" />
              <welcome-page
                v-if="!hasData"
                :loading="showLoading"
                class="clickable"
                @click="loadUserPromptedFiles"
              >
              </welcome-page>
              <div v-if="busLoading" class="position-absolute w-100 h-100 d-flex bg-black">
                <div class="ma-auto">
                  <v-progress-circular indeterminate color="blue" />
                </div>
              </div>
            </div>
          </div>
        </v-main>
        <keyboard-shortcuts />
      </v-layout>
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
import { defineComponent, ref, computed, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { UrlParams } from '@vueuse/core';
import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';
import { useDisplay } from 'vuetify';
import useLoadDataStore from '@/src/store/load-data';
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
import KeyboardShortcuts from '@/src/components/KeyboardShortcuts.vue';
import { useImageStore } from '@/src/store/datasets-images';
import { useServerStore } from '@/src/store/server';
import { useGlobalErrorHook } from '@/src/composables/useGlobalErrorHook';
import { useKeyboardShortcuts } from '@/src/composables/useKeyboardShortcuts';
import { useEventBus } from '@/src/composables/useEventBus';

export default defineComponent({
  name: 'VolViewApp',

  components: {
    ControlsStrip,
    LayoutGrid,
    DragAndDrop,
    ModulePanel,
    PersistentOverlay,
    KeyboardShortcuts,
    WelcomePage,
    AppBar,
  },

  setup() {
    const imageStore = useImageStore();
    const dicomStore = useDICOMStore();

    useGlobalErrorHook();
    useKeyboardShortcuts();

    // --- file handling --- //

    const loadDataStore = useLoadDataStore();
    const hasData = computed(
      () =>
        imageStore.idList.length > 0 ||
        Object.keys(dicomStore.volumeInfo).length > 0
    );
    // show loading if actually loading or has any data,
    // since the welcome screen shouldn't be visible when
    // a dataset is opened.
    const showLoading = computed(
      () => loadDataStore.isLoading || hasData.value
    );
    const busLoading = computed(() => loadDataStore.isLoadingByBus);

    // --- events handling --- //

    const { emitter } = useEventBus({
      load(payload) {
        const { urlParams, ...options } = payload;

        if (!urlParams || !urlParams.urls) {
          return;
        }

        // make use of volumeKeyUID (if any) as volumeKeySuffix (if it is not specified)
        if ('volumeKeyUID' in options && typeof options.volumeKeyUID === 'string' && !('volumeKeySuffix' in options)) {
          options.volumeKeySuffix = options.volumeKeyUID;
        }

        loadUrls(payload.urlParams, options);
      }
    });

    onMounted(() => {
      if (import.meta.env.DEV) {
        Reflect.set(window, '$bus', { emitter });
      }
    });
    onUnmounted(() => {
      if (import.meta.env.DEV) {
        Reflect.deleteProperty(window, '$bus');
      }
    });

    // --- parse URL -- //

    const urlParams = vtkURLExtract.extractURLParameters() as UrlParams;

    onMounted(() => {
      if (!urlParams.urls) {
        return;
      }

      loadUrls(urlParams);
    });

    // --- remote server --- //

    const serverStore = useServerStore();

    onMounted(() => {
      serverStore.connect();
    });

    // --- save state --- //

    if (import.meta.env.VITE_ENABLE_REMOTE_SAVE && urlParams.save) {
      // Avoid dropping JSON or array query param arguments on the "save" query parameter
      // by parsing query params without casting to native types in vtkURLExtract.
      const queryParams = new URLSearchParams(window.location.search);
      const saveUrl = queryParams.get('save');
      if (saveUrl) {
        useRemoteSaveStateStore().setSaveUrl(saveUrl);
      }
    }

    // --- layout --- //

    const { layout } = storeToRefs(useViewStore());

    // --- //

    const display = useDisplay();

    return {
      leftSideBar: ref(!display.mobile.value),
      loadUserPromptedFiles,
      loadFiles,
      hasData,
      showLoading,
      busLoading,
      layout,
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
  position: absolute;
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
}
</style>
