<p align="center">
  <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/full/050.png" width="100" title="Diglett" alt="Diglett">
</p>

# DigletTK

DigletTK is a library to interact with medical images in a 3d context, such as Multi Planar Reformat, MIP and Volume Rendering. It's based on vtk.js and takes inspiration from [vue-vtksjs-viewport](https://github.com/mix3d/vue-vtkjs-viewport) and [react-vtkjs-viewport](https://github.com/OHIF/react-vtkjs-viewport), but it is built to be agnostic with respect to frontend frameworks.
It also provides glue-functions to easily integrate with cornerstone.js, via [Larvitar](https://github.com/dvisionlab/Larvitar) library.

## Install

- clone the repository and `yarn add /path/to/repository`

  OR

- `yarn add https://github.com/dvisionlab/DigletTK.git#master`

## Use

Examples and docs at http://diglettk.dvisionlab.com/. Short mpr version:

```javascript
/** 
 Define viewports as:

 {
     key: String - The view id (must be unique)
     element: HTMLElement - The target rendering div,
     height: Number - The viewport initial height,
     width: Number - The viewport initial width
 }

 */

const targetElements = {
  top: {
    element: document.getElementById("viewer-1"),
    key: "top",
    height: 300,
    width: 300
  },
  left: {
    element: document.getElementById("viewer-2"),
    key: "left",
    height: 300,
    width: 300
  },
  front: {
    element: document.getElementById("viewer-3"),
    key: "front",
    height: 300,
    width: 300
  }
};

// import DigletTK
import * as dtk from "DigletTK";

// load a dicom serie using larvitar glue function
dtk.loadSerieWithLarvitar(serie => {
  // build vtk volume from larvitar serie
  const image = dtk.buildVtkVolume(serie);
  // run mpr manager
  let mpr = new dtk.MPRManager(targetElements);
  // get initial state obj: this object will be used to share data updates
  let state = mpr.getInitialState();
  console.log("state", state);
  // set image
  mpr.setImage(state, image);
  // set active tool ("level" or "crosshair")
  mpr.setTool("level", state);
  // change view rotation
  mpr.onRotate("top", "x", 30, state);
  // change view MIP thickness
  mpr.onThickness("top", "x", 50, state);
});
```

### RoadMap

- [ ] Volume Rendering
- [ ] Measuring tools
- [ ] Segmentations (Cornerstone.js >>> data >>> vtk.js)
- [ ] Presets and colormaps
- [ ] Multi Slice Image Mapper (a different MPR implementation)

### TODO

- [ ] documentation
- [x] ~~rollup config~~ webpack config
- [ ] examples
- [ ] npm package
