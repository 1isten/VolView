import macro from '@kitware/vtk.js/macros';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkWidgetRepresentation from '@kitware/vtk.js/Widgets/Representations/WidgetRepresentation';
import { Behavior } from '@kitware/vtk.js/Widgets/Representations/WidgetRepresentation/Constants';

const NUM_CIRCLE_POINTS = 64;

function vtkCircleFillRepresentation(publicAPI, model) {
  model.classHierarchy.push('vtkCircleFillRepresentation');

  model.internalPolyData = vtkPolyData.newInstance();

  model._pipeline = {
    source: publicAPI,
    mapper: vtkMapper.newInstance(),
    actor: vtkActor.newInstance({ pickable: true }),
  };

  model._pipeline.actor.setMapper(model._pipeline.mapper);
  vtkWidgetRepresentation.connectPipeline(model._pipeline);
  publicAPI.addActor(model._pipeline.actor);

  publicAPI.getSelectedState = () => model.inputData[0];

  const superBehavior = model.widgetAPI.behavior;
  let behaviorModel;
  model.widgetAPI.behavior = (publicAPIy, bModel) => {
    behaviorModel = bModel;
    return superBehavior(publicAPIy, bModel);
  };

  publicAPI.requestData = (inData, outData) => {
    const states = publicAPI.getRepresentationStates(inData[0]);

    if (states.length < 2 || !behaviorModel) {
      model.internalPolyData.getPoints().setData(new Float32Array(0));
      model.internalPolyData.getPolys().setData(new Uint32Array(0));
      model.internalPolyData.modified();
      outData[0] = model.internalPolyData;
      return;
    }

    const box = [...vtkBoundingBox.INIT_BOUNDS];
    states.forEach((handle) => {
      const displayPos =
        behaviorModel._apiSpecificRenderWindow.worldToDisplay(
          ...handle.getOrigin(),
          behaviorModel._renderer
        );
      vtkBoundingBox.addPoint(box, ...displayPos);
    });

    // Compute center and radii in display coordinates
    const centerX = (box[0] + box[1]) / 2;
    const centerY = (box[2] + box[3]) / 2;
    const centerZ = (box[4] + box[5]) / 2;
    const radiusX = (box[1] - box[0]) / 2;
    const radiusY = (box[3] - box[2]) / 2;

    if (radiusX < 1e-6 && radiusY < 1e-6) {
      model.internalPolyData.getPoints().setData(new Float32Array(0));
      model.internalPolyData.getPolys().setData(new Uint32Array(0));
      model.internalPolyData.modified();
      outData[0] = model.internalPolyData;
      return;
    }

    // Generate ellipse points in world space
    const points = new Float32Array(NUM_CIRCLE_POINTS * 3);
    for (let i = 0; i < NUM_CIRCLE_POINTS; i++) {
      const angle = (2 * Math.PI * i) / NUM_CIRCLE_POINTS;
      const displayX = centerX + radiusX * Math.cos(angle);
      const displayY = centerY + radiusY * Math.sin(angle);

      const worldPos =
        behaviorModel._apiSpecificRenderWindow.displayToWorld(
          displayX,
          displayY,
          centerZ,
          behaviorModel._renderer
        );

      points[i * 3] = worldPos[0];
      points[i * 3 + 1] = worldPos[1];
      points[i * 3 + 2] = worldPos[2];
    }

    // Create a single polygon with all points (fan)
    const polys = new Uint32Array(NUM_CIRCLE_POINTS + 1);
    polys[0] = NUM_CIRCLE_POINTS;
    for (let i = 0; i < NUM_CIRCLE_POINTS; i++) {
      polys[i + 1] = i;
    }

    model.internalPolyData.getPoints().setData(points);
    model.internalPolyData.getPolys().setData(polys);
    model.internalPolyData.modified();

    outData[0] = model.internalPolyData;
  };
}

const DEFAULT_VALUES = {
  behavior: Behavior.HANDLE,
  widgetAPI: null,
};

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);
  vtkWidgetRepresentation.extend(publicAPI, model, initialValues);
  macro.setGet(publicAPI, model, ['widgetAPI']);
  macro.get(publicAPI, model._pipeline, ['mapper', 'actor']);
  vtkCircleFillRepresentation(publicAPI, model);
}

export const newInstance = macro.newInstance(
  extend,
  'vtkCircleFillRepresentation'
);

export default { newInstance, extend };
