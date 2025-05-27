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

interface State {
  prevLayoutName?: string;
  layout: Layout;
  viewSpecs: Record<string, ViewSpec>;
  activeViewID: string;
}

export const useViewStore = defineStore('view', {
  state: (): State => ({
    prevLayoutName: undefined,
    layout: {
      direction: LayoutDirection.V,
      items: [],
    },
    viewSpecs: structuredClone(InitViewSpecs),
    activeViewID: '',
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
          this.setLayout(layout);
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
