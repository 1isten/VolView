<template>
  <div id="dicom-tag-table"></div>
</template>

<script setup>
import { shallowRef, computed, watch, onMounted } from 'vue';

const props = defineProps({
  tags: {
    type: Array,
    default: null,
  },
  filterKeyword: {
    type: String,
    default: '',
  },
});

const table = shallowRef();
const tableData = computed(() => props.tags || []);
watch(tableData, data => {
  if (!table.value) {
    return;
  }
  if (data.length) {
    table.value.replaceData(data);
  } else {
    table.value.clearData();
  }
  console.log({ table: table.value, tags: data });
});

onMounted(() => {
  if (!window.Tabulator) {
    return;
  }
  const Tabulator = window.Tabulator;
  table.value = new Tabulator('#dicom-tag-table', {
    data: tableData.value,
    dataTree: true,
    // dataTreeStartExpanded: true,
    columns: [
      { title: 'Tag', field: 'tag', width: 140 },
      { title: 'VR', field: 'vr', width: 60 },
      { title: 'Keyword', field: 'name', width: 200 },
      { title: 'Value', field: 'Value', width: 200 },
    ],
    layout: 'fitDataStretch',
    height: '100%',
  });
});

const keyword = computed(() => props.filterKeyword);
watch(keyword, value => {
  if (table.value) {
    if (value) {
      table.value.setFilter([
        [
          {field: 'tag', type: 'like', value },
          {field: 'name', type: 'like', value },
          // {field: 'vr', type: '=', value},
        ]
      ]);
    } else {
      table.value.clearFilter();
    }
  }
});
</script>

<style>
.tabulator {
  border: none;
}
.tabulator .tabulator-header,
.tabulator .tabulator-header .tabulator-col,
.tabulator .tabulator-row .tabulator-cell {
  border-color: rgb(112, 112, 112);
}
.tabulator,
.tabulator .tabulator-tableholder {
  background-color: rgb(var(--v-theme-background), 0);
}
.tabulator .tabulator-tableholder .tabulator-table {
  background-color: rgb(var(--v-theme-neutral));
}
.tabulator .tabulator-header {
  background-color: rgb(var(--v-theme-background), 0);
}
.tabulator .tabulator-header .tabulator-col,
.tabulator .tabulator-header .tabulator-col.tabulator-sortable.tabulator-col-sorter-element:hover {
  background-color: rgb(var(--v-theme-background));
}
.tabulator .tabulator-row:not(.tabulator-selectable:hover) {
  background-color: rgb(var(--v-theme-surface), 1);
}
.tabulator .tabulator-row.tabulator-row-even:not(.tabulator-selectable:hover) {
  background-color: rgb(var(--v-theme-surface), 0.75);
}
.tabulator .tabulator-row.tabulator-selectable:hover {
  background-color: rgb(var(--v-theme-surface), 0.25);
}
.tabulator .tabulator-row .tabulator-cell {
  user-select: text;
}
</style>
