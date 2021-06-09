import vtkGenericRenderWindow from "vtk.js/Sources/Rendering/Misc/GenericRenderWindow";
import vtkColorTransferFunction from "vtk.js/Sources/Rendering/Core/ColorTransferFunction";
import vtkPiecewiseFunction from "vtk.js/Sources/Common/DataModel/PiecewiseFunction";
import vtkColorMaps from "vtk.js/Sources/Rendering/Core/ColorTransferFunction/ColorMaps";

import vtkMouseCameraTrackballRotateManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseCameraTrackballRotateManipulator";
import vtkMouseCameraTrackballPanManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseCameraTrackballPanManipulator";
import vtkMouseCameraTrackballZoomManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseCameraTrackballZoomManipulator";
import vtkMouseRangeManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseRangeManipulator";
import vtkInteractorStyleManipulator from "vtk.js/Sources/Interaction/Style/InteractorStyleManipulator";

import vtkPointPicker from "vtk.js/Sources/Rendering/Core/PointPicker";
import vtkCoordinate from "vtk.js/Sources/Rendering/Core/Coordinate";

import {
  createVolumeActor,
  getAbsoluteRange,
  getRelativeRange,
  setCamera,
  setActorProperties,
  setupPGwidget,
  setupCropWidget,
  setupPickingPlane
} from "./utils/utils";
import { applyStrategy } from "./utils/strategies";

import { createPreset } from "./utils/colormaps";

// Add custom presets
vtkColorMaps.addPreset(createPreset());

//TODO interactions:

/**
 * setTool("Length/Angle", {mouseButtonMask:1}, measurementState); => per cambiare interactors tasto sx
 * setupMouseButtons(config); => inizializzare il tasto dx del mouse
 * measurementState = {
 *  p1: [0, 0],
 *  p2: [0, 0],
 *  p3: [0, 0],
 *  label: `string`
 * }
 */

/** A class representing a Volume Rendering scene */
export class VRView {
  /**
   * Create a volume rendering scene
   * @param {HTMLElement} element - the target html element to render the scene
   */
  constructor(element) {
    this.VERBOSE = false;

    this.element = element;
    this.renderer = null;
    this.renderWindow = null;
    this._genericRenderWindow = null;
    this.actor = null;
    this._raysDistance = null;
    this._blurOnInteraction = null;

    // piecewise gaussian widget stuff
    this.PGwidgetElement = null;
    this.PGwidget = null;
    this.gaussians = null;
    this._PGwidgetLoaded = false;

    // crop widget
    this._cropWidget = null;

    // normalized ww wl
    this.ww = 0.1;
    this.wl = 0.4;

    // absolute ww wl
    this.wwwl = [0, 0];

    // LUT options
    this._rangeLUT = null;
    this._rescaleLUT = false; // cannot initialize true (must set lut before)

    // measurement state
    this._measurementState = null;

    this.initVR();
  }

  /**
   * wwwl
   * @type {Array}
   */
  set wwwl(value) {
    if (!this.actor) {
      return;
    }

    let relativeWwwl = getRelativeRange(this.actor, value);

    this.wl = relativeWwwl.wl;
    this.ww = relativeWwwl.ww;

    if (this.PGwidget) {
      this.updateWidget();
    }
  }

  get wwwl() {
    let absoluteWwwl = getAbsoluteRange(this.actor, [this.ww, this.wl]);
    return [absoluteWwwl.ww, absoluteWwwl.wl];
  }

  /**
   * raysDistance
   * @type {Number}
   */
  set resolution(value) {
    this._raysDistance = 1 / value;
    this.actor.getMapper().setSampleDistance(this._raysDistance);
    let maxSamples = value > 1 ? value * 1000 : 1000;
    this.actor.getMapper().setMaximumSamplesPerRay(maxSamples);
    this.renderWindow.render();
  }

  get resolution() {
    return Math.round(1 / this._raysDistance);
  }

  /**
   * Presets
   * @type {Array}
   */
  get presetsList() {
    return vtkColorMaps.rgbPresetNames;
  }

  /**
   * PGwidgetElement (set null to hide)
   * @type {HTMLelement}
   */
  set widgetElement(element) {
    this.PGwidgetElement = element;
    let h = element.offsetHeight ? element.offsetHeight - 5 : 100;
    let w = element.offsetWidth ? element.offsetWidth - 5 : 300;
    this.PGwidget.setSize(w, h);
    this.PGwidget.setContainer(this.PGwidgetElement);
    this.PGwidget.render();
  }

  /**
   * Flag to set lut rescaling on opacity range
   * @type {bool}
   */
  set rescaleLUT(bool) {
    this._rescaleLUT = bool;
    let range;
    if (this._rescaleLUT && this.PGwidget) {
      range = this.PGwidget.getOpacityRange();
    } else {
      range = this.actor
        .getMapper()
        .getInputData()
        .getPointData()
        .getScalars()
        .getRange();
    }
    this.ctfun.setMappingRange(...range);
    this.ctfun.updateRange();
  }

  /**
   * Set range to apply lut  !!! WIP
   * @type {Array}
   */
  set rangeLUT([min, max]) {
    this._rangeLUT = [min, max];
    this.actor
      .getProperty()
      .getRGBTransferFunction(0)
      .setMappingRange(min, max);
  }

  /**
   * Crop widget on / off
   * @type {bool}
   */
  set cropWidget(visible) {
    if (!this._cropWidget) this._initCropWidget();
    this._cropWidget.setVisibility(visible);
    this._widgetManager.renderWidgets();
    this.renderWindow.render();
  }

  /**
   * Set colormap and opacity function
   * lutName - as in presets list
   * @type {String}
   */
  set lut(lutName) {
    // set up color transfer function
    const lookupTable = vtkColorTransferFunction.newInstance();
    lookupTable.applyColorMap(vtkColorMaps.getPresetByName(lutName));

    // update lookup table mapping range based on input dataset
    let range;

    if (this._rescaleLUT && this._PGwidgetLoaded) {
      range = this.PGwidget.getOpacityRange();
    } else {
      range = this.actor
        .getMapper()
        .getInputData()
        .getPointData()
        .getScalars()
        .getRange();
    }

    // TODO a function to set custom mapping range (unbind from opacity)
    lookupTable.setMappingRange(...range);
    lookupTable.updateRange();

    this.actor.getProperty().setRGBTransferFunction(0, lookupTable);

    // setup opacity function (values will be set by PGwidget)
    const piecewiseFun = vtkPiecewiseFunction.newInstance();
    this.actor.getProperty().setScalarOpacity(0, piecewiseFun);

    this.ctfun = lookupTable;
    this.ofun = piecewiseFun;

    this.updateWidget();
  }

  /**
   * Toggle blurring on interaction (Increase performance)
   * @type {bool} toggle - if true, blur on interaction
   */
  set blurOnInteraction(toggle) {
    this._blurOnInteraction = toggle;
    let interactor = this.renderWindow.getInteractor();
    let mapper = this.actor.getMapper();

    if (toggle) {
      interactor.onLeftButtonPress(() => {
        mapper.setSampleDistance(this._raysDistance * 5);
      });

      interactor.onLeftButtonRelease(() => {
        mapper.setSampleDistance(this._raysDistance);
        // update picking plane
        let camera = this.renderer.getActiveCamera();
        if (this._pickingPlane)
          this._pickingPlane.setNormal(camera.getDirectionOfProjection());
        this.renderWindow.render();
      });
    } else {
      interactor.onLeftButtonPress(() => {
        mapper.setSampleDistance(this._raysDistance);
      });

      interactor.onLeftButtonRelease(() => {
        mapper.setSampleDistance(this._raysDistance);
        // update picking plane
        let camera = this.renderer.getActiveCamera();
        if (this._pickingPlane)
          this._pickingPlane.setNormal(camera.getDirectionOfProjection());
        this.renderWindow.render();
      });
    }
  }

  /**
   * Initialize rendering scene
   * @private
   */
  initVR() {
    const genericRenderWindow = vtkGenericRenderWindow.newInstance();
    genericRenderWindow.setContainer(this.element);
    genericRenderWindow.setBackground([0, 0, 0]);

    //add custom resize cb
    genericRenderWindow.onResize(() => {
      // bypass genericRenderWindow resize method (do not consider devicePixelRatio)
      // https://kitware.github.io/vtk-js/api/Rendering_Misc_GenericRenderWindow.html
      let size = [
        genericRenderWindow.getContainer().getBoundingClientRect().width,
        genericRenderWindow.getContainer().getBoundingClientRect().height
      ];
      genericRenderWindow
        .getRenderWindow()
        .getViews()[0]
        .setSize(size);

      if (this.VERBOSE) console.log("resize", size);
    });

    // resize callback
    window.addEventListener("resize", evt => {
      genericRenderWindow.resize();
    });

    genericRenderWindow.resize();

    this.renderer = genericRenderWindow.getRenderer();
    this.renderWindow = genericRenderWindow.getRenderWindow();
    this._genericRenderWindow = genericRenderWindow;

    // initalize piecewise gaussian widget
    this.PGwidget = setupPGwidget(this.PGwidgetElement);
  }

  /**
   * Set the image to be rendered
   * @param {ArrayBuffer} image - The image content data as buffer array
   */
  setImage(image) {
    // clean scene
    this.renderer.removeAllVolumes();
    let actor = createVolumeActor(image);
    this.actor = actor;
    this.lut = "Grayscale";
    this.resolution = 2;
    this.renderer.addVolume(actor);

    // center camera on new volume
    this.renderer.resetCamera();
    setCamera(this.renderer.getActiveCamera(), actor.getCenter());

    if (this.PGwidget) {
      this.updateWidget();
      this.setWidgetCallbacks();
    }

    // TODO if crop widget, update to new image (or set to null so that it will be initialized again)

    // TODO implement a strategy to set rays distance
    setActorProperties(this.actor);

    this.setupInteractor();

    this.blurOnInteraction = true;

    this._genericRenderWindow.resize();
    this.renderWindow.render();
  }

  /**
   * Get vtk LUTs list
   * @returns {Array} - Lut list as array of strings
   */
  getLutList() {
    return vtkColorMaps.rgbPresetNames;
  }

  /**
   * Setup crop widget
   */
  _initCropWidget() {
    let cropWidget = setupCropWidget(this.renderer, this.actor.getMapper());

    this._widgetManager = cropWidget.widgetManager;
    this._cropWidget = cropWidget.widget;

    this.renderWindow.render();
  }

  /**
   * Update the PGwidget after an image has been loaded
   * @private
   */
  updateWidget() {
    const dataArray = this.actor
      .getMapper()
      .getInputData()
      .getPointData()
      .getScalars();

    this.PGwidget.setDataArray(dataArray.getData());

    let gaussians = this.PGwidget.getGaussians();

    if (gaussians.length > 0) {
      let gaussian = gaussians[0];

      gaussian.position = this.wl;
      gaussian.width = this.ww;

      this.PGwidget.setGaussians([gaussian]);
    } else {
      // TODO initilize in a smarter way
      const default_opacity = 1.0;
      const default_bias = 0.0; // xBias
      const default_skew = 1.8; // yBias
      this.PGwidget.addGaussian(
        this.wl,
        default_opacity,
        this.ww,
        default_bias,
        default_skew
      ); // x, y, ampiezza, sbilanciamento, andamento
    }

    this.PGwidget.applyOpacity(this.ofun);
    this.PGwidget.setColorTransferFunction(this.ctfun);
    this.ctfun.onModified(() => {
      this.PGwidget.render();
      this.renderWindow.render();
    });

    this._PGwidgetLoaded = true;
  }

  /**
   * Binds callbacks to user interactions on PGwidget
   * @private
   */
  setWidgetCallbacks() {
    this.PGwidget.bindMouseListeners();

    this.PGwidget.onAnimation(start => {
      if (start) {
        this.renderWindow.getInteractor().requestAnimation(this.PGwidget);
      } else {
        this.renderWindow.getInteractor().cancelAnimation(this.PGwidget);
      }
    });

    this.PGwidget.onOpacityChange(widget => {
      this.PGwidget = widget;
      this.gaussians = widget.getGaussians().slice(); // store
      this.PGwidget.applyOpacity(this.ofun);
      if (!this.renderWindow.getInteractor().isAnimating()) {
        this.renderWindow.render();
      }

      if (this._rescaleLUT && this.PGwidget) {
        const range = this.PGwidget.getOpacityRange();
        this.ctfun.setMappingRange(...range);
        this.ctfun.updateRange();
      }
    });
  }

  /**
   * Init interactor
   * @private
   */
  setupInteractor() {
    // TODO setup from user
    const rotateManipulator = vtkMouseCameraTrackballRotateManipulator.newInstance(
      { button: 1 }
    );
    const panManipulator = vtkMouseCameraTrackballPanManipulator.newInstance({
      button: 3,
      control: true
    });
    const zoomManipulator = vtkMouseCameraTrackballZoomManipulator.newInstance({
      button: 3,
      scrollEnabled: true
    });
    const rangeManipulator = vtkMouseRangeManipulator.newInstance({
      button: 1,
      shift: true
    });

    let self = this;

    function getWL() {
      return self.wl;
    }

    function getWW() {
      return self.ww;
    }

    function setWL(v) {
      let wl = self.wl + (v - self.wl) / 25;
      self.wl = wl;

      let gaussians = self.PGwidget.getGaussians().slice(); // NOTE: slice() to clone!
      gaussians[0].position = self.wl; //TODO: foreach
      self.PGwidget.setGaussians(gaussians);
    }

    function setWW(v) {
      let ww = self.ww + (v - self.ww) / 5;
      self.ww = ww;

      let gaussians = self.PGwidget.getGaussians().slice(); // NOTE: slice() to clone!
      gaussians[0].width = self.ww; //TODO: foreach
      self.PGwidget.setGaussians(gaussians);
    }

    rangeManipulator.setVerticalListener(-1, 1, 0.001, getWL, setWL);
    rangeManipulator.setHorizontalListener(0.1, 2.1, 0.001, getWW, setWW);

    const interactorStyle = vtkInteractorStyleManipulator.newInstance();
    interactorStyle.addMouseManipulator(rangeManipulator);
    interactorStyle.addMouseManipulator(rotateManipulator);
    interactorStyle.addMouseManipulator(panManipulator);
    interactorStyle.addMouseManipulator(zoomManipulator);
    interactorStyle.setCenterOfRotation(this.actor.getCenter());
    this.renderWindow.getInteractor().setInteractorStyle(interactorStyle);

    // clear measurements on interactions
    this.renderWindow
      .getInteractor()
      .onMouseWheel(() => this.resetMeasurementState());
    this.renderWindow
      .getInteractor()
      .onRightButtonPress(() => this.resetMeasurementState());
  }

  /**
   * Reset measurement state to default
   * @param {*} measurementState
   */
  resetMeasurementState(state) {
    if (this._measurementState) {
      this._measurementState.p1 = new Array(2);
      this._measurementState.p2 = new Array(2);
      this._measurementState.p3 = new Array(2);
      this._measurementState.p1_world = new Array(2);
      this._measurementState.p2_world = new Array(2);
      this._measurementState.p3_world = new Array(2);
      this._measurementState.label = null;
    } else if (state) {
      state.p1 = new Array(2);
      state.p2 = new Array(2);
      state.p3 = new Array(2);
      state.p1_world = new Array(2);
      state.p2_world = new Array(2);
      state.p3_world = new Array(2);
      state.label = null;
    }
  }

  /**
   * Set active tool
   * ("Length/Angle", {mouseButtonMask:1}, measurementState)
   * * @param {*} toolName
   * @param {*} options
   * @param {*} measurementState
   */
  setTool(toolName, options, measurementState) {
    if (this._leftButtonCb) {
      this._leftButtonCb.unsubscribe();
    }

    switch (toolName) {
      case "Length":
        this._initPicker(measurementState, toolName);
        break;
      case "Angle":
        this._initPicker(measurementState, toolName);
        break;
      case "Rotation":
        this.resetMeasurementState(measurementState);
        this.setupInteractor();
        break;
      default:
        console.warn("No tool found for", toolName);
    }
  }

  /**
   * initPicker
   */
  _initPicker(state, mode) {
    // no blur when measure
    this.blurOnInteraction = false;

    // de-activate rotation
    let rotateManipulator = this.renderWindow
      .getInteractor()
      .getInteractorStyle()
      .getMouseManipulators()
      .filter(i => {
        return i.getClassName() == "vtkMouseCameraTrackballRotateManipulator";
      })
      .pop();
    this.renderWindow
      .getInteractor()
      .getInteractorStyle()
      .removeMouseManipulator(rotateManipulator);

    // ----------------------------------------------------------------------------
    // Setup picking interaction
    // ----------------------------------------------------------------------------
    // TODO this is slow the first time we pick, maybe we could use cellPicker and decrease resolution
    const picker = vtkPointPicker.newInstance();
    picker.setPickFromList(1);
    picker.initializePickList();

    if (!this._pickingPlane) {
      // add a 1000x1000 plane
      let camera = this.renderer.getActiveCamera();
      let { plane, planeActor } = setupPickingPlane(camera, this.actor);
      this.renderer.addActor(planeActor);
      this._pickingPlane = plane;
      this._planeActor = planeActor;
    }

    // add picking plane to pick list
    picker.addPickList(this._planeActor);

    // Pick on mouse left click
    this._leftButtonCb = this.renderWindow
      .getInteractor()
      .onLeftButtonPress(callData => {
        if (this.renderer !== callData.pokedRenderer) {
          return;
        }

        const pos = callData.position;
        const point = [pos.x, pos.y, 0.0];
        picker.pick(point, this.renderer);

        if (picker.getActors().length === 0) {
          const pickedPoint = picker.getPickPosition();
          if (this.VERBOSE)
            console.log(`No point picked, default: ${pickedPoint}`);
          // addSphereInPoint(pickedPoint, this.renderer);
        } else {
          const pickedPoints = picker.getPickedPositions();
          const pickedPoint = pickedPoints[0]; // always a single point on a plane
          if (this.VERBOSE) console.log(`Picked: ${pickedPoint}`);
          // addSphereInPoint(pickedPoint, this.renderer);

          // canvas coord
          const wPos = vtkCoordinate.newInstance();
          wPos.setCoordinateSystemToWorld();
          wPos.setValue(...pickedPoint);
          const displayPosition = wPos.getComputedDisplayValue(this.renderer);

          // apply changes on state based on active tool
          applyStrategy(state, displayPosition, pickedPoint, mode);

          if (this.VERBOSE) console.log(state);
          this._measurementState = state;
        }

        this.renderWindow.render();
      });
  }

  /**
   * Reset view
   */
  resetView() {
    let center = this.actor.getCenter();
    let camera = this.renderer.getActiveCamera();
    setCamera(camera, center);
    this.renderWindow.render();
  }

  /**
   * on resize callback
   */
  resize() {
    // TODO: debounce for performance reasons?
    this._genericRenderWindow.resize();
  }

  /**
   * Destroy webgl content and release listeners
   */
  destroy() {
    this.element = null;
    this._genericRenderWindow.delete();
    this._genericRenderWindow = null;

    if (this.actor) {
      this.actor.getMapper().delete();
      this.actor.delete();
      this.actor = null;
    }

    if (this._planeActor) {
      this._planeActor.getMapper().delete();
      this._planeActor.delete();
      this._planeActor = null;
    }

    if (this.PGwidgetElement) {
      this.PGwidgetElement = null;
      this.PGwidget.getCanvas().remove();
      this.PGwidget.delete();
      this.PGwidget = null;
      this.gaussians = null;
    }

    if (this._cropWidget) {
      this._cropWidget.delete();
      this._cropWidget = null;
    }
  }
}
