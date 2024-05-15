import 'vue-toastification/dist/index.css';
import 'vuetify/lib/styles/main.css';
import '@/src/global.css';

import '@kitware/vtk.js/Rendering/OpenGL/Profiles/Geometry';
import '@kitware/vtk.js/Rendering/OpenGL/Profiles/Volume';
import '@kitware/vtk.js/Rendering/OpenGL/Profiles/Glyph';

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import mitt from 'mitt';
import VueToast from 'vue-toastification';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import { setPipelinesBaseUrl, setPipelineWorkerUrl } from '@itk-wasm/image-io';

import itkConfig from '@/src/io/itk/itkConfig';
import App from './components/App.vue';
import vuetify from './plugins/vuetify';
import { DICOMIO } from './io/dicom';
import { FILE_READERS } from './io';
import { registerAllReaders } from './io/readers';
import { CorePiniaProviderPlugin } from './core/provider';
import { patchExitPointerLock } from './utils/hacks';
import { init as initErrorReporting } from './utils/errorReporting';
import { StoreRegistry } from './plugins/storeRegistry';

// patches
patchExitPointerLock();

// Initialize global mapper topologies
// polys and lines in the front
vtkMapper.setResolveCoincidentTopologyToPolygonOffset();
vtkMapper.setResolveCoincidentTopologyPolygonOffsetParameters(-3, -3);
vtkMapper.setResolveCoincidentTopologyLineOffsetParameters(-3, -3);

registerAllReaders(FILE_READERS);

const dicomIO = new DICOMIO();
dicomIO.initialize();

// for @itk-wasm/image-io
setPipelineWorkerUrl(itkConfig.pipelineWorkerUrl);
setPipelinesBaseUrl(itkConfig.imageIOUrl);

const createVolViewApp = () => {
  const pinia = createPinia();
  pinia.use(
    CorePiniaProviderPlugin({
      dicomIO,
    })
  );
  pinia.use(StoreRegistry);

  const app = createApp(App);

  initErrorReporting(app);

  app.use(pinia);
  app.use(VueToast);
  app.use(vuetify);
  app.config.globalProperties.closeButton = false;
  app.config.globalProperties.fileButtons = true;
  app.config.globalProperties.emitter = mitt();
  app.provide('bus', app.config.globalProperties.emitter);

  return {
    app,
    pinia,
  };
};

const deleteVolViewApp = (app) => {
  app.unmount();
  // const pinia = getActivePinia();
  // if (pinia) {
  //   disposePinia(pinia);
  // }
};

if (!import.meta.env.VITE_BUILD_LIB) {
  const { app, pinia } = createVolViewApp();
  app.mount('#app');
  if (import.meta.env.DEV) {
    Reflect.set(window, '$store', {
      state: pinia.state.value,
      get activePinia() {
        return pinia;
      },
    });
  }
}
export default {
  createVolViewApp,
  deleteVolViewApp,
  // VolView: App,
  VueToast,
  vuetify,
};
