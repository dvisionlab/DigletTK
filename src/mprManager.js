// Use modified MPRSlice interactor
import vtkInteractorStyleMPRWindowLevel from "./vtk/vtkInteractorStyleMPRWindowLevel";
import vtkInteractorStyleMPRCrosshairs from "./vtk/vtkInteractorStyleMPRCrosshairs";
import vtkInteractorStyleMPRPanZoom from "./vtk/vtkInteractorStyleMPRPanZoom";
import vtkCoordinate from "vtk.js/Sources/Rendering/Core/Coordinate";
import vtkMatrixBuilder from "vtk.js/Sources/Common/Core/MatrixBuilder";

import {
  getPlaneIntersection,
  getVolumeCenter,
  createVolumeActor
} from "./utils";

import { MPRView } from "./mprView";

window.istyle = {};

/**
 * Internal state of a single view
 * @typedef {Object} State
 * @property {Number[]} slicePlaneNormal - The slice plane normal as [x,y,z]
 * @property {Number[]} sliceViewUp - The up vector as [x,y,z]
 * @property {Number} slicePlaneXRotation - The x axis rotation in deg
 * @property {Number} slicePlaneYRotation - The y axis rotation in deg
 * @property {Number} viewRotation - The view rotation in deg
 * @property {Number} sliceThickness - The MIP slice thickness in px
 * @property {String} blendMode - The active blending mode ("MIP", "MinIP", "Average")
 * @property {Object} window - wwwl
 * @property {Number} window.ww - Window width
 * @property {Number} window.wl - Window level
 */

/** A manager for MPR views */
export class MPRManager {
  /**
   * Create a manager.
   * @param {Object} elements - The 3 target HTML elements {key1:{}, key2:{}, key3:{}}.
   * @param {HTMLElement} elements.element - The target HTML elements.
   * @param {String} elements.key - The target HTML elements.
   */
  constructor(elements) {
    this.VERBOSE = false; // TODO setter
    this.syncWindowLevels = true; // TODO setter
    this._activeTool = null;

    // TODO input sanity check

    this.elements = elements;

    this.volume = null;

    this.sliceIntersection = [0, 0, 0];

    this.mprViews = {};

    this.initMPR();

    // FOR DEV
    window.mpr = this;
  }

  /**
   * wwwl
   * @type {Array}
   */
  set wwwl([ww, wl]) {
    Object.keys(this.elements).forEach((key, i) => {
      this.mprViews[key].wwwl = [ww, wl];
    });
  }

  /**
   * Initialize the three MPR views
   * @private
   */
  initMPR() {
    Object.keys(this.elements).forEach((key, i) => {
      try {
        this.mprViews[key] = new MPRView(key, i, this.elements[key].element);
      } catch (err) {
        console.error("Error creating MPRView", key);
        console.error(err);
      }
    });

    if (this.VERBOSE) console.log("initialized");
  }

  /**
   * Get initial State object
   * @returns {State} The initial internal state
   */
  getInitialState() {
    // cycle on keys, and reduce extracting only useful properties
    // NOTE: initialize reduce with cloned object!
    let viewsState = Object.keys(this.mprViews).reduce((result, key) => {
      let {
        slicePlaneNormal,
        sliceViewUp,
        slicePlaneXRotation,
        slicePlaneYRotation,
        viewRotation,
        _sliceThickness,
        _blendMode,
        window
      } = result[key];
      result[key] = {
        slicePlaneNormal,
        sliceViewUp,
        slicePlaneXRotation,
        slicePlaneYRotation,
        viewRotation,
        sliceThickness: _sliceThickness,
        blendMode: _blendMode,
        window
      };
      return result;
    }, Object.assign({}, this.mprViews));

    return {
      // interactorCenters: { top: [0, 0], left: [0, 0], front: [0, 0] },
      interactorCenters: Object.keys(this.elements).reduce(
        (res, key) => ({ ...res, [key]: [0, 0] }),
        {}
      ),
      sliceIntersection: [...this.sliceIntersection], // clone
      views: viewsState
    };
  }

  /**
   * Set the image to render
   * @param {State} state - The current manager state
   * @param {Array} image - The pixel data from DICOM serie
   */
  setImage(state, image) {
    let actor = createVolumeActor(image);
    this.volume = actor;
    this.sliceIntersection = getVolumeCenter(actor.getMapper());
    // update external state
    state.sliceIntersection = [...this.sliceIntersection];

    Object.keys(this.elements).forEach(key => {
      this.mprViews[key].initView(
        actor,
        state,
        // on scroll callback (it's fired but too early)
        () => {
          this.onScrolled.call(this, state);
        },
        // on initialized callback (fire when all is set)
        () => {
          this.onScrolled.call(this, state);
        }
      );
    });

    if (this._activeTool) {
      this.setTool(this._activeTool, state);
    }
  }

  /**
   * Set the active tool
   * @param {String} toolName - "level" or "crosshair"
   * @param {State} state - The current manager state
   */
  setTool(toolName, state) {
    switch (toolName) {
      case "level":
        this.setLevelTool(state);
        break;
      case "crosshair":
        this.setCrosshairTool(state);
        break;
      case "zoom":
        this.setZoomTool(state);
        break;
      case "pan":
        this.setPanTool(state);
        break;
    }
  }

  /**
   * Set "pan" as active tool
   * @private
   * @param {State} state - The current manager state
   */
  setPanTool(state) {
    Object.entries(state.views).forEach(([key]) => {
      const istyle = vtkInteractorStyleMPRPanZoom.newInstance({
        leftButtonTool: "pan"
      });
      istyle.setOnScroll(() => {
        this.onScrolled(state);
      });
      // TODO update something if needed
      // istyle.setOnPanChanged(levels => {
      // this.updateLevels({ ...levels, srcKey: key }, state);
      // });
      this.mprViews[key].setInteractor(istyle);
      window.istyle[key] = istyle;
    });
    this._activeTool = "pan";
  }

  /**
   * Set "zoom" as active tool
   * @private
   * @param {State} state - The current manager state
   */
  setZoomTool(state) {
    Object.entries(state.views).forEach(([key]) => {
      const istyle = vtkInteractorStyleMPRPanZoom.newInstance({
        leftButtonTool: "zoom"
      });
      istyle.setOnScroll(() => {
        this.onScrolled(state);
      });
      // TODO update something if needed
      // istyle.setOnZoomChanged(levels => {
      // this.updateLevels({ ...levels, srcKey: key }, state);
      // });
      this.mprViews[key].setInteractor(istyle);
      window.istyle[key] = istyle;
    });
    this._activeTool = "zoom";
  }

  /**
   * Set "pan" as active tool
   * @private
   * @param {State} state - The current manager state
   */
  // setPanTool(state) {
  //   Object.entries(state.views).forEach(([key]) => {
  //     const istyle = vtkInteractorStyleManipulator.newInstance();
  //     const panManipulator = vtkMouseCameraTrackballPanManipulator.newInstance({
  //       button: 1
  //       // control: true
  //     });
  //     istyle.addMouseManipulator(panManipulator);
  //     this.mprViews[key]._renderWindow
  //       .getInteractor()
  //       .setInteractorStyle(istyle);
  //   });
  //   this._activeTool = "pan";
  // }

  /**
   * Set "zoom" as active tool
   * @private
   * @param {State} state - The current manager state
   */
  // setZoomTool(state) {
  //   Object.entries(state.views).forEach(([key]) => {
  //     const istyle = vtkInteractorStyleManipulator.newInstance();
  //     const zoomManipulator = vtkMouseCameraTrackballZoomManipulator.newInstance(
  //       {
  //         button: 1
  //         // scrollEnabled: true
  //       }
  //     );
  //     istyle.addMouseManipulator(zoomManipulator);
  //     this.mprViews[key]._renderWindow
  //       .getInteractor()
  //       .setInteractorStyle(istyle);
  //   });
  //   this._activeTool = "zoom";
  // }

  /**
   * Set "level" as active tool
   * @private
   * @param {State} state - The current manager state
   */
  setLevelTool(state) {
    Object.entries(state.views).forEach(([key]) => {
      const istyle = vtkInteractorStyleMPRWindowLevel.newInstance();
      istyle.setOnScroll(() => {
        this.onScrolled(state);
      });
      istyle.setOnLevelsChanged(levels => {
        this.updateLevels({ ...levels, srcKey: key }, state);
      });
      this.mprViews[key].setInteractor(istyle);
      window.istyle[key] = istyle;
    });
    this._activeTool = "level";
  }

  /**
   * Set "crosshair" as active tool
   * @private
   * @param {State} state - The current manager state
   */
  setCrosshairTool(state) {
    let self = this;
    Object.entries(state.views).forEach(([key]) => {
      const istyle = vtkInteractorStyleMPRCrosshairs.newInstance();
      istyle.setOnScroll(() => {
        self.onScrolled(state);
      });
      istyle.setOnClickCallback(({ worldPos }) => {
        self.onCrosshairPointSelected({ worldPos, srcKey: key }, state);
      });
      this.mprViews[key].setInteractor(istyle);
    });
    this._activeTool = "crosshair";
  }

  /**
   * Update slice positions on user interaction (for crosshair tool)
   * @private
   * @param {Object} {}
   */
  onCrosshairPointSelected({ srcKey, worldPos }, externalState) {
    Object.keys(this.elements).forEach(key => {
      if (key !== srcKey) {
        // We are basically doing the same as getSlice but with the world coordinate
        // that we want to jump to instead of the camera focal point.
        // I would rather do the camera adjustment directly but I keep
        // doing it wrong and so this is good enough for now.
        // ~ swerik
        const renderWindow = this.mprViews[
          key
        ]._genericRenderWindow.getRenderWindow();

        const istyle = renderWindow.getInteractor().getInteractorStyle();
        const sliceNormal = istyle.getSliceNormal();
        const transform = vtkMatrixBuilder
          .buildFromDegree()
          .identity()
          .rotateFromDirections(sliceNormal, [1, 0, 0]);

        const mutatedWorldPos = worldPos.slice();
        transform.apply(mutatedWorldPos);
        const slice = mutatedWorldPos[0];

        istyle.setSlice(slice);

        renderWindow.render();
      }

      this.updateInteractorCenters(externalState);
    });

    // update both internal & external state
    this.sliceIntersection = [...worldPos];
    externalState.sliceIntersection = [...worldPos];
  }

  /**
   * Update wwwl on user interaction (for level tool)
   * @private
   * @param {Object} {}
   * @param {State} state - The current manager state
   */
  updateLevels({ windowCenter, windowWidth, srcKey }, state) {
    state.views[srcKey].window.center = windowCenter;
    state.views[srcKey].window.width = windowWidth;

    if (this.syncWindowLevels) {
      Object.keys(this.elements)
        .filter(key => key !== srcKey)
        .forEach(k => {
          this.mprViews[k].wwwl = [windowWidth, windowCenter];
        });
    }
  }

  /**
   * Update slice position when scrolling
   * @private
   */
  onScrolled(state) {
    let planes = [];

    Object.keys(this.elements).forEach(key => {
      const camera = this.mprViews[key].camera;
      planes.push({
        position: camera.getFocalPoint(),
        normal: camera.getDirectionOfProjection()
        // this[viewportIndex].slicePlaneNormal
      });
    });

    const newPoint = getPlaneIntersection(...planes);

    if (
      !Number.isNaN(newPoint) &&
      !newPoint.some(coord => Number.isNaN(coord))
    ) {
      this.sliceIntersection = [...newPoint];
      state.sliceIntersection = [...newPoint];
      if (this.VERBOSE) console.log("updating slice intersection", newPoint);
    }

    this.updateInteractorCenters(state);

    return newPoint;
  }

  /**
   * Update slice planes on rotation
   * @param {String} key - One of the initially provided keys (identify a view)
   * @param {String} axis - 'x' or 'y' axis
   * @param {Number} angle - The amount of rotation [deg], absolute
   * @param {State} state - The current manager state
   */
  onRotate(key, axis, angle, state) {
    // Match the source axis to the associated plane
    switch (key) {
      case "top":
        if (axis === "x") state.views.front.slicePlaneYRotation = angle;
        else if (axis === "y") state.views.left.slicePlaneYRotation = angle;
        break;
      case "left":
        if (axis === "x") state.views.top.slicePlaneXRotation = angle;
        else if (axis === "y") state.views.front.slicePlaneXRotation = angle;
        break;
      case "front":
        if (axis === "x") state.views.top.slicePlaneYRotation = angle;
        else if (axis === "y") state.views.left.slicePlaneXRotation = angle;
        break;
    }

    // dv: this was a watcher in mpr component, update all except myself ?

    Object.keys(this.elements)
      .filter(c => c !== key)
      .forEach(k => {
        this.mprViews[k].updateSlicePlane(state.views[k]);
      });

    if (this.VERBOSE) console.log("afterOnRotate", state);
  }

  /**
   * Update slice planes on rotation
   * @param {String} key - One of the initially provided keys (identify a view)
   * @param {String} axis - 'x' or 'y' axis
   * @param {Number} thickness - The amount of thickness [px], absolute
   * @param {State} state - The current manager state
   */
  onThickness(key, axis, thickness, state) {
    const shouldBeMIP = thickness > 1;
    let target_view;
    switch (key) {
      case "top":
        if (axis === "x") target_view = "front";
        else if (axis === "y") target_view = "left";
        break;
      case "left":
        if (axis === "x") target_view = "top";
        else if (axis === "y") target_view = "front";
        break;
      case "front":
        if (axis === "x") target_view = "top";
        else if (axis === "y") target_view = "left";
        break;
    }

    // if thickness > 1 switch to MIP
    if (shouldBeMIP && this.mprViews[target_view].blendMode === "none") {
      this.mprViews[target_view].blendMode = "MIP";
      state.mprViews[target_view].blendMode = "MIP";
    }

    // update both internal and external state
    this.mprViews[target_view].sliceThickness = thickness;
    state.views[target_view].sliceThickness = thickness;
  }

  /**
   * Update interactor centers coordinates on canvas
   * @private
   * @param {State} state - The current manager state
   */
  updateInteractorCenters(state) {
    Object.keys(this.elements).forEach(key => {
      // compute interactor centers display position
      const renderer = this.mprViews[key]._genericRenderWindow.getRenderer();
      const wPos = vtkCoordinate.newInstance();
      wPos.setCoordinateSystemToWorld();
      wPos.setValue(...this.sliceIntersection);
      const displayPosition = wPos.getComputedDisplayValue(renderer);
      if (this.VERBOSE) console.log("interactor center", key, displayPosition);
      // set new interactor center on canvas into external state
      state.interactorCenters[key] = displayPosition;
    });
  }

  /**
   * Force views resize
   * @param {String} key - If provided, resize just its view, otherwise all views
   */
  resize(key) {
    if (key) {
      this.mprViews[key].onResize();
    } else {
      Object.values(this.mprViews).forEach(view => {
        view.onResize();
      });
    }
  }

  /**
   * Destroy webgl content and release listeners
   */
  destroy() {
    Object.keys(this.elements).forEach(k => {
      this.mprViews[k].destroy();
    });
  }
}
