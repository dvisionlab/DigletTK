import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray";
import vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData";
import vtkPlane from "@kitware/vtk.js/Common/DataModel/Plane";
import vtkVolume from "@kitware/vtk.js/Rendering/Core/Volume";
import vtkVolumeMapper from "@kitware/vtk.js/Rendering/Core/VolumeMapper";

import { vec3, quat, mat4 } from "gl-matrix";

export function buildVtkVolume(header, data) {
  const dims = [
    header.volume.cols,
    header.volume.rows,
    header.volume.imageIds.length
  ];
  const numScalars = dims[0] * dims[1] * dims[2];

  if (numScalars < 1 || dims[1] < 2 || dims[1] < 2 || dims[2] < 2) {
    return;
  }

  const volume = vtkImageData.newInstance();
  const origin = header.volume.imagePosition;
  const spacing = header.volume.pixelSpacing.concat(
    header.volume.sliceThickness // TODO check
  );

  volume.setDimensions(dims);
  volume.setOrigin(origin);
  volume.setSpacing(spacing);

  const scalars = vtkDataArray.newInstance({
    name: "Scalars",
    values: data,
    numberOfComponents: 1
  });

  volume.getPointData().setScalars(scalars);

  volume.modified();

  return volume;
}

// fit to window
export function fitToWindow(genericRenderWindow, dir) {
  const bounds = genericRenderWindow.getRenderer().computeVisiblePropBounds();
  const dim = [
    (bounds[1] - bounds[0]) / 2,
    (bounds[3] - bounds[2]) / 2,
    (bounds[5] - bounds[4]) / 2
  ];
  const w = genericRenderWindow.getContainer().clientWidth;
  const h = genericRenderWindow.getContainer().clientHeight;
  const r = w / h;

  let x;
  let y;
  if (dir === "x") {
    x = dim[1];
    y = dim[2];
  } else if (dir === "y") {
    x = dim[0];
    y = dim[2];
  } else if (dir === "z") {
    x = dim[0];
    y = dim[1];
  }
  if (r >= x / y) {
    // use width
    genericRenderWindow
      .getRenderer()
      .getActiveCamera()
      .setParallelScale(y + 1);
  } else {
    // use height
    genericRenderWindow
      .getRenderer()
      .getActiveCamera()
      .setParallelScale(x / r + 1);
  }
}

let larvitarInitialized = false;

export function loadDemoSerieWithLarvitar(name, lrv, cb) {
  let demoFiles = [];
  let counter = 0;
  let demoFileList = getDemoFileNames();

  function getDemoFileNames() {
    let NOF = {
      knee: 24,
      thorax: 364,
      abdomen: 147
    };
    let numberOfFiles = NOF[name];
    let demoFileList = [];
    for (let i = 1; i < numberOfFiles; i++) {
      let filename = `${name} (${i})`;
      if (name == "abdomen") filename += ".dcm";
      demoFileList.push(filename);
    }
    return demoFileList;
  }

  async function createFile(fileName, cb) {
    let response = await fetch("./demo/" + fileName);
    let data = await response.blob();
    let file = new File([data], fileName);
    demoFiles.push(file);
    counter++;
    if (counter == demoFileList.length) {
      cb();
    }
  }

  if (!larvitarInitialized) {
    // init all larvitar
    lrv.initLarvitarStore();
    lrv.initializeImageLoader();
    lrv.initializeCSTools();
    lrv.larvitar_store.addViewport("viewer");
    larvitarInitialized = true;
  }

  // load dicom and render
  demoFileList.forEach(function (demoFile) {
    createFile(demoFile, () => {
      lrv.resetImageParsing();
      lrv.readFiles(demoFiles, function (seriesStack, err) {
        // return the first series of the study
        let seriesId = _.keys(seriesStack)[0];
        let serie = seriesStack[seriesId];

        // hack to avoid load and cache (render + timeout)
        lrv.renderImage(serie, "viewer");
        if (cb) {
          setTimeout(cb, 3000, serie); // increase timeout if "getPixelData" error
        }
      });
    });
  });
}

/**
 * Function to create synthetic image data with correct dimensions
 * Can be use for debug
 * @private
 * @param {Array} dims - Array[int]
 */
// eslint-disable-next-line no-unused-vars
function createSyntheticImageData(dims) {
  const imageData = vtkImageData.newInstance();
  const newArray = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const s = 0.1;
  imageData.setSpacing(s, s, s);
  imageData.setExtent(0, 127, 0, 127, 0, 127);
  let i = 0;
  for (let z = 0; z < dims[2]; z++) {
    for (let y = 0; y < dims[1]; y++) {
      for (let x = 0; x < dims[0]; x++) {
        newArray[i++] = (256 * (i % (dims[0] * dims[1]))) / (dims[0] * dims[1]);
      }
    }
  }

  const da = vtkDataArray.newInstance({
    numberOfComponents: 1,
    values: newArray
  });
  da.setName("scalars");

  imageData.getPointData().setScalars(da);

  return imageData;
}

export function createRGBStringFromRGBValues(rgb) {
  if (rgb.length !== 3) {
    return "rgb(0, 0, 0)";
  }
  return `rgb(${(rgb[0] * 255).toString()}, ${(rgb[1] * 255).toString()}, ${(
    rgb[2] * 255
  ).toString()})`;
}

export function degrees2radians(degrees) {
  return (degrees * Math.PI) / 180;
}

export function getVolumeCenter(volumeMapper) {
  const bounds = volumeMapper.getBounds();
  return [
    (bounds[0] + bounds[1]) / 2.0,
    (bounds[2] + bounds[3]) / 2.0,
    (bounds[4] + bounds[5]) / 2.0
  ];
}

export function getVOI(volume) {
  // Note: This controls window/level

  // TODO: Make this work reactively with onModified...
  const rgbTransferFunction = volume.getProperty().getRGBTransferFunction(0);
  const range = rgbTransferFunction.getMappingRange();
  const windowWidth = range[0] + range[1];
  const windowCenter = range[0] + windowWidth / 2;

  return {
    windowCenter,
    windowWidth
  };
}

/**
 * Planes are of type `{position:[x,y,z], normal:[x,y,z]}`
 * returns an [x,y,z] array, or NaN if they do not intersect.
 * @private
 */
export const getPlaneIntersection = (plane1, plane2, plane3) => {
  try {
    let line = vtkPlane.intersectWithPlane(
      plane1.position,
      plane1.normal,
      plane2.position,
      plane2.normal
    );
    if (line.intersection) {
      const { l0, l1 } = line;
      const intersectionLocation = vtkPlane.intersectWithLine(
        l0,
        l1,
        plane3.position,
        plane3.normal
      );
      if (intersectionLocation.intersection) {
        return intersectionLocation.x;
      }
    }
  } catch (err) {
    console.log("some issue calculating the plane intersection", err);
  }
  return NaN;
};

export function createVolumeActor(contentData) {
  const volumeActor = vtkVolume.newInstance();
  const volumeMapper = vtkVolumeMapper.newInstance();
  volumeMapper.setSampleDistance(1);
  volumeActor.setMapper(volumeMapper);

  volumeMapper.setInputData(contentData);

  // set a default wwwl
  const dataRange = contentData.getPointData().getScalars().getRange();

  // FIXME: custom range mapping
  const rgbTransferFunction = volumeActor
    .getProperty()
    .getRGBTransferFunction(0);
  rgbTransferFunction.setMappingRange(dataRange[0], dataRange[1]);

  // update slice min/max values for interface
  // Crate imageMapper for I,J,K planes
  // const dataRange = data
  //   .getPointData()
  //   .getScalars()
  //   .getRange();
  // const extent = data.getExtent();
  // this.window = {
  //   min: 0,
  //   max: dataRange[1] * 2,
  //   value: dataRange[1]
  // };
  // this.level = {
  //   min: -dataRange[1],
  //   max: dataRange[1],
  //   value: (dataRange[0] + dataRange[1]) / 2
  // };
  // this.updateColorLevel();
  // this.updateColorWindow();

  // TODO: find the volume center and set that as the slice intersection point.
  // TODO: Refactor the MPR slice to set the focal point instead of defaulting to volume center

  return volumeActor;
}

export function getVideoCardInfo() {
  const gl = document.createElement("canvas").getContext("webgl");
  if (!gl) {
    return {
      error: "no webgl"
    };
  }
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  return debugInfo
    ? {
        vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
        renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      }
    : {
        error: "no WEBGL_debug_renderer_info"
      };
}

export function getCroppingPlanes(imageData, ijkPlanes) {
  const rotation = quat.create();
  mat4.getRotation(rotation, imageData.getIndexToWorld());

  const rotateVec = vec => {
    const out = [0, 0, 0];
    vec3.transformQuat(out, vec, rotation);
    return out;
  };

  const [iMin, iMax, jMin, jMax, kMin, kMax] = ijkPlanes;
  const origin = imageData.indexToWorld([iMin, jMin, kMin]);
  // opposite corner from origin
  const corner = imageData.indexToWorld([iMax, jMax, kMax]);
  return [
    // X min/max
    vtkPlane.newInstance({ normal: rotateVec([1, 0, 0]), origin }),
    vtkPlane.newInstance({ normal: rotateVec([-1, 0, 0]), origin: corner }),
    // Y min/max
    vtkPlane.newInstance({ normal: rotateVec([0, 1, 0]), origin }),
    vtkPlane.newInstance({ normal: rotateVec([0, -1, 0]), origin: corner }),
    // X min/max
    vtkPlane.newInstance({ normal: rotateVec([0, 0, 1]), origin }),
    vtkPlane.newInstance({ normal: rotateVec([0, 0, -1]), origin: corner })
  ];
}

/**
 * Rescale abs range to relative range values (eg 0-1)
 * @param {*} actor
 * @param {*} value
 * @returns
 */
export function getRelativeRange(actor, absoluteRange) {
  const dataArray = actor
    .getMapper()
    .getInputData()
    .getPointData()
    .getScalars();
  const range = dataArray.getRange();
  let rel_ww = absoluteRange[0] / (range[1] - range[0]);
  let rel_wl = (absoluteRange[1] - range[0]) / range[1];

  return { ww: rel_ww, wl: rel_wl };
}

/**
 * Rescale relative range to abs range values (eg hist min-max)
 * @param {*} actor
 * @param {*} relativeRange
 * @returns
 */
export function getAbsoluteRange(actor, relativeRange) {
  const dataArray = actor
    .getMapper()
    .getInputData()
    .getPointData()
    .getScalars();
  const range = dataArray.getRange();
  let abs_ww = relativeRange[0] * (range[1] - range[0]);
  let abs_wl = relativeRange[1] * range[1] + range[0];
  return { ww: abs_ww, wl: abs_wl };
}
