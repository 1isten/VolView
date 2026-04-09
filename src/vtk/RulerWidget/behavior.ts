import macro from '@kitware/vtk.js/macro';
import type { Vector3 } from '@kitware/vtk.js/types';
import { computeWorldCoords } from '@/src/vtk/ToolWidgetUtils/utils';

export enum InteractionState {
  PlacingFirst = 'PlacingFirst',
  PlacingSecond = 'PlacingSecond',
  Select = 'Select',
  Dragging = 'Dragging',
  Moving = 'Moving',
}

export function shouldIgnoreEvent(e: any) {
  return e.altKey || e.controlKey || e.shiftKey;
}

export default function widgetBehavior(publicAPI: any, model: any) {
  model.classHierarchy.push('vtkRulerWidgetProp');

  const anotherWidgetHasFocus = () =>
    model._widgetManager
      .getWidgets()
      .some((w: any) => w !== publicAPI && w.hasFocus());

  model.interactionState = InteractionState.Select;
  let draggingState: any = null;
  let moveStartCoords: Vector3 | null = null;
  let moveFirstOrigin: Vector3 | null = null;
  let moveSecondOrigin: Vector3 | null = null;

  macro.setGet(publicAPI, model, ['interactionState']);
  // support setting per-view widget manipulators
  macro.setGet(publicAPI, model, ['manipulator']);
  // support forwarding events
  macro.event(publicAPI, model, 'RightClickEvent');
  macro.event(publicAPI, model, 'PlacedEvent');
  macro.event(publicAPI, model, 'HoverEvent');

  publicAPI.deactivateAllHandles = () => {
    model.widgetState.deactivate();
    model.activeState = null;
  };

  publicAPI.setFirstPoint = (coord: Vector3) => {
    const point = model.widgetState.getFirstPoint();
    point.setOrigin(coord);
  };

  publicAPI.setSecondPoint = (coord: Vector3) => {
    const point = model.widgetState.getSecondPoint();
    point.setOrigin(coord);
  };

  const originalSetInteractionState = publicAPI.setInteractionState;
  publicAPI.setInteractionState = (state: InteractionState) => {
    const changed = originalSetInteractionState(state);
    if (changed && state === InteractionState.PlacingFirst) {
      model.widgetState.setIsPlaced(false);
      model.widgetState.getFirstPoint().setVisible(false);
      model.widgetState.getSecondPoint().setVisible(false);
    }
    return changed;
  };

  publicAPI.resetInteractions = () => {
    model._interactor.cancelAnimation(publicAPI, true);
  };

  // Check if mouse is over line segment between handles
  const checkOverSegment = () => {
    const selections = model._widgetManager.getSelections();
    const overSegment =
      selections[0]?.getProperties().prop ===
      model.representations[1].getActors()[0]; // line representation is second representation
    return overSegment;
  };

  // Check if mouse is over fill representation (for hover but not interaction)
  const checkOverFill = () => {
    const selections = model._widgetManager.getSelections();
    return (
      model.representations[2] &&
      selections?.[0]?.getProperties().prop ===
        model.representations[2].getActors()[0]
    );
  };

  const getWorldCoords = computeWorldCoords(model);

  /**
   * Places or drags a point.
   */
  publicAPI.handleLeftButtonPress = (eventData: any) => {
    if (!model.manipulator || shouldIgnoreEvent(eventData)) {
      return macro.VOID;
    }

    // turns off hover while dragging
    publicAPI.invokeHoverEvent({
      ...eventData,
      hovering: false,
    });

    const intState = publicAPI.getInteractionState();

    // If not placing and another widget is active, don't consume event.
    const activeWidget = model._widgetManager.getActiveWidget();
    if (
      intState === InteractionState.Select &&
      activeWidget &&
      activeWidget !== publicAPI
    ) {
      return macro.VOID;
    }

    const worldCoords = getWorldCoords(eventData);
    if (!worldCoords?.length) {
      return macro.VOID;
    }

    if (intState === InteractionState.PlacingFirst) {
      publicAPI.setFirstPoint(worldCoords);
      publicAPI.setSecondPoint(worldCoords);
      model.widgetState.getFirstPoint().setVisible(true);
      model.widgetState.getSecondPoint().setVisible(true);

      model._interactor.requestAnimation(publicAPI);
      publicAPI.invokeStartInteractionEvent();
      publicAPI.setInteractionState(InteractionState.PlacingSecond);
      return macro.EVENT_ABORT;
    }

    if (intState === InteractionState.PlacingSecond) {
      publicAPI.setSecondPoint(worldCoords);
      model.widgetState.setIsPlaced(true);

      publicAPI.setInteractionState(InteractionState.Select);
      publicAPI.invokeEndInteractionEvent();
      publicAPI.invokePlacedEvent();

      model._interactor.cancelAnimation(publicAPI);
      return macro.EVENT_ABORT;
    }

    // Move entire annotation when clicking on fill or segment
    if (
      intState === InteractionState.Select &&
      model.pickable &&
      (checkOverFill() || checkOverSegment())
    ) {
      moveStartCoords = worldCoords as Vector3;
      moveFirstOrigin = model.widgetState
        .getFirstPoint()
        .getOrigin()
        .slice() as Vector3;
      moveSecondOrigin = model.widgetState
        .getSecondPoint()
        .getOrigin()
        .slice() as Vector3;
      publicAPI.setInteractionState(InteractionState.Moving);
      model._apiSpecificRenderWindow.setCursor('grabbing');
      model._interactor.requestAnimation(publicAPI);
      publicAPI.invokeStartInteractionEvent();
      return macro.EVENT_ABORT;
    }

    // dragging a single handle
    if (
      model.activeState?.getActive() &&
      model.activeState?.setOrigin &&
      model.pickable &&
      !checkOverSegment()
    ) {
      draggingState = model.activeState;
      publicAPI.setInteractionState(InteractionState.Dragging);
      model._apiSpecificRenderWindow.setCursor('grabbing');
      model._interactor.requestAnimation(publicAPI);
      publicAPI.invokeStartInteractionEvent();
      return macro.EVENT_ABORT;
    }

    return macro.VOID;
  };

  /**
   * Moves a point around.
   */
  publicAPI.handleMouseMove = (eventData: any) => {
    const worldCoords = getWorldCoords(eventData);
    if (!worldCoords?.length) {
      return macro.VOID;
    }

    const intState = publicAPI.getInteractionState();

    if (intState === InteractionState.PlacingSecond) {
      model.widgetState.getSecondPoint().setOrigin(worldCoords);
      // show second point during placement
      model.widgetState.getSecondPoint().setVisible(true);
      publicAPI.invokeInteractionEvent();
      return macro.EVENT_ABORT;
    }

    if (intState === InteractionState.Moving && moveStartCoords) {
      const dx = worldCoords[0] - moveStartCoords[0];
      const dy = worldCoords[1] - moveStartCoords[1];
      const dz = worldCoords[2] - moveStartCoords[2];
      model.widgetState.getFirstPoint().setOrigin([
        moveFirstOrigin![0] + dx,
        moveFirstOrigin![1] + dy,
        moveFirstOrigin![2] + dz,
      ]);
      model.widgetState.getSecondPoint().setOrigin([
        moveSecondOrigin![0] + dx,
        moveSecondOrigin![1] + dy,
        moveSecondOrigin![2] + dz,
      ]);
      publicAPI.invokeInteractionEvent();
      return macro.EVENT_ABORT;
    }

    if (
      publicAPI.getInteractionState() === InteractionState.Dragging &&
      draggingState
    ) {
      draggingState.setOrigin(worldCoords);
      publicAPI.invokeInteractionEvent();
      return macro.EVENT_ABORT;
    }

    if (anotherWidgetHasFocus()) {
      publicAPI.invokeHoverEvent({
        ...eventData,
        hovering: false,
      });
      return macro.VOID;
    }

    publicAPI.invokeHoverEvent({
      ...eventData,
      hovering: !!model.activeState || checkOverFill(),
    });

    return macro.VOID;
  };

  /**
   * Finishes dragging
   */
  publicAPI.handleLeftButtonRelease = (eventData: any) => {
    // Finish moving entire annotation
    if (moveStartCoords) {
      const worldCoords = getWorldCoords(eventData);
      if (worldCoords?.length) {
        const dx = worldCoords[0] - moveStartCoords[0];
        const dy = worldCoords[1] - moveStartCoords[1];
        const dz = worldCoords[2] - moveStartCoords[2];
        model.widgetState.getFirstPoint().setOrigin([
          moveFirstOrigin![0] + dx,
          moveFirstOrigin![1] + dy,
          moveFirstOrigin![2] + dz,
        ]);
        model.widgetState.getSecondPoint().setOrigin([
          moveSecondOrigin![0] + dx,
          moveSecondOrigin![1] + dy,
          moveSecondOrigin![2] + dz,
        ]);
      }

      moveStartCoords = null;
      moveFirstOrigin = null;
      moveSecondOrigin = null;
      publicAPI.setInteractionState(InteractionState.Select);
      model._apiSpecificRenderWindow.setCursor('pointer');
      model.widgetState.deactivate();
      model._interactor.cancelAnimation(publicAPI);
      publicAPI.invokeEndInteractionEvent();
      model._widgetManager.enablePicking();
    }

    // Finish dragging a single handle
    if (draggingState) {
      const worldCoords = getWorldCoords(eventData);
      if (worldCoords?.length) {
        draggingState.setOrigin(worldCoords);
      }

      draggingState = null;
      publicAPI.setInteractionState(InteractionState.Select);
      model._apiSpecificRenderWindow.setCursor('pointer');
      model.widgetState.deactivate();
      model._interactor.cancelAnimation(publicAPI);
      publicAPI.invokeEndInteractionEvent();
      model._widgetManager.enablePicking();
    }
  };

  publicAPI.handleRightButtonPress = (eventData: any) => {
    if (
      shouldIgnoreEvent(eventData) ||
      publicAPI.getInteractionState() !== InteractionState.Select ||
      !model.activeState
    ) {
      return macro.VOID;
    }

    if (anotherWidgetHasFocus()) {
      return macro.VOID;
    }

    publicAPI.invokeRightClickEvent(eventData);
    return macro.EVENT_ABORT;
  };

  publicAPI.grabFocus = () => {
    throw new Error('grabFocus is not implemented');
  };

  publicAPI.loseFocus = () => {
    throw new Error('loseFocus is not implemented');
  };

  publicAPI.delete = macro.chain(() => {
    publicAPI.resetInteractions();
  }, publicAPI.delete);
}
