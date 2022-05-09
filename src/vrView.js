import vtkGenericRenderWindow from "@kitware/vtk.js/Rendering/Misc/GenericRenderWindow";
import vtkColorTransferFunction from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction";
import vtkPiecewiseFunction from "@kitware/vtk.js/Common/DataModel/PiecewiseFunction";
import vtkColorMaps from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps";

import vtkMouseCameraTrackballRotateManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballRotateManipulator";
import vtkMouseCameraTrackballPanManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator";
import vtkMouseCameraTrackballZoomManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator";
import vtkMouseRangeManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator";
import vtkInteractorStyleManipulator from "@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator";

import vtkPointPicker from "@kitware/vtk.js/Rendering/Core/PointPicker";
import vtkCoordinate from "@kitware/vtk.js/Rendering/Core/Coordinate";
import vtkResourceLoader from "@kitware/vtk.js/IO/Core/ResourceLoader";

import {
  createVolumeActor,
  setupPGwidget,
  setCamera,
  setActorProperties,
  setupCropWidget,
  setupPickingPlane,
  getRelativeRange
} from "./utils/utils";
import { applyStrategy } from "./utils/strategies";
import { createPreset } from "./utils/colormaps";
import { getRenderPass } from "./renderPasses";

import { baseView } from "./baseView";

// Add custom presets
vtkColorMaps.addPreset(createPreset());

/** A class representing a Volume Rendering scene */
export class VRView extends baseView {
  /**
   * Create a volume rendering scene
   * @param {HTMLElement} element - the target html element to render the scene
   */
  constructor(element) {
    super();

    this.VERBOSE = false;

    this._element = element;
    this._renderer = null;
    this._renderWindow = null;
    this._genericRenderWindow = null;
    this._actor = null;
    this._raysDistance = null;
    this._blurOnInteraction = null;

    // piecewise gaussian widget stuff
    this._PGwidgetElement = null;
    this._PGwidget = null;
    this._gaussians = null;
    this._PGwidgetLoaded = false;

    // crop widget
    this._cropWidget = null;

    // normalized ww wl
    this._ww = 0.1;
    this._wl = 0.4;

    // absolute ww wl
    this._wwwl = [0, 0];

    // LUT options
    this._rangeLUT = null;
    this._rescaleLUT = false; // cannot initialize true (must set lut before)

    // rendering passes
    this._edgeEnhancement = false;

    // measurement state
    this._measurementState = null;

    this._initVR();
  }

  // ===========================================================
  // ====== setters & getters ==================================
  // ===========================================================

  /**
   * wwwl
   * @type {Array}
   */
  set wwwl(value) {
    if (!this._actor) {
      return;
    }

    let relativeWwwl = getRelativeRange(this._actor, value);

    this._wl = relativeWwwl.wl;
    this._ww = relativeWwwl.ww;

    if (this._PGwidget) {
      this._updateWidget();
    }
  }

  get wwwl() {
    let absoluteWwwl = getAbsoluteRange(this._actor, [this._ww, this._wl]);
    return [absoluteWwwl.ww, absoluteWwwl.wl];
  }

  /**
   * raysDistance
   * @type {Number}
   */
  set resolution(value) {
    this._raysDistance = 1 / value;
    this._actor.getMapper().setSampleDistance(this._raysDistance);
    let maxSamples = value > 1 ? value * 1000 : 1000;
    this._actor.getMapper().setMaximumSamplesPerRay(maxSamples);
    this._renderWindow.render();
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
    this._PGwidgetElement = element;
    let h = element.offsetHeight ? element.offsetHeight - 5 : 100;
    let w = element.offsetWidth ? element.offsetWidth - 5 : 300;
    this._PGwidget.setSize(w, h);
    this._PGwidget.setContainer(this._PGwidgetElement);
    this._PGwidget.render();
  }

  /**
   * Flag to set lut rescaling on opacity range
   * @type {bool}
   */
  set rescaleLUT(bool) {
    this._rescaleLUT = bool;
    let range;
    if (this._rescaleLUT && this._PGwidget) {
      range = this._PGwidget.getOpacityRange();
    } else {
      range = this._actor
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
    this._actor
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
    this._renderWindow.render();
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
      range = this._PGwidget.getOpacityRange();
    } else {
      range = this._actor
        .getMapper()
        .getInputData()
        .getPointData()
        .getScalars()
        .getRange();
    }

    // TODO a function to set custom mapping range (unbind from opacity)
    lookupTable.setMappingRange(...range);
    lookupTable.updateRange();

    this._actor.getProperty().setRGBTransferFunction(0, lookupTable);

    // setup opacity function (values will be set by PGwidget)
    const piecewiseFun = vtkPiecewiseFunction.newInstance();
    this._actor.getProperty().setScalarOpacity(0, piecewiseFun);

    this.ctfun = lookupTable;
    this.ofun = piecewiseFun;

    this._updateWidget();
  }

  /**
   * Toggle blurring on interaction (Increase performance)
   * @type {bool} toggle - if true, blur on interaction
   */
  set blurOnInteraction(toggle) {
    this._blurOnInteraction = toggle;
    let interactor = this._renderWindow.getInteractor();
    let mapper = this._actor.getMapper();

    if (toggle) {
      interactor.onLeftButtonPress(() => {
        mapper.setSampleDistance(this._raysDistance * 5);
      });

      interactor.onLeftButtonRelease(() => {
        mapper.setSampleDistance(this._raysDistance);
        // update picking plane
        let camera = this._renderer.getActiveCamera();
        if (this._pickingPlane)
          this._pickingPlane.setNormal(camera.getDirectionOfProjection());
        this._renderWindow.render();
      });
    } else {
      interactor.onLeftButtonPress(() => {
        mapper.setSampleDistance(this._raysDistance);
      });

      interactor.onLeftButtonRelease(() => {
        mapper.setSampleDistance(this._raysDistance);
        // update picking plane
        let camera = this._renderer.getActiveCamera();
        if (this._pickingPlane)
          this._pickingPlane.setNormal(camera.getDirectionOfProjection());
        this._renderWindow.render();
      });
    }
  }

  /**
   * Toggle edge enhancement
   */
  set edgeEnhancement([type, value]) {
    let renderPass = getRenderPass(type, value);
    let view = this._renderWindow.getViews()[0];
    view.setRenderPasses([renderPass]);
    this._renderWindow.render();
  }

  // ===========================================================
  // ====== public methods =====================================
  // ===========================================================

  /**
   * Activate XR
   */
  activateXR() {
    if (global.navigator.xr === undefined) {
      vtkResourceLoader
        .loadScript(
          "https://cdn.jsdelivr.net/npm/webxr-polyfill@latest/build/webxr-polyfill.js"
        )
        .then(() => {
          // eslint-disable-next-line no-new, no-undef
          new WebXRPolyfill();
        });
    }
    this._genericRenderWindow.getOpenGLRenderWindow().startXR();
  }

  /**
   * Set the image to be rendered
   * @param {ArrayBuffer} image - The image content data as buffer array
   */
  setImage(image) {
    // clean scene
    this._renderer.removeAllVolumes();
    this._actor = createVolumeActor(image);
    this.lut = "Grayscale";
    this.resolution = 2;
    this._renderer.addVolume(this._actor);

    // center camera on new volume
    this._renderer.resetCamera();
    setCamera(this._renderer.getActiveCamera(), this._actor.getCenter());

    if (this._PGwidget) {
      this._updateWidget();
      this._setWidgetCallbacks();
    }

    // TODO if crop widget, update to new image (or set to null so that it will be initialized again)

    // TODO implement a strategy to set rays distance
    setActorProperties(this._actor);

    this._setupInteractor();

    this.blurOnInteraction = true;

    this._genericRenderWindow.resize();
    this._renderWindow.render();
  }

  /**
   * Get vtk LUTs list
   * @returns {Array} - Lut list as array of strings
   */
  getLutList() {
    return vtkColorMaps.rgbPresetNames;
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
   * @param {*} toolName
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
        this._setupInteractor();
        break;
      default:
        console.warn("No tool found for", toolName);
    }
  }

  /**
   * Reset view
   */
  resetView() {
    let center = this._actor.getCenter();
    let camera = this._renderer.getActiveCamera();
    setCamera(camera, center);
    this._renderWindow.render();
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
    this._element = null;
    this._genericRenderWindow.delete();
    this._genericRenderWindow = null;

    if (this._actor) {
      this._actor.getMapper().delete();
      this._actor.delete();
      this._actor = null;
    }

    if (this._planeActor) {
      this._planeActor.getMapper().delete();
      this._planeActor.delete();
      this._planeActor = null;
    }

    if (this._PGwidgetElement) {
      this._PGwidgetElement = null;
      this._PGwidget.getCanvas().remove();
      this._PGwidget.delete();
      this._PGwidget = null;
      this._gaussians = null;
    }

    if (this._cropWidget) {
      this._cropWidget.delete();
      this._cropWidget = null;
    }
  }

  // ===========================================================
  // ====== private methods ====================================
  // ===========================================================

  /**
   * Initialize rendering scene
   * @private
   */
  _initVR() {
    const genericRenderWindow = vtkGenericRenderWindow.newInstance();
    genericRenderWindow.setContainer(this._element);
    genericRenderWindow.setBackground([0, 0, 0]);

    //add custom resize cb
    genericRenderWindow.onResize(() => {
      // bypass genericRenderWindow resize method (do not consider devicePixelRatio)
      // https://kitware.github.io/vtk-js/api/Rendering_Misc_GenericRenderWindow.html
      let size = [
        genericRenderWindow.getContainer().getBoundingClientRect().width,
        genericRenderWindow.getContainer().getBoundingClientRect().height
      ];
      genericRenderWindow.getRenderWindow().getViews()[0].setSize(size);

      if (this.VERBOSE) console.log("resize", size);
    });

    // resize callback
    window.addEventListener("resize", evt => {
      genericRenderWindow.resize();
    });

    genericRenderWindow.resize();

    this._renderer = genericRenderWindow.getRenderer();
    this._renderWindow = genericRenderWindow.getRenderWindow();
    this._genericRenderWindow = genericRenderWindow;

    // initalize piecewise gaussian widget
    this._PGwidget = setupPGwidget(this._PGwidgetElement);
  }

  /**
   * Update the PGwidget after an image has been loaded
   * @private
   */
  _updateWidget() {
    const dataArray = this._actor
      .getMapper()
      .getInputData()
      .getPointData()
      .getScalars();

    this._PGwidget.setDataArray(dataArray.getData());

    let gaussians = this._PGwidget.getGaussians();

    if (gaussians.length > 0) {
      let gaussian = gaussians[0];

      gaussian.position = this._wl;
      gaussian.width = this._ww;

      this._PGwidget.setGaussians([gaussian]);
    } else {
      // TODO initilize in a smarter way
      const default_opacity = 1.0;
      const default_bias = 0.0; // xBias
      const default_skew = 1.8; // yBias
      this._PGwidget.addGaussian(
        this._wl,
        default_opacity,
        this._ww,
        default_bias,
        default_skew
      ); // x, y, ampiezza, sbilanciamento, andamento
    }

    this._PGwidget.applyOpacity(this.ofun);
    this._PGwidget.setColorTransferFunction(this.ctfun);
    this.ctfun.onModified(() => {
      this._PGwidget.render();
      this._renderWindow.render();
    });

    this._PGwidgetLoaded = true;
  }

  /**
   * Binds callbacks to user interactions on PGwidget
   * @private
   */
  _setWidgetCallbacks() {
    this._PGwidget.bindMouseListeners();

    this._PGwidget.onAnimation(start => {
      if (start) {
        this._renderWindow.getInteractor().requestAnimation(this._PGwidget);
      } else {
        this._renderWindow.getInteractor().cancelAnimation(this._PGwidget);
      }
    });

    this._PGwidget.onOpacityChange(widget => {
      this._PGwidget = widget;
      this._gaussians = widget.getGaussians().slice(); // store
      this._PGwidget.applyOpacity(this.ofun);
      if (!this._renderWindow.getInteractor().isAnimating()) {
        this._renderWindow.render();
      }

      if (this._rescaleLUT && this._PGwidget) {
        const range = this._PGwidget.getOpacityRange();
        this.ctfun.setMappingRange(...range);
        this.ctfun.updateRange();
      }
    });
  }

  /**
   * Setup crop widget
   */
  _initCropWidget() {
    let cropWidget = setupCropWidget(this._renderer, this._actor.getMapper());

    this._widgetManager = cropWidget.widgetManager;
    this._cropWidget = cropWidget.widget;

    this._renderWindow.render();
  }

  /**
   * Init interactor
   * @private
   */
  _setupInteractor() {
    // TODO setup from user
    const rotateManipulator =
      vtkMouseCameraTrackballRotateManipulator.newInstance({ button: 1 });
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
      return self._wl;
    }

    function getWW() {
      return self._ww;
    }

    function setWL(v) {
      self._wl = self._wl + (v - self._wl) / 25; // 25 is a tweaking parameter
      let gaussians = self._PGwidget.getGaussians().slice(); // NOTE: slice() to clone!
      gaussians[0].position = self._wl; //TODO: foreach
      self._PGwidget.setGaussians(gaussians);
    }

    function setWW(v) {
      self._ww = self._ww + (v - self._ww) / 5; // 5 is a tweaking parameter
      let gaussians = self._PGwidget.getGaussians().slice(); // NOTE: slice() to clone!
      gaussians[0].width = self._ww; //TODO: foreach
      self._PGwidget.setGaussians(gaussians);
    }

    rangeManipulator.setVerticalListener(-1, 1, 0.001, getWL, setWL);
    rangeManipulator.setHorizontalListener(0.1, 2.1, 0.001, getWW, setWW);

    const interactorStyle = vtkInteractorStyleManipulator.newInstance();
    interactorStyle.addMouseManipulator(rangeManipulator);
    interactorStyle.addMouseManipulator(rotateManipulator);
    interactorStyle.addMouseManipulator(panManipulator);
    interactorStyle.addMouseManipulator(zoomManipulator);
    interactorStyle.setCenterOfRotation(this._actor.getCenter());
    this._renderWindow.getInteractor().setInteractorStyle(interactorStyle);

    // clear measurements on interactions
    this._renderWindow
      .getInteractor()
      .onMouseWheel(() => this.resetMeasurementState());
    this._renderWindow
      .getInteractor()
      .onRightButtonPress(() => this.resetMeasurementState());
  }

  /**
   * initPicker
   */
  _initPicker(state, mode) {
    // no blur when measure
    this.blurOnInteraction = false;

    // de-activate rotation
    let rotateManipulator = this._renderWindow
      .getInteractor()
      .getInteractorStyle()
      .getMouseManipulators()
      .filter(i => {
        return i.getClassName() == "vtkMouseCameraTrackballRotateManipulator";
      })
      .pop();
    this._renderWindow
      .getInteractor()
      .getInteractorStyle()
      .removeMouseManipulator(rotateManipulator);

    // Setup picking interaction
    // TODO this is slow the first time we pick, maybe we could use cellPicker and decrease resolution
    const picker = vtkPointPicker.newInstance();
    picker.setPickFromList(1);
    picker.initializePickList();

    if (!this._pickingPlane) {
      // add a 1000x1000 plane
      let camera = this._renderer.getActiveCamera();
      let { plane, planeActor } = setupPickingPlane(camera, this._actor);
      this._renderer.addActor(planeActor);
      this._pickingPlane = plane;
      this._planeActor = planeActor;
    }

    // add picking plane to pick list
    picker.addPickList(this._planeActor);

    // Pick on mouse left click
    this._leftButtonCb = this._renderWindow
      .getInteractor()
      .onLeftButtonPress(callData => {
        if (this._renderer !== callData.pokedRenderer) {
          return;
        }

        const pos = callData.position;
        const point = [pos.x, pos.y, 0.0];
        picker.pick(point, this._renderer);

        if (picker.getActors().length === 0) {
          const pickedPoint = picker.getPickPosition();
          if (this.VERBOSE)
            console.log(`No point picked, default: ${pickedPoint}`);
          // addSphereInPoint(pickedPoint, this._renderer);
        } else {
          const pickedPoints = picker.getPickedPositions();
          const pickedPoint = pickedPoints[0]; // always a single point on a plane
          if (this.VERBOSE) console.log(`Picked: ${pickedPoint}`);
          // addSphereInPoint(pickedPoint, this._renderer);

          // canvas coord
          const wPos = vtkCoordinate.newInstance();
          wPos.setCoordinateSystemToWorld();
          wPos.setValue(...pickedPoint);
          const displayPosition = wPos.getComputedDisplayValue(this._renderer);

          // apply changes on state based on active tool
          applyStrategy(state, displayPosition, pickedPoint, mode);

          if (this.VERBOSE) console.log(state);
          this._measurementState = state;
        }

        this._renderWindow.render();
      });
  }
}
