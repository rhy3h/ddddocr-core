const { DetectionBase } = require('./src/DetectionBase');
const { CHARSET_RANGE, OCRBase } = require('./src/OcrBase');
const { drawRectangle } = require('./utils/image-utils');

module.exports = {
    CHARSET_RANGE,
    OCRBase,
    DetectionBase,
    drawRectangle
}