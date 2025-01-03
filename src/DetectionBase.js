const tf = require('@tensorflow/tfjs');
const { Jimp } = require('jimp');

const { argSort } = require('../utils/array-utils');

const { tensorflowToImage, arrayToImage } = require('../utils/debug-utils');

class DetectionBase {
    /**
     * @type {string} Path to the ONNX model for standard OCR.
     * @private
     */
    _ortOnnxPath = '';

    /**
     * @type {boolean} Flag indicating whether debugging is enabled.
     * @private
     */
    _isDebug = false;

    constructor(onnxPath) {
        this._ortOnnxPath = onnxPath;
    }

    /**
     * Enables the debug mode and prepares the debug folder.
     * 
     * @returns {DdddOcr} The current instance for method chaining.
     */
    enableDebug() {
        this._isDebug = true;
    }

    /**
     * Pre-processes an image by resizing and converting it into a tensor format.
     * 
     * @private
     * @param {string | Buffer | ArrayBuffer} url - The image to classify. It can be a file path (string) or image data (Buffer).
     * @returns {Promise<{inputArray: Float32Array, width: number, height: number, ratio: number}>} An object containing:
     *   - `inputArray`: The pre-processed image converted into a Float32Array for model input.
     *   - `width`: The width of the image.
     *   - `height`: The height of the image.
     *   - `ratio`: The resizing ratio used to scale the image dimensions.
     */
    async _preProcessImage(url) {
        const inputSize = [416, 416];

        const image = await Jimp.read(url);

        const grayBgImage = tf.fill([inputSize[1], inputSize[0], 3], 114, 'float32');

        if (this._isDebug) {
            tensorflowToImage(grayBgImage, inputSize, 'debug/pre-process-step-1.jpg');
        }

        const { width, height } = image.bitmap;
        const ratio = Math.min(inputSize[1] / width, inputSize[0] / height);

        const resizedWidth = Math.round(width * ratio);
        const resizedHeight = Math.round(height * ratio);

        image.resize({
            w: resizedWidth, 
            h: resizedHeight
        });

        const floatData = grayBgImage.arraySync();
        let index = 0;
        for (let h = 0; h < resizedHeight; h++) {
            for (let w = 0; w < resizedWidth; w++) {
                floatData[h][w][0] = image.bitmap.data[index + 2];
                floatData[h][w][1] = image.bitmap.data[index + 1];
                floatData[h][w][2] = image.bitmap.data[index + 0];
                index += 4;
            }
        }

        if (this._isDebug) {
            arrayToImage(floatData, inputSize, 'debug/pre-process-step-2.jpg');
        }

        const backToTensorImg = tf.tensor(floatData, [inputSize[1], inputSize[0], 3], 'float32');

        if (this._isDebug) {
            tensorflowToImage(backToTensorImg, inputSize, 'debug/pre-process-step-3.jpg');
        }

        const transposedImg = backToTensorImg.transpose([2, 0, 1]);
        const inputArray = transposedImg.dataSync();

        return {
            inputArray,
            inputSize,
            width,
            height,
            ratio
        }
    }

    /**
     * Post-processes the output tensor.
     * 
     * @private
     * @param {Float32Array} cpuData - The raw OCR data as a `Float32Array`.
     * @param {number[]} dims - The dimensions of the result tensor.
     * @param {number[]} imageSize - The original image size [height, width].
     * @returns {tf.Tensor} A tensor containing the post-processed bounding box coordinates.
     */
    _demoPostProcess(cpuData, dims, imageSize) {
        const grids = [];
        const expandedStrides = [];

        const strides = [8, 16, 32];

        const hSizes = strides.map(stride => Math.floor(imageSize[0] / stride));
        const wSizes = strides.map(stride => Math.floor(imageSize[1] / stride));

        for (let i = 0; i < strides.length; i++) {
            const hsize = hSizes[i];
            const wsize = wSizes[i];
            const stride = strides[i];

            const xv = Array.from({ length: wsize }, (_, x) => x);
            const yv = Array.from({ length: hsize }, (_, y) => y);

            const grid = [];
            for (let y = 0; y < yv.length; y++) {
                for (let x = 0; x < xv.length; x++) {
                    grid.push([xv[x], yv[y]]);
                }
            }
            grids.push(grid);

            const expandedStride = Array.from({ length: grid.length }, () => [stride]);
            expandedStrides.push(expandedStride);
        }

        const flatGrids = grids.flat();
        const flatExpandedStrides = expandedStrides.flat();

        const tensor = tf.tensor(cpuData);
        const reshapedTensor = tf.reshape(tensor, dims);

        const outputs = reshapedTensor.arraySync();
        const [h, w, _c] = dims;

        function adjustBoundingBoxCoordinates(output, grid, expandedStride) {
            return (output + grid) * expandedStride;
        }

        for (let i = 0; i < h; i++) {
            for (let j = 0; j < w; j++) {
                const grid = flatGrids[j];
                const expandedStride = flatExpandedStrides[j][0];

                outputs[i][j][0] = adjustBoundingBoxCoordinates(outputs[i][j][0], grid[0], expandedStride);
                outputs[i][j][1] = adjustBoundingBoxCoordinates(outputs[i][j][1], grid[1], expandedStride);

                outputs[i][j][2] = Math.exp(outputs[i][j][2]) * expandedStride;
                outputs[i][j][3] = Math.exp(outputs[i][j][3]) * expandedStride;
            }
        }

        return tf.tensor(outputs[0]);
    }

    /**
     * Calculates bounding box coordinates.
     * 
     * @private
     * @param {tf.Tensor} boxes - A tensor containing bounding box coordinates in the format [centerX, centerY, width, height].
     * @param {number} ratio - The ratio by which to adjust the bounding box coordinates.
     * @returns {tf.Tensor} A tensor containing the calculated bounding box coordinates in the format [xMin, yMin, xMax, yMax].
     */
    _calcBbox(boxes, ratio) {
        const boxesOutput = boxes.arraySync();

        const results = [];
        for (let i = 0; i < boxesOutput.length; i++) {
            const boxes = boxesOutput[i];

            const result = [
                (boxes[0] - boxes[2] / 2) / ratio,
                (boxes[1] - boxes[3] / 2) / ratio,
                (boxes[0] + boxes[2] / 2) / ratio,
                (boxes[1] + boxes[3] / 2) / ratio,
            ];
            results.push(result);
        }

        const resultTensor = tf.tensor(results);

        return resultTensor;
    }

    /**
     * Extracts the bounding box coordinates (x1, y1, x2, y2) from the given boxes based on the specified order.
     * 
     * @private
     * @param {Array} boxes - An array of bounding boxes, where each box is represented as [x1, y1, x2, y2].
     * @param {Array<number>} [orders=undefined] - An optional array of indices specifying the order in which to extract the boxes. If not provided, the boxes are extracted in the original order.
     * @returns {Array<tf.Tensor>} An array of tensors representing the extracted coordinates: [x1, y1, x2, y2].
     */
    _getCurrentBox(boxes, orders = undefined) {
        if (orders == undefined) {
            orders = Array.from({ length: boxes.length }, (_, i) => i);
        }

        const x1 = [];
        const y1 = [];
        const x2 = [];
        const y2 = [];

        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];

            x1.push(boxes[order][0]);
            y1.push(boxes[order][1]);
            x2.push(boxes[order][2]);
            y2.push(boxes[order][3]);
        }

        return [
            tf.tensor(x1),
            tf.tensor(y1),
            tf.tensor(x2),
            tf.tensor(y2)
        ];
    }

    /**
     * Filters the indices of an array based on the given threshold. Only indices where the corresponding value is less than or equal to the threshold are returned.
     * 
     * @private
     * @param {Array<number>} ovr - An array of values to be compared against the threshold.
     * @param {number} nmsThr - The threshold value. Indices with values less than or equal to this threshold will be included in the result.
     * @returns {Array<number>} An array of indices where the corresponding value in `ovr` is less than or equal to `nmsThr`.
     */
    _where(ovr, nmsThr) {
        const result = [];

        for (let i = 0; i < ovr.length; i++) {
            if (ovr[i] <= nmsThr) {
                result.push(i);
            }
        }

        return result;
    }

    /**
     * Single class NMS implemented in JS.
     * 
     * @private
     * @param {Array<Array<number>>} boxes - An array of bounding boxes, where each box is represented as [x1, y1, x2, y2].
     * @param {Array<number>} scores - An array of scores corresponding to each bounding box.
     * @param {number} nmsThr - The threshold for the overlap ratio. Boxes with an overlap greater than this threshold will be suppressed.
     * @returns {Array<number>} An array of indices representing the boxes that are kept after NMS.
     */
    _nms(boxes, scores, nmsThr) {
        let order = argSort(scores);
        const keep = [];

        const [x1, y1, x2, y2] = this._getCurrentBox(boxes);
        const areas = tf.mul(x2.sub(x1).add(1), y2.sub(y1).add(1));

        while (order.length > 0) {
            const orderTensor = tf.tensor(order, [order.length], 'int32');

            const i = order[0];
            keep.push(i);

            const [x1, y1, x2, y2] = this._getCurrentBox(boxes, order);

            const xx1 = tf.maximum(x1.slice(0, 1), x1.slice(1));
            const yy1 = tf.maximum(y1.slice(0, 1), y1.slice(1));
            const xx2 = tf.minimum(x2.slice(0, 1), x2.slice(1));
            const yy2 = tf.minimum(y2.slice(0, 1), y2.slice(1));

            const w = tf.maximum(0.0, xx2.sub(xx1).add(1));
            const h = tf.maximum(0.0, yy2.sub(yy1).add(1));

            const inter = w.mul(h);

            const ovr = inter.div(tf.add(areas.slice(0, 1), tf.gather(areas, orderTensor).slice(1)).sub(inter))
            
            const inds = this._where(ovr.arraySync(), nmsThr);

            order = tf.gather(orderTensor, tf.tensor(inds, undefined, 'int32').add(1).toInt()).arraySync();
        }
        
        return keep;
    }

    /**
     * Multiclass NMS implemented in JS. Class-agnostic version.
     * 
     * @private
     * @param {Array<Array<number>>} boxes - An array of bounding boxes, where each box is represented as [x1, y1, x2, y2].
     * @param {Array<Array<number>>} scores - An array of scores for each bounding box, typically representing object detection confidence.
     * @param {number} nmsThr - The threshold for the overlap ratio. Boxes with an overlap greater than this threshold will be suppressed.
     * @param {number} scoreThr - The threshold for the score. Only boxes with a score greater than this threshold will be considered for NMS.
     * @returns {Array<Array<number>>} An array of bounding boxes after NMS, where each box is represented as [x1, y1, x2, y2].
     */
    _multiclassNmsClassAgnostic(boxes, scores, nmsThr, scoreThr) {
        const clsScores = scores.flatten().arraySync();
        const clsBoxes = boxes.arraySync();

        const validScores = [];
        const validBoxes = [];
        for (let i = 0; i < clsScores.length; i++) {
            if (clsScores[i] > scoreThr) {
                validScores.push(clsScores[i]);
                validBoxes.push(clsBoxes[i]);
            }
        }

        const detections = [];

        const keep = this._nms(validBoxes, validScores, nmsThr);
        for (let i = 0; i < keep.length; i++) {
            const targetIdx = keep[i];

            const [x1, y1, x2, y2] = validBoxes[targetIdx];

            detections.push([x1, y1, x2, y2]);
        }

        return detections;
    }

    /**
     * Multiclass NMS implemented in JS.
     * 
     * @private
     * @param {Array<Array<number>>} boxes - An array of bounding boxes, where each box is represented as [x1, y1, x2, y2].
     * @param {Array<Array<number>>} scores - An array of scores for each bounding box, typically representing object detection confidence.
     * @param {number} nmsThr - The threshold for the overlap ratio. Boxes with an overlap greater than this threshold will be suppressed.
     * @param {number} scoreThr - The threshold for the score. Only boxes with a score greater than this threshold will be considered for NMS.
     * @returns {Array<Array<number>>} An array of bounding boxes after NMS, where each box is represented as [x1, y1, x2, y2].
     */
    _multiclassNms(boxes, scores, nmsThr, scoreThr) {
        return this._multiclassNmsClassAgnostic(boxes, scores, nmsThr, scoreThr);
    }

    /**
     * 
     * 
     * @param {Array<Array<number>>} prediction - An array of bounding boxes after NMS, where each box is represented as [x1, y1, x2, y2].
     * @param {number} width - The width of image.
     * @param {number} height - The heigth of image.
     * @returns {Array<Array<number>>} An array of bounding boxes, where each box is represented as [x1, y1, x2, y2].
     */
    _parseToXyxy(prediction, width, height) {
        const result = [];

        let minX, maxX, minY, maxY;
        for (let i = 0; i < prediction.length; i++) {
            const [x1, y1, x2, y2] = prediction[i];

            if (x1 < 0) minX = 0;
            else minX = parseInt(x1);

            if (y1 < 0) minY = 0;
            else minY = parseInt(y1);

            if (x2 > width) maxX = width;
            else maxX = parseInt(x2);

            if (y2 > height) maxY = height;
            else maxY = parseInt(y2);

            result.push([minX, minY, maxX, maxY]);
        }

        return result;
    }

    /**
     * 
     * @param {Float32Array} cpuData - The raw OCR data as a `Float32Array`.
     * @param {number[]} dims - The dimensions of the result tensor.
     * @param {number[]} inputSize - The target input size [height, width] for the model.
     * @param {number} width- The width of the image.
     * @param {number} height - The height of the image.
     * @param {number} ratio - The resizing ratio used to scale the image dimensions.
     * @returns {Array<Array<number>>} An array of bounding boxes, where each box is represented as [x1, y1, x2, y2]. 
     */
    _postProcess(cpuData, dims, inputSize, width, height, ratio) {
        const predictions = this._demoPostProcess(cpuData, dims, inputSize);

        const boxes = predictions.slice([0, 0], [-1, 4]);
        const scores = predictions.slice([0, 4], [-1, 1]).mul(predictions.slice([0, 5], [-1, 1]));

        const boxesXyxy = this._calcBbox(boxes, ratio);

        const prediction = this._multiclassNms(boxesXyxy, scores, 0.45, 0.1);

        const result = this._parseToXyxy(prediction, width, height);

        return result;
    }
}

module.exports = {
    DetectionBase
}