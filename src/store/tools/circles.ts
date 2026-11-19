import { defineAnnotationToolStore } from '@/src/utils/defineAnnotationToolStore';
import type { Vector3 } from '@kitware/vtk.js/types';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { ToolID } from '@/src/types/annotation-tool';

import {
  declareAnnotationToolManifestRefs,
  useAnnotationTool,
} from './useAnnotationTool';

// PMT-ONLY: the Circle annotation tool is a pmt addition (not upstream).
declareAnnotationToolManifestRefs('circles');

const circleDefaults = () => ({
  firstPoint: [0, 0, 0] as Vector3,
  secondPoint: [0, 0, 0] as Vector3,
  id: '' as ToolID,
  name: 'Circle',
  fillColor: 'transparent',
  fillOpacity: 0,
});

export const useCircleStore = defineAnnotationToolStore('circles', () => {
  const toolAPI = useAnnotationTool({
    toolDefaults: circleDefaults,
    manifestKey: 'circles',
  });

  function getPoints(id: ToolID) {
    const tool = toolAPI.toolByID.value[id];
    return [tool.firstPoint, tool.secondPoint];
  }

  // --- serialization --- //

  function serialize(state: StateFile) {
    if (!state.manifest.tools) return;
    state.manifest.tools.circles = toolAPI.serializeTools();
  }

  function deserialize(
    manifest: Manifest,
    dataIDMap: Record<string, string>,
    segmentIdMap: Record<string, string>
  ) {
    toolAPI.deserializeTools(
      manifest.tools?.circles,
      dataIDMap,
      segmentIdMap
    );
  }

  return {
    ...toolAPI,
    getPoints,
    serialize,
    deserialize,
  };
});
