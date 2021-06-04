import vtkGenericRenderWindow from "vtk.js/Sources/Rendering/Misc/GenericRenderWindow";
import vtkColorTransferFunction from "vtk.js/Sources/Rendering/Core/ColorTransferFunction";
import vtkPiecewiseFunction from "vtk.js/Sources/Common/DataModel/PiecewiseFunction";
import vtkImageCroppingWidget from "vtk.js/Sources/Widgets/Widgets3D/ImageCroppingWidget";
import vtkImageCropFilter from "vtk.js/Sources/Filters/General/ImageCropFilter";
import vtkWidgetManager from "vtk.js/Sources/Widgets/Core/WidgetManager";
import vtkColorMaps from "vtk.js/Sources/Rendering/Core/ColorTransferFunction/ColorMaps";
import vtkPiecewiseGaussianWidget from "vtk.js/Sources/Interaction/Widgets/PiecewiseGaussianWidget";

import vtkMouseCameraTrackballRotateManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseCameraTrackballRotateManipulator";
import vtkMouseCameraTrackballPanManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseCameraTrackballPanManipulator";
import vtkMouseCameraTrackballZoomManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseCameraTrackballZoomManipulator";
import vtkMouseRangeManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseRangeManipulator";
import vtkInteractorStyleManipulator from "vtk.js/Sources/Interaction/Style/InteractorStyleManipulator";

import vtkPointPicker from "vtk.js/Sources/Rendering/Core/PointPicker";
import vtkPlaneSource from "vtk.js/Sources/Filters/Sources/PlaneSource";
import vtkMapper from "vtk.js/Sources/Rendering/Core/Mapper";
import vtkActor from "vtk.js/Sources/Rendering/Core/Actor";
import vtkSphereSource from "vtk.js/Sources/Filters/Sources/SphereSource";
import vtkCoordinate from "vtk.js/Sources/Rendering/Core/Coordinate";

import { createVolumeActor } from "./utils/utils";
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

    const dataArray = this.actor
      .getMapper()
      .getInputData()
      .getPointData()
      .getScalars();

    const range = dataArray.getRange();
    let rel_ww = value[0] / (range[1] - range[0]);
    let rel_wl = (value[1] - range[0]) / range[1];

    this.wl = rel_wl;
    this.ww = rel_ww;

    if (this.PGwidget) {
      this.updateWidget();
    }
  }

  get wwwl() {
    const dataArray = this.actor
      .getMapper()
      .getInputData()
      .getPointData()
      .getScalars();

    const range = dataArray.getRange();

    let abs_ww = rel_ww * (range[1] - range[0]);
    let abs_wl = rel_wl * range[1] + range[0];
    return [abs_ww, abs_wl];
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
    if (!this._cropWidget) this.setupCropWidget();
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

    // set up opacity function (values will be set by PGwidget)
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

    this.setupPGwidget();
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
    this.setCamera(actor.getCenter());

    if (this.PGwidget) {
      this.updateWidget();
      this.setWidgetCallbacks();
    }

    // TODO implement a strategy to set rays distance
    // TODO interactors switching (ex. blurring or wwwl or crop)
    this.setActorProperties();

    this.setupInteractor();

    this.blurOnInteraction = true;

    this._genericRenderWindow.resize();
    this.renderer.resetCamera();
    this.renderWindow.render();
  }

  /**
   * Set camera lookat point
   * @param {Array} center - As [x,y,z]
   */
  setCamera(center) {
    this.renderer.resetCamera();
    this.renderer.getActiveCamera().zoom(1.5);
    this.renderer.getActiveCamera().elevation(70);
    this.renderer.getActiveCamera().setViewUp(0, 0, 1);
    this.renderer
      .getActiveCamera()
      .setFocalPoint(center[0], center[1], center[2]);
    this.renderer
      .getActiveCamera()
      .setPosition(center[0], center[1] - 2000, center[2]);
    this.renderer.getActiveCamera().setThickness(10000);
    this.renderer.getActiveCamera().setParallelProjection(true);
  }

  /**
   * Get vtk LUTs list
   * @returns {Array} - Lut list as array of strings
   */
  getLutList() {
    return vtkColorMaps.rgbPresetNames;
  }

  /**
   * Set actor appearance properties
   * TODO
   */
  setActorProperties() {
    this.actor.getProperty().setScalarOpacityUnitDistance(0, 30.0);
    this.actor.getProperty().setInterpolationTypeToLinear();
    this.actor.getProperty().setUseGradientOpacity(0, true);
    this.actor.getProperty().setGradientOpacityMinimumValue(0, 2);
    this.actor.getProperty().setGradientOpacityMinimumOpacity(0, 0.0);
    this.actor.getProperty().setGradientOpacityMaximumValue(0, 20);
    this.actor.getProperty().setGradientOpacityMaximumOpacity(0, 2.0);
    this.actor.getProperty().setShade(true);
    this.actor.getProperty().setAmbient(0.3);
    this.actor.getProperty().setDiffuse(0.7);
    this.actor.getProperty().setSpecular(0.3);
    this.actor.getProperty().setSpecularPower(0.8);
  }

  /**
   * Setup crop widget
   */
  setupCropWidget() {
    // setup widget manager and widget
    const widgetManager = vtkWidgetManager.newInstance();
    // widgetManager.setUseSvgLayer(false);
    widgetManager.setRenderer(this.renderer);

    // widget factory
    const widget = vtkImageCroppingWidget.newInstance();
    // instance of a widget associated with a renderer
    const viewWidget = widgetManager.addWidget(widget);

    // setup crop filter
    const cropFilter = vtkImageCropFilter.newInstance();
    // listen to cropping widget state to inform the crop filter
    const cropState = widget.getWidgetState().getCroppingPlanes();
    cropState.onModified(() => {
      cropFilter.setCroppingPlanes(cropState.getPlanes());
    });

    // wire up the reader, crop filter, and mapper
    let mapper = this.actor.getMapper();
    let image = mapper.getInputData();
    cropFilter.setCroppingPlanes(...image.getExtent());
    widget.copyImageDataDescription(image);

    widget.set({
      faceHandlesEnabled: true,
      edgeHandlesEnabled: true,
      cornerHandlesEnabled: true
    });

    cropFilter.setInputData(image);
    mapper.setInputConnection(cropFilter.getOutputPort());

    widgetManager.enablePicking();

    this._widgetManager = widgetManager;
    this._cropWidget = widget; // or viewWidget ?

    this.renderWindow.render();
  }

  /**
   * Append a vtkPiecewiseGaussianWidget into the target element
   * @private
   * @param {HTMLElement} widgetContainer - The target element to place the widget
   */
  setupPGwidget() {
    let containerWidth = this.PGwidgetElement
      ? this.PGwidgetElement.offsetWidth - 5
      : 300;
    let containerHeight = this.PGwidgetElement
      ? this.PGwidgetElement.offsetHeight - 5
      : 100;

    const PGwidget = vtkPiecewiseGaussianWidget.newInstance({
      numberOfBins: 256,
      size: [containerWidth, containerHeight]
    });
    // TODO expose style
    PGwidget.updateStyle({
      backgroundColor: "rgba(255, 255, 255, 0.6)",
      histogramColor: "rgba(50, 50, 50, 0.8)",
      strokeColor: "rgb(0, 0, 0)",
      activeColor: "rgb(255, 255, 255)",
      handleColor: "rgb(50, 150, 50)",
      buttonDisableFillColor: "rgba(255, 255, 255, 0.5)",
      buttonDisableStrokeColor: "rgba(0, 0, 0, 0.5)",
      buttonStrokeColor: "rgba(0, 0, 0, 1)",
      buttonFillColor: "rgba(255, 255, 255, 1)",
      strokeWidth: 1,
      activeStrokeWidth: 1.5,
      buttonStrokeWidth: 1,
      handleWidth: 1,
      iconSize: 0, // Can be 0 if you want to remove buttons (dblClick for (+) / rightClick for (-))
      padding: 1
    });

    // to hide widget
    PGwidget.setContainer(this.PGwidgetElement); // Set to null to hide

    // resize callback
    window.addEventListener("resize", evt => {
      PGwidget.setSize(
        this.PGwidgetElement.offsetWidth - 5,
        this.PGwidgetElement.offsetHeight - 5
      );
      PGwidget.render();
    });

    this.PGwidget = PGwidget;
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
    // Only try to pick points
    const picker = vtkPointPicker.newInstance();
    picker.setPickFromList(1);
    picker.initializePickList();

    if (!this._pickingPlane) {
      // add a 1000x1000 plane
      // TODO this is slow the first time we pick, maybe we could use cellPicker and decrease resolution
      const plane = vtkPlaneSource.newInstance({
        xResolution: 1000,
        yResolution: 1000
      });
      let camera = this.renderer.getActiveCamera();
      plane.setPoint1(0, 0, 1000);
      plane.setPoint2(1000, 0, 0);
      plane.setCenter(this.actor.getCenter());
      plane.setNormal(camera.getDirectionOfProjection());

      const mapper = vtkMapper.newInstance();
      mapper.setInputConnection(plane.getOutputPort());
      const planeActor = vtkActor.newInstance();
      planeActor.setMapper(mapper);
      planeActor.getProperty().setOpacity(0.01); // with opacity = 0 it is ignored by picking
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
          // const sphere = vtkSphereSource.newInstance();
          // sphere.setCenter(pickedPoint);
          // sphere.setRadius(0.01);
          // const sphereMapper = vtkMapper.newInstance();
          // sphereMapper.setInputData(sphere.getOutputData());
          // const sphereActor = vtkActor.newInstance();
          // sphereActor.setMapper(sphereMapper);
          // sphereActor.getProperty().setColor(1.0, 0.0, 0.0);
          // this.renderer.addActor(sphereActor);
        } else {
          const pickedPoints = picker.getPickedPositions();
          const pickedPoint = pickedPoints[0]; // always a single point on a plane
          if (this.VERBOSE) console.log(`Picked: ${pickedPoint}`);
          // const sphere = vtkSphereSource.newInstance();
          // sphere.setCenter(pickedPoint);
          // sphere.setRadius(10);
          // const sphereMapper = vtkMapper.newInstance();
          // sphereMapper.setInputData(sphere.getOutputData());
          // const sphereActor = vtkActor.newInstance();
          // sphereActor.setMapper(sphereMapper);
          // sphereActor.getProperty().setColor(0.0, 1.0, 0.0);
          // this.renderer.addActor(sphereActor);

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
    console.log(center);
    this.setCamera(center);
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
    // leave these comments for now

    // this.PGwidget.delete();
    // this.actor.getMapper().delete();
    // this.actor.delete();
    // this.renderWindow.getInteractor().delete();
    // this.renderWindow.delete();
    // this.renderer.delete();

    // this.renderer.delete();
    // this.renderer = null;
    // this.renderWindow.getInteractor().delete();
    // this.renderWindow.delete();
    // this.renderWindow = null;

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
