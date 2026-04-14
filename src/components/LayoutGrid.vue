<template>
  <div class="layout-container flex-equal" :class="flexFlow">
    <div v-for="(item, i) in items" :key="i" class="d-flex flex-equal">
      <layout-grid v-if="item.type === 'layout'" :layout="item as Layout" />
      <LayoutGridItem
        v-else
        class="layout-item"
        :view-id="item.viewId"
        @pointerdown.capture="onFocusView(item.viewId, $event)"
        @dblclick="maximize(item.viewId)"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType, toRefs } from 'vue';
import { Layout } from '@/src/types/layout';
import { useViewStore } from '@/src/store/views';
import { useLoadDataStore } from '@/src/store/load-data';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import LayoutGridItem from '@/src/components/LayoutGridItem.vue';

export default defineComponent({
  name: 'LayoutGrid',
  components: {
    LayoutGridItem,
  },
  props: {
    layout: {
      type: Object as PropType<Layout>,
      required: true,
    },
  },
  setup(props) {
    const { layout } = toRefs(props);
    const viewStore = useViewStore();
    const loadDataStore = useLoadDataStore();

    const flexFlow = computed(() => {
      return layout.value.direction === 'column' ? 'flex-column' : 'flex-row';
    });

    const items = computed(() => {
      return layout.value.items.map((item) => {
        if (item.type === 'slot') {
          const viewInfo = viewStore.visibleViews[item.slotIndex];
          return {
            ...item,
            viewId: viewInfo.id,
          };
        }
        return item;
      });
    });

    return {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      onFocusView(id: string, e: PointerEvent) {
        if (viewStore.activeView !== id) {
          // Prevent the pointerdown from reaching the VTK interactor
          // so that clicking an inactive view only activates it
          // without starting annotation placement.
          // e.stopPropagation();
        }
        viewStore.setActiveView(id);
        loadDataStore.$bus.emitter?.emit('activeview', JSON.parse(JSON.stringify(viewStore.getView(id))));
      },
      maximize(id: string) {
        const currentTool = useToolStore().currentTool;
        if (currentTool !== Tools.Polygon) {
          viewStore.setActiveView(id);
          viewStore.toggleActiveViewMaximized();
        }
      },

      items,
      flexFlow,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/utils.css"></style>

<style scoped>
.layout-container {
  display: flex;
  flex-direction: column;
}

.layout-item {
  display: flex;
  flex: 1;
}
</style>
