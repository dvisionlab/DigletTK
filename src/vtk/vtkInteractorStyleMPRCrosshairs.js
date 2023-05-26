/**
 * Extends the vtkInteractorStyleMPRSlice by adding a click handler for selecting a point in rendered space and converting to 3d space, then calling the registered callback to update other views to that same point.
 */

import macro from "@kitware/vtk.js/macro";
import vtkMouseCameraTrackballRotateManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballRotateManipulator";
import vtkMouseCameraTrackballPanManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator";
import vtkMouseCameraTrackballZoomManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator";
import vtkMouseRangeManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator";
import vtkInteractorStyleMPRSlice from "./vtkInteractorMPRSlice.js";
import Constants from "@kitware/vtk.js/Rendering/Core/InteractorStyle/Constants";
import vtkCoordinate from "@kitware/vtk.js/Rendering/Core/Coordinate";

const { States } = Constants;

// ----------------------------------------------------------------------------
// Global methods
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// vtkInteractorStyleMPRCrosshairs methods
// ----------------------------------------------------------------------------

function vtkInteractorStyleMPRCrosshairs(publicAPI, model) {
  // Set our className
  model.classHierarchy.push("vtkInteractorStyleMPRCrosshairs");

  // set fixed manipulators
  model.trackballManipulator =
    vtkMouseCameraTrackballRotateManipulator.newInstance({
      button: 1
    });
  model.panManipulatorShift = vtkMouseCameraTrackballPanManipulator.newInstance(
    {
      button: 3,
      shift: true
    }
  );
  model.panManipulatorCtrl = vtkMouseCameraTrackballPanManipulator.newInstance({
    button: 3,
    control: true
  });
  model.zoomManipulator = vtkMouseCameraTrackballZoomManipulator.newInstance({
    button: 3
  });
  model.scrollManipulator = vtkMouseRangeManipulator.newInstance({
    scrollEnabled: true,
    dragEnabled: false
  });

  function updateScrollManipulator() {
    const range = publicAPI.getSliceRange();
    model.scrollManipulator.removeScrollListener();
    model.scrollManipulator.setScrollListener(
      range[0],
      range[1],
      1,
      publicAPI.getSlice,
      publicAPI.setSlice
    );
  }

  function setManipulators() {
    publicAPI.removeAllMouseManipulators();
    publicAPI.addMouseManipulator(model.trackballManipulator);
    publicAPI.addMouseManipulator(model.panManipulatorShift);
    publicAPI.addMouseManipulator(model.panManipulatorCtrl);
    publicAPI.addMouseManipulator(model.zoomManipulator);
    publicAPI.addMouseManipulator(model.scrollManipulator);
    updateScrollManipulator();
  }

  function launchCallback(callData) {
    // console.log(callData);
    const pos = [callData.position.x, callData.position.y];
    const renderer = callData.pokedRenderer;
    const onClickCallback = publicAPI.getOnClickCallback();
    const dPos = vtkCoordinate.newInstance();
    dPos.setCoordinateSystemToDisplay();
    dPos.setValue(pos[0], pos[1], 0);
    const worldPos = dPos.getComputedWorldValue(renderer);

    if (worldPos.length) {
      onClickCallback({ worldPos, displayPos: pos });
    }

    publicAPI.invokeInteractionEvent({ type: "InteractionEvent" });
  }

  const superHandleMouseMove = publicAPI.handleMouseMove;
  publicAPI.handleMouseMove = callData => {
    if (model.state === States.IS_SLICE) {
      launchCallback(callData);
    }

    if (superHandleMouseMove) {
      superHandleMouseMove(callData);
    }
  };

  const superHandleLeftButtonPress = publicAPI.handleLeftButtonPress;
  publicAPI.handleLeftButtonPress = callData => {
    if (!callData.shiftKey && !callData.controlKey) {
      if (model.volumeMapper) {
        launchCallback(callData);
        publicAPI.startSlice();
      }
    } else if (superHandleLeftButtonPress) {
      superHandleLeftButtonPress(callData);
    }
  };

  const superSetVolumeMapper = publicAPI.setVolumeMapper;
  publicAPI.setVolumeMapper = mapper => {
    if (superSetVolumeMapper(mapper)) {
      const renderer = model._interactor.getCurrentRenderer();
      const camera = renderer.getActiveCamera();
      if (mapper) {
        // prevent zoom manipulator from messing with our focal point
        camera.setFreezeFocalPoint(true);

        // NOTE: Disabling this because it makes it more difficult to switch
        // interactor styles. Need to find a better way to do this!
        //publicAPI.setSliceNormal(...publicAPI.getSliceNormal());
      } else {
        camera.setFreezeFocalPoint(false);
      }
    }
  };

  publicAPI.superHandleLeftButtonRelease = publicAPI.handleLeftButtonRelease;
  publicAPI.handleLeftButtonRelease = () => {
    switch (model.state) {
      case States.IS_SLICE:
        publicAPI.endSlice();
        break;

      default:
        publicAPI.superHandleLeftButtonRelease();
        break;
    }
  };

  setManipulators();
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Inheritance
  vtkInteractorStyleMPRSlice.extend(publicAPI, model, initialValues);

  macro.setGet(publicAPI, model, ["volumeMapper", "onClickCallback"]);

  // Object specific methods
  vtkInteractorStyleMPRCrosshairs(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  "vtkInteractorStyleMPRCrosshairs"
);

// ----------------------------------------------------------------------------

export default Object.assign({ newInstance, extend });
