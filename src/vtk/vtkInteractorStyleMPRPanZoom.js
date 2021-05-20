import macro from "vtk.js/Sources/macro";
import vtkMouseCameraTrackballPanManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseCameraTrackballPanManipulator";
import vtkMouseCameraTrackballZoomManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseCameraTrackballZoomManipulator";
import vtkMouseRangeManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseRangeManipulator";
import Constants from "vtk.js/Sources/Rendering/Core/InteractorStyle/Constants";

import vtkInteractorStyleMPRSlice from "./vtkInteractorMPRSlice.js";

const { States } = Constants;

// ----------------------------------------------------------------------------
// Global methods
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// vtkInteractorStyleMPRPan methods
// ----------------------------------------------------------------------------

function vtkInteractorStyleMPRPanZoom(publicAPI, model) {
  // Set our className
  model.classHierarchy.push("vtkInteractorStyleMPRPanZoom");

  // set fixed manipulators
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

  // TODO: The inherited zoom manipulator does not appear to be working?
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
    publicAPI.addMouseManipulator(model.panManipulatorShift);
    publicAPI.addMouseManipulator(model.panManipulatorCtrl);
    publicAPI.addMouseManipulator(model.zoomManipulator);
    publicAPI.addMouseManipulator(model.scrollManipulator);
    publicAPI.addMouseManipulator(model.leftManipulator);
    updateScrollManipulator();
  }

  publicAPI.setLeftButton = tool => {
    console.log("set left button", tool);
    if (tool == "zoom") {
      model.leftManipulator = vtkMouseCameraTrackballZoomManipulator.newInstance(
        {
          button: 1
        }
      );
    } else if (tool == "pan") {
      model.leftManipulator = vtkMouseCameraTrackballPanManipulator.newInstance(
        {
          button: 1
        }
      );
    } else {
      console.error("No tool found for", tool);
    }
    setManipulators();
  };

  // set default left button manipulator
  console.log(model);
  if (!model.leftButtonTool) {
    model.leftButtonTool = "pan";
  }
  publicAPI.setLeftButton(model.leftButtonTool);

  setManipulators();

  console.log(States);
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  wlStartPos: [0, 0],
  levelScale: 1
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Inheritance
  vtkInteractorStyleMPRSlice.extend(publicAPI, model, initialValues);

  macro.setGet(publicAPI, model, [
    "volumeMapper",
    "onLevelsChanged",
    "levelScale"
  ]);

  // Object specific methods
  vtkInteractorStyleMPRPanZoom(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  "vtkInteractorStyleMPRPanZoom"
);

// ----------------------------------------------------------------------------

export default Object.assign({ newInstance, extend });
