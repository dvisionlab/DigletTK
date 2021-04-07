import vtkGenericRenderWindow from "vtk.js/Sources/Rendering/Misc/GenericRenderWindow";
import vtkColorTransferFunction from "vtk.js/Sources/Rendering/Core/ColorTransferFunction";
import vtkPiecewiseFunction from "vtk.js/Sources/Common/DataModel/PiecewiseFunction";
import vtkImageCroppingWidget from "vtk.js/Sources/Widgets/Widgets3D/ImageCroppingWidget";
import vtkImageCropFilter from "vtk.js/Sources/Filters/General/ImageCropFilter";
import vtkWidgetManager from "vtk.js/Sources/Widgets/Core/WidgetManager";
import vtkColorMaps from "vtk.js/Sources/Rendering/Core/ColorTransferFunction/ColorMaps";

import { getVolumeCenter, createVolumeActor } from "./utils";

export class VRView {
  /**
   * Create a volume rendering scene
   */
  constructor(element) {
    this.element = element;
    this.renderer = null;
    this.renderWindow = null;

    this.initVR();
  }

  initVR() {
    const genericRenderWindow = vtkGenericRenderWindow.newInstance();
    genericRenderWindow.setContainer(this.element);
    genericRenderWindow.resize();

    this.renderer = genericRenderWindow.getRenderer();
    this.renderWindow = genericRenderWindow.getRenderWindow();
  }

  setImage(image) {
    console.log(image);
    let actor = createVolumeActor(image);

    this.addLUT(actor);

    this.renderer.addVolume(actor);

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
  }
}
