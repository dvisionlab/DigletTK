// Use modified MPRSlice interactor
import vtkInteractorStyleMPRWindowLevel from "./vtk/vtkInteractorStyleMPRWindowLevel";
import vtkInteractorStyleMPRCrosshairs from "./vtk/vtkInteractorStyleMPRCrosshairs";
import vtkCoordinate from "vtk.js/Sources/Rendering/Core/Coordinate";
import vtkMatrixBuilder from "vtk.js/Sources/Common/Core/MatrixBuilder";

import {
  getPlaneIntersection,
  getVolumeCenter,
  createVolumeActor
} from "./utils";

import { MPRView } from "./mprView";

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
    this.activeTool = null; // TODO setter

    // TODO input sanity check

    this.elements = elements;

    this.volumes = [];

    this.sliceIntersection = [0, 0, 0];

    this.mprViews = {};

    this.initMPR();
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
        sliceThickness,
        blendMode,
        window
      } = result[key];
      result[key] = {
        slicePlaneNormal,
        sliceViewUp,
        slicePlaneXRotation,
        slicePlaneYRotation,
        viewRotation,
        sliceThickness,
        blendMode,
        window
      };
      return result;
    }, Object.assign({}, this.mprViews));

    return {
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
    this.volumes.push(actor);
    this.sliceIntersection = getVolumeCenter(actor.getMapper());

    Object.keys(this.elements).forEach(key => {
      this.mprViews[key].initView(actor, state, () => {
        console.log(">>>", this);
        this.onScrolled.call(this);
      });
    });

    if (this.activeTool) {
      this.setTool(this.activeTool);
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
    }
  }

  /**
   * Set "level" as active tool
   * @private
   * @param {State} state - The current manager state
   */
  setLevelTool(state) {
    Object.entries(state.views).forEach(([key]) => {
      const istyle = vtkInteractorStyleMPRWindowLevel.newInstance();
      istyle.setOnScroll(() => {
        this.onScrolled();
      });
      istyle.setOnLevelsChanged(levels => {
        this.updateLevels({ ...levels, srcKey: key }, state);
      });
      this.mprViews[key].setInteractor(istyle);
    });
    this.activeTool = "level";
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
        self.onScrolled();
      });
      istyle.setOnClickCallback(({ worldPos }) => {
        self.onCrosshairPointSelected({ worldPos, srcKey: key });
      });
      this.mprViews[key].setInteractor(istyle);
    });
    this.activeTool = "crosshair";
  }

  /**
   * Update slice positions on user interaction (for crosshair tool)
   * @private
   * @param {Object} {}
   */
  onCrosshairPointSelected({ srcKey, worldPos }) {
    Object.keys(this.elements).forEach(key => {
      if (key !== srcKey) {
        // We are basically doing the same as getSlice but with the world coordinate
        // that we want to jump to instead of the camera focal point.
        // I would rather do the camera adjustment directly but I keep
        // doing it wrong and so this is good enough for now.
        // ~ swerik
        const renderWindow = this.mprViews[
          key
        ].genericRenderWindow.getRenderWindow();

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

      const renderer = this.mprViews[key].genericRenderWindow.getRenderer();
      const wPos = vtkCoordinate.newInstance();
      wPos.setCoordinateSystemToWorld();
      wPos.setValue(worldPos);

      const displayPosition = wPos.getComputedDisplayValue(renderer);
    });
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
          state.views[k].window.center = windowCenter;
          state.views[k].window.width = windowWidth;
          this.mprViews[k].genericRenderWindow
            .getInteractor()
            .getInteractorStyle()
            .setWindowLevel(windowWidth, windowCenter);
          this.mprViews[k].genericRenderWindow.getRenderWindow().render();
        });
    }
  }

  /**
   * Update slice position when scrolling
   * @private
   */
  onScrolled() {
    let planes = [];
    console.log("this", this);
    Object.keys(this.elements).forEach(key => {
      const camera = this.mprViews[key].genericRenderWindow
        .getRenderer()
        .getActiveCamera();

      planes.push({
        position: camera.getFocalPoint(),
        normal: camera.getDirectionOfProjection()
        // this[viewportIndex].slicePlaneNormal
      });
    });
    const newPoint = getPlaneIntersection(...planes);
    if (!Number.isNaN(newPoint)) {
      //   global_data.sliceIntersection = newPoint; TODO return sliceIntersection
      if (this.VERBOSE) console.log("updating slice intersection", newPoint);
    }
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
    let view;
    switch (key) {
      case "top":
        if (axis === "x") view = state.views.front;
        else if (axis === "y") view = state.views.left;
        break;
      case "left":
        if (axis === "x") view = state.views.top;
        else if (axis === "y") view = state.views.front;
        break;
      case "front":
        if (axis === "x") view = state.views.top;
        else if (axis === "y") view = state.views.left;
        break;
    }

    view.sliceThickness = thickness;
    // TODO: consts instead of magic strings
    if (shouldBeMIP && view.blendMode === "none") view.blendMode = "MIP";
    // else if(!shouldBeMIP) {
    //   view.blendMode = "none"
    // }

    // dv: ex-watcher mpr
    const istyle = this.mprViews[key].renderWindow
      .getInteractor()
      .getInteractorStyle();
    // set thickness if the current interactor has it (it should, but just in case)
    istyle.setSlabThickness && istyle.setSlabThickness(thickness);
    this.mprViews[key].updateBlendMode(thickness, "MIP");
  }
}
