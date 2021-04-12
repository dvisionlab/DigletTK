import vtkGenericRenderWindow from "vtk.js/Sources/Rendering/Misc/GenericRenderWindow";
import vtkColorTransferFunction from "vtk.js/Sources/Rendering/Core/ColorTransferFunction";
import vtkPiecewiseFunction from "vtk.js/Sources/Common/DataModel/PiecewiseFunction";
import vtkImageCroppingWidget from "vtk.js/Sources/Widgets/Widgets3D/ImageCroppingWidget";
import vtkImageCropFilter from "vtk.js/Sources/Filters/General/ImageCropFilter";
import vtkWidgetManager from "vtk.js/Sources/Widgets/Core/WidgetManager";
import vtkColorMaps from "vtk.js/Sources/Rendering/Core/ColorTransferFunction/ColorMaps";
import vtkPiecewiseGaussianWidget from "vtk.js/Sources/Interaction/Widgets/PiecewiseGaussianWidget";

import { getVolumeCenter, createVolumeActor } from "./utils";

export class VRView {
  /**
   * Create a volume rendering scene
   */
  constructor(element) {
    this.element = element;
    this.renderer = null;
    this.renderWindow = null;
    this.actor = null;

    this.initVR();
  }

  initVR() {
    const genericRenderWindow = vtkGenericRenderWindow.newInstance();
    genericRenderWindow.setContainer(this.element);
    genericRenderWindow.setBackground([0, 0, 0]);
    genericRenderWindow.resize();

    this.renderer = genericRenderWindow.getRenderer();
    this.renderWindow = genericRenderWindow.getRenderWindow();

    this.addPGwidget();
  }

  setImage(image) {
    // TODO remove all volumes
    console.log(image);
    let actor = createVolumeActor(image);

    this.actor = actor;

    this.addLUT(actor);

    this.renderer.addVolume(actor);

    this.updateWidget();
    // TODO
    // setWidgetCallbacks(phase);
    // setupInteractor(center, phase);
    // setCamera(center);

    this.renderer.resetCamera();
    this.renderWindow.render();
  }

  addLUT(actor) {
    // --- set up our color lookup table and opacity piecewise function

    const lookupTable = vtkColorTransferFunction.newInstance();
    const piecewiseFun = vtkPiecewiseFunction.newInstance();

    // set up color transfer function
    lookupTable.applyColorMap(vtkColorMaps.getPresetByName("Cool to Warm"));
    // hardcode an initial mapping range here.
    // Normally you would instead use the range from
    // imageData.getPointData().getScalars().getRange()
    lookupTable.setMappingRange(0, 256);
    lookupTable.updateRange();

    // set up simple linear opacity function
    // This assumes a data range of 0 -> 256
    for (let i = 0; i <= 8; i++) {
      piecewiseFun.addPoint(i * 32, i / 8);
    }

    // update lookup table mapping range based on input dataset

    console.log(actor);
    const range = actor
      .getMapper()
      .getInputData()
      .getPointData()
      .getScalars()
      .getRange();

    lookupTable.setMappingRange(...range);
    lookupTable.updateRange();

    // set the actor properties
    actor.getProperty().setRGBTransferFunction(0, lookupTable);
    actor.getProperty().setScalarOpacity(0, piecewiseFun);

    this.ctfun = lookupTable;
    this.ofun = piecewiseFun;
  }

  setCropWidget() {
    // --- setup our widget manager and widget ---

    const widgetManager = vtkWidgetManager.newInstance();
    widgetManager.setUseSvgLayer(false);
    widgetManager.setRenderer(this.renderer);

    // this is a widget factory
    const widget = vtkImageCroppingWidget.newInstance();
    // this is an instance of a widget associated with a renderer
    const viewWidget = widgetManager.addWidget(widget);

    // --- set up crop filter

    const cropFilter = vtkImageCropFilter.newInstance();
    // we listen to cropping widget state to inform the crop filter
    const cropState = widget.getWidgetState().getCroppingPlanes();
    cropState.onModified(() => {
      cropFilter.setCroppingPlanes(cropState.getPlanes());
    });

    // wire up the reader, crop filter, and mapper
    let mapper = this.actor.getMapper();
    let image = mapper.getInputData();
    cropFilter.setCroppingPlanes(...image.getExtent());
    widget.copyImageDataDescription(image);

    // other handles does not work in vtk.js 17.5.0 (use 16.14.0 ?)
    // https://kitware.github.io/vtk-js/examples/ImageCroppingWidget.html
    widget.set({
      faceHandlesEnabled: false,
      edgeHandlesEnabled: false,
      cornerHandlesEnabled: true
    });

    cropFilter.setInputData(image);
    mapper.setInputConnection(cropFilter.getOutputPort());

    // --- Enable interactive picking of widgets ---
    widgetManager.enablePicking();
    this.renderWindow.render();
  }

  addPGwidget() {
    const PGwidget = vtkPiecewiseGaussianWidget.newInstance({
      numberOfBins: 256,
      size: [400, 200]
    });
    PGwidget.updateStyle({
      backgroundColor: "rgba(255, 255, 255, 0.6)",
      histogramColor: "rgba(100, 100, 100, 0.5)",
      strokeColor: "rgb(0, 0, 0)",
      activeColor: "rgb(255, 255, 255)",
      handleColor: "rgb(50, 150, 50)",
      buttonDisableFillColor: "rgba(255, 255, 255, 0.5)",
      buttonDisableStrokeColor: "rgba(0, 0, 0, 0.5)",
      buttonStrokeColor: "rgba(0, 0, 0, 1)",
      buttonFillColor: "rgba(255, 255, 255, 1)",
      strokeWidth: 2,
      activeStrokeWidth: 3,
      buttonStrokeWidth: 1.5,
      handleWidth: 3,
      iconSize: 20, // Can be 0 if you want to remove buttons (dblClick for (+) / rightClick for (-))
      padding: 10
    });

    const widgetContainer = document.createElement("div");
    this.element.appendChild(widgetContainer);

    widgetContainer.style.position = "absolute";
    widgetContainer.style.top = "5%";
    widgetContainer.style.background = "rgba(255, 255, 255, 0.3)";
    widgetContainer.style.float = "right";

    // to hide widget
    PGwidget.setContainer(widgetContainer); // Set to null to hide

    this.PGwidget = PGwidget;
  }

  updateWidget() {
    this.PGwidget.setDataArray(
      this.actor
        .getMapper()
        .getInputData()
        .getPointData()
        .getScalars()
        .getData()
    );

    this.PGwidget.addGaussian(0.5, 0.7, 0.3, -0.02, -0.1); // x, y, ampiezza, sbilanciamento, andamento

    this.PGwidget.applyOpacity(this.ofun);
    this.PGwidget.setColorTransferFunction(this.ctfun);
    this.ctfun.onModified(() => {
      this.PGwidget.render();
      this.renderWindow.render();
    });
  }

  setSampleDistance(distance) {
    this.actor.getMapper().setSampleDistance(distance);
  }

  setActorProperties() {
    // this.actor.getProperty().setRGBTransferFunction(0, lutFuncs.ctfun);
    // this.actor.getProperty().setScalarOpacity(0, lutFuncs.ofun);
    this.actor.getProperty().setScalarOpacityUnitDistance(0, 30.0);
    this.actor.getProperty().setInterpolationTypeToLinear();
    this.actor.getProperty().setUseGradientOpacity(0, true);
    this.actor.getProperty().setGradientOpacityMinimumValue(0, 2);
    this.actor.getProperty().setGradientOpacityMinimumOpacity(0, 0.0);
    this.actor.getProperty().setGradientOpacityMaximumValue(0, 20);
    this.actor.getProperty().setGradientOpacityMaximumOpacity(0, 2.0); // mod
    this.actor.getProperty().setShade(true);
    this.actor.getProperty().setAmbient(state.ambient);
    this.actor.getProperty().setDiffuse(state.diffuse);
    this.actor.getProperty().setSpecular(state.specular);
    this.actor.getProperty().setSpecularPower(state.specularPower);
  }
}
