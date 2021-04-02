import vtkDataArray from "vtk.js/Sources/Common/Core/DataArray";
import vtkImageData from "vtk.js/Sources/Common/DataModel/ImageData";
import vtkPlane from "vtk.js/Sources/Common/DataModel/Plane";
import vtkVolume from "vtk.js/Sources/Rendering/Core/Volume";
import vtkVolumeMapper from "vtk.js/Sources/Rendering/Core/VolumeMapper";

export function buildVtkVolume(serie) {
  // TODO load and cache
  //   setTimeout(() => {
  let header = larvitar.buildHeader(serie);
  let data = larvitar.buildData(serie, false);

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
  //   }, 2000);
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

export function loadSerieWithLarvitar(cb) {
  let demoFiles = [];
  let counter = 0;
  let demoFileList = getDemoFileNames();

  function getDemoFileNames() {
    let demoFileList = [];
    for (let i = 1; i < 25; i++) {
      let filename = "anon" + i;
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

  // init all larvitar
  larvitar.initLarvitarStore();
  larvitar.initializeImageLoader();
  larvitar.initializeCSTools();
  larvitar.larvitar_store.addViewport("viewer");

  // load dicom and render
  _.each(demoFileList, function(demoFile) {
    createFile(demoFile, () => {
      larvitar.resetImageParsing();
      larvitar.readFiles(demoFiles, function(seriesStack, err) {
        // return the first series of the study
        let seriesId = _.keys(seriesStack)[0];
        let serie = seriesStack[seriesId];

        // hack to avoid load and cache (render + timeout)
        larvitar.renderImage(serie, "viewer");
        if (cb) {
          setTimeout(cb, 2000, serie);
        }
      });
    });
  });
}

/**
 * Function to create synthetic image data with correct dimensions
 * Can be use for debug
 * @param {Array[Int]} dims
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

  // FIXME: custom range mapping
  const rgbTransferFunction = volumeActor
    .getProperty()
    .getRGBTransferFunction(0);
  rgbTransferFunction.setMappingRange(500, 3000);

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
