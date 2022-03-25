import vtkForwardPass from "@kitware/vtk.js/Rendering/OpenGL/ForwardPass";
import vtkConvolution2DPass from "@kitware/vtk.js/Rendering/OpenGL/Convolution2DPass";

function getConvolutionPass(kernel, kernelDimension, delegates = null) {
  const convolutionPass = vtkConvolution2DPass.newInstance();
  if (delegates !== null) {
    convolutionPass.setDelegates(delegates);
  }
  convolutionPass.setKernelDimension(kernelDimension);
  convolutionPass.setKernel(kernel);
  return convolutionPass;
}

function getEdgeEnhancement1Pass(k, delegates = null) {
  return getConvolutionPass(
    [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0],
    3,
    delegates
  );
}

function getEdgeEnhancement2Pass(k, delegates = null) {
  return getConvolutionPass(
    [-k, -k, -k, -k, 1 + 8 * k, -k, -k, -k, -k],
    3,
    delegates
  );
}

function getEdgeEnhancement3Pass(k, delegates = null) {
  return getConvolutionPass(
    [-k, -2 * k, -k, -2 * k, 1 + 12 * k, -2 * k, -k, -2 * k, -k],
    3,
    delegates
  );
}

function getGaussianBlurPass(delegates = null) {
  return getConvolutionPass([1, 2, 1, 2, 4, 2, 1, 2, 1], 3, delegates);
}

export function getRenderPass(type, value) {
  let renderPass = vtkForwardPass.newInstance();
  let gaussianRenderPass = vtkForwardPass.newInstance();
  let gaussianPass = getGaussianBlurPass([gaussianRenderPass]);

  switch (type) {
    case 1:
      renderPass = getEdgeEnhancement1Pass(value, [gaussianPass, renderPass]);
      break;
    case 2:
      renderPass = getEdgeEnhancement2Pass(value, [gaussianPass, renderPass]);
      break;
    case 3:
      renderPass = getEdgeEnhancement3Pass(value, [gaussianPass, renderPass]);
      break;
    default:
      console.warn("no edge enhancement of type ", type);
  }
  return renderPass;
}
