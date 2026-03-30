import macro from '@kitware/vtk.js/macros';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import vtkStateBuilder from '@kitware/vtk.js/Widgets/Core/StateBuilder';
import * as vtkMath from '@kitware/vtk.js/Common/Core/Math';
import LineGlyphRepresentation from '../LineGlyphRepresentation';

const NUM_CIRCLE_POINTS = 64;

function vtkCircleLineRepresentation(publicAPI, model) {
  model.classHierarchy.push('vtkCircleLineRepresentation');

  const superGetRepresentationStates = publicAPI.getRepresentationStates;

  const compositeState = vtkStateBuilder
    .createBuilder()
    .addDynamicMixinState({
      labels: ['handles'],
      mixins: ['origin', 'scale1'],
      name: 'handle',
    })
    .build();

  // Pre-create states for circle outline points (+ 1 to close the loop)
  const circleStates = Array.from({ length: NUM_CIRCLE_POINTS + 1 }, () =>
    compositeState.addHandle()
  );

  const superBehavior = model.widgetAPI.behavior;
  let behaviorModel;
  model.widgetAPI.behavior = (publicAPIy, bModel) => {
    behaviorModel = bModel;
    return superBehavior(publicAPIy, bModel);
  };

  publicAPI.getRepresentationStates = (input = model.inputData[0]) => {
    const states = superGetRepresentationStates(input);
    if (states.length === 0) return states;

    const box = [...vtkBoundingBox.INIT_BOUNDS];
    states.forEach((handle) => {
      const displayPos =
        behaviorModel._apiSpecificRenderWindow.worldToDisplay(
          ...handle.getOrigin(),
          behaviorModel._renderer
        );
      vtkBoundingBox.addPoint(box, ...displayPos);
    });
    const corners = vtkBoundingBox.getCorners(box, []);

    const corners2D = corners.reduce((outCorners, corner) => {
      const duplicate = outCorners.some((outCorner) =>
        vtkMath.areEquals(outCorner, corner)
      );
      if (!duplicate) {
        outCorners.push(corner);
      }
      return outCorners;
    }, []);

    if (corners2D.length < 2) return [];

    // Compute center and radii in display coordinates
    const centerX = (box[0] + box[1]) / 2;
    const centerY = (box[2] + box[3]) / 2;
    const centerZ = (box[4] + box[5]) / 2;
    const radiusX = (box[1] - box[0]) / 2;
    const radiusY = (box[3] - box[2]) / 2;

    const scale = states[0].getScale1();

    const outStates = [];
    for (let i = 0; i <= NUM_CIRCLE_POINTS; i++) {
      const angle = (2 * Math.PI * (i % NUM_CIRCLE_POINTS)) / NUM_CIRCLE_POINTS;
      const displayX = centerX + radiusX * Math.cos(angle);
      const displayY = centerY + radiusY * Math.sin(angle);

      const worldPos =
        behaviorModel._apiSpecificRenderWindow.displayToWorld(
          displayX,
          displayY,
          centerZ,
          behaviorModel._renderer
        );

      const state = circleStates[i];
      state.setOrigin(worldPos);
      state.setScale1(scale);
      outStates.push(state);
    }

    return outStates;
  };
}

export function extend(publicAPI, model, initialValues = {}) {
  LineGlyphRepresentation.extend(publicAPI, model, initialValues);
  vtkCircleLineRepresentation(publicAPI, model);
}

export const newInstance = macro.newInstance(
  extend,
  'vtkCircleLineRepresentation'
);

export default { newInstance, extend };
