const { DetectionBase } = require('./DetectionBase');
const { CHARSET_RANGE, OCRBase } = require('./OcrBase');
const { drawRectangle } = require('./utils/image-utils');

module.exports = {
    CHARSET_RANGE,
    OCRBase,
    DetectionBase,
    drawRectangle
}