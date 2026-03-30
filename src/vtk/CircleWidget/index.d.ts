import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { useCircleStore } from '@/src/store/tools/circles';
import vtkRulerWidget, {
  IRulerWidgetInitialValues,
  vtkRulerViewWidget,
  vtkRulerWidgetPointState,
} from '../RulerWidget';

export { InteractionState } from '../RulerWidget';

export interface vtkCircleWidgetPointState extends vtkRulerWidgetPointState {}
export interface vtkCircleWidgetState extends vtkRulerWidgetPointState {}
export interface vtkCircleViewWidget extends vtkRulerViewWidget {}
export interface ICircleWidgetInitialValues extends IRulerWidgetInitialValues {}
export interface vtkCircleWidget extends vtkRulerWidget {}

function newInstance(
  initialValues: ICircleWidgetInitialValues
): vtkCircleWidget;

export declare const vtkCircleWidget: {
  newInstance: typeof newInstance;
};

export default vtkCircleWidget;
