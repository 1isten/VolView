import macro from '@kitware/vtk.js/macro';
import { Behavior } from '@kitware/vtk.js/Widgets/Representations/WidgetRepresentation/Constants';

import { AnnotationToolType } from '@/src/store/tools/types';
import vtkRulerWidget from '../RulerWidget';
import vtkCircleLineRepresentation from './CircleLineRepresentation';
import vtkCircleFillRepresentation from './CircleFillRepresentation';
import { PointsLabel } from '../RulerWidget/state';

export { InteractionState } from '../RulerWidget/behavior';

function vtkCircleWidget(publicAPI, model) {
  model.classHierarchy.push('vtkCircleWidget');

  const superGetRepresentationsForViewType =
    publicAPI.getRepresentationsForViewType;
  publicAPI.getRepresentationsForViewType = () => {
    const reps = superGetRepresentationsForViewType();
    reps[1].builder = vtkCircleLineRepresentation;
    reps[1].initialValues = {
      ...reps[1].initialValues,
      widgetAPI: model,
    };
    reps.push({
      builder: vtkCircleFillRepresentation,
      labels: [PointsLabel],
      initialValues: {
        behavior: Behavior.HANDLE,
        widgetAPI: model,
      },
    });
    return reps;
  };
}

const DEFAULT_VALUES = {};

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);
  vtkRulerWidget.extend(publicAPI, model, {
    ...initialValues,
    toolType: AnnotationToolType.Circle,
  });
  vtkCircleWidget(publicAPI, model);
}

export const newInstance = macro.newInstance(extend, 'vtkCircleWidget');

export default { newInstance, extend };
