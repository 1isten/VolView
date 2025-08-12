import { defineStore } from 'pinia';
import { Layouts, DefaultViewSpec, InitViewSpecs } from '../config';
import { Layout, LayoutDirection } from '../types/layout';
import { useViewConfigStore } from './view-configs';
import { ViewSpec } from '../types/views';
import {
  StateFile,
  Layout as StateFileLayout,
  View,
} from '../io/state-file/schema';

import { useImageCacheStore } from './image-cache';

function cloneLayout(layout: Layout): Layout {
  return {
    direction: layout.direction,
    items: layout.items.map((item) =>
      typeof item === 'string' ? item : cloneLayout(item)
    ),
    ...(layout.name && { name: layout.name }),
  };
}

interface State {
  layout: Layout;
  viewSpecs: Record<string, ViewSpec>;
  activeViewID: string;
  maximizedViewID: string | null;
  originalLayout: Layout | null;
  prevLayoutName?: string;
}

export const useViewStore = defineStore('view', {
  state: (): State => ({
    layout: {
      direction: LayoutDirection.V,
      items: [],
    },
    viewSpecs: structuredClone(InitViewSpecs),
    activeViewID: '',
    maximizedViewID: null,
    originalLayout: null,
    // prevLayoutName: undefined,
  }),
  getters: {
    viewIDs(state) {
      return Object.keys(state.viewSpecs);
    },
  },
  actions: {
    setActiveViewID(id: string) {
      this.activeViewID = id;
    },
    addView(id: string) {
      if (!(id in this.viewSpecs)) {
        this.viewSpecs[id] = structuredClone(DefaultViewSpec);
      }
    },
    removeView(id: string) {
      if (id in this.viewSpecs) {
        delete this.viewSpecs[id];
      }
    },
    getPrimaryViewID(volumeKey: string) {
      const imageID = volumeKey;
      const image = useImageCacheStore().imageById[imageID];
      if (image && image.imageMetadata) {
        const lpsOrientation = image.imageMetadata.value.lpsOrientation;
        if (lpsOrientation) {
          const { Axial, Sagittal, Coronal } = lpsOrientation;
          let viewID: 'Axial' | 'Sagittal' | 'Coronal' | '3D' = 'Axial';
          if (Axial === 2) {
            viewID = 'Axial';
          } else if (Sagittal === 2) {
            viewID = 'Sagittal';
          } else if (Coronal === 2) {
            viewID = 'Coronal';
          }
          return viewID;
        }
      }
      return null;
    },
    getLayoutByViewID(viewID: 'Axial' | 'Sagittal' | 'Coronal' | '3D') {
      const layoutName = `${viewID} Only`;
      return layoutName;
    },
    setLayoutByViewID(viewID: 'Axial' | 'Sagittal' | 'Coronal' | '3D') {
      const layoutName = this.getLayoutByViewID(viewID);
      this.setLayoutByName(layoutName);
      return layoutName;
    },
    setLayoutByName(layoutName: string, justSet = false) {
      const layout = Layouts[layoutName];
      if (layout) {
        if (justSet) {
          if (this.layout?.name !== layoutName) {
            this.setLayout(layout);
          }
        } else if (this.layout.name !== layoutName) {
          this.prevLayoutName = this.layout.name;
          this.setLayout(layout);
        } else if (this.prevLayoutName && Layouts[this.prevLayoutName]) {
          this.setLayout(Layouts[this.prevLayoutName]);
          this.prevLayoutName = '';
        } else if (layoutName.includes(' Only') && Layouts['Quad View']) {
          this.prevLayoutName = layoutName;
          this.setLayout(Layouts['Quad View']);
        }
      }
      return layoutName;
    },
    setLayout(layout: Layout) {
      if (this.layout?.name === layout?.name) {
        return;
      }
      this.restoreLayout();
      this.layout = layout;

      const layoutsToProcess = [layout];
      while (layoutsToProcess.length) {
        const ly = layoutsToProcess.shift()!;
        ly.items.forEach((item) => {
          if (typeof item === 'string') {
            // item is a view ID
            this.addView(item);
          } else {
            layoutsToProcess.push(item);
          }
        });
      }
    },
    maximizeView(viewID: string) {
      if (this.maximizedViewID) {
        this.restoreLayout();
      }

      this.originalLayout = cloneLayout(this.layout);
      this.maximizedViewID = viewID;

      this.layout = {
        direction: LayoutDirection.H,
        items: [viewID],
      };
    },
    restoreLayout() {
      if (this.originalLayout) {
        this.layout = this.originalLayout;
        this.originalLayout = null;
        this.maximizedViewID = null;
      }
    },
    toggleMaximizeView(viewID: string) {
      if (this.maximizedViewID === viewID) {
        this.restoreLayout();
      } else {
        this.maximizeView(viewID);
      }
    },
    serialize(stateFile: StateFile) {
      const viewConfigStore = useViewConfigStore();
      const { manifest } = stateFile;
      const { views } = manifest;

      manifest.layout = this.layout as StateFileLayout;

      // Serialize the view specs
      Object.entries(this.viewSpecs).forEach(([id, spec]) => {
        const type = spec.viewType;
        const { props } = spec;
        const config = {};

        const view = {
          id,
          type,
          props,
          config,
        };

        views.push(view);
      });

      // Serialize the view config
      viewConfigStore.serialize(stateFile);
    },
    deserialize(views: View[], dataIDMap: Record<string, string>) {
      const viewConfigStore = useViewConfigStore();

      views.forEach((view) => {
        const viewID = view.id;

        const viewSpec = {
          viewType: view.type,
          props: view.props,
        };

        this.viewSpecs[viewID] = viewSpec;

        // Now delegate the deserialization of the view config
        const { config } = view;
        viewConfigStore.deserialize(viewID, config, dataIDMap);
      });
    },
  },
});
