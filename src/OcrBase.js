const tf = require('@tensorflow/tfjs');
const { Jimp } = require('jimp');

/**
 * Charset range constants that define different character sets for OCR.
 * These constants represent various combinations of character types (lowercase, uppercase, numeric).
 * 
 * @readonly
 * @enum {number}
 */
const CHARSET_RANGE = {
    /**
     * Character set containing only numeric characters.
     * @type {number}
     */
    NUM_CASE: 0,
    /**
     * Character set containing only lowercase characters.
     * @type {number}
     */
    LOWWER_CASE: 1,
    /**
     * Character set containing only uppercase characters.
     * @type {number}
     */
    UPPER_CASE: 2,
    /**
     * Character set containing both lowercase and uppercase characters.
     * @type {number}
     */
    MIX_LOWWER_UPPER_CASE: 3,
    /**
     * Character set containing both lowercase and numeric characters.
     * @type {number}
     */
    MIX_LOWWER_NUM_CASE: 4,
    /**
     * Character set containing both uppercase and numeric characters.
     * @type {number}
     */
    MIX_UPPER_NUM_CASE: 5,
    /**
     * Character set containing lowercase, uppercase, and numeric characters.
     * @type {number}
     */
    MIX_LOWWER_UPPER_NUM_CASE: 6,
    /**
     * Character set containing neither lowercase, uppercase, nor numeric characters.
     * @type {number}
     */
    NO_LOWEER_UPPER_NUM_CASE: 7,
}

const NUM_CASE = '0123456789';
const LOWWER_CASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPER_CASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MIX_LOWWER_UPPER_CASE = LOWWER_CASE + UPPER_CASE;
const MIX_LOWWER_NUM_CASE = LOWWER_CASE + NUM_CASE;
const MIX_UPPER_NUM_CASE = UPPER_CASE + NUM_CASE;
const MIX_LOWER_UPPER_NUM_CASE = LOWWER_CASE + UPPER_CASE + NUM_CASE;

class OCRBase {
    /**
     * @type {string} Path to the ONNX model for standard OCR.
     * @private
     */
    _ocrOnnxPath = '';
    /**
     * @type {string} Path to the charset file for standard OCR.
     * @private
     */
    _charsetPath = '';

    /**
     * @type {Set<string>} A set of valid characters for OCR recognition.
     * @private
     */
    _validCharSet = new Set([]);
    /**
     * @type {Set<string>} A set of invalid characters for OCR recognition.
     * @private
     */
    _inValidCharSet = new Set([]);

    constructor(onnxPath, charsetPath) {
        this._ocrOnnxPath = onnxPath;
        this._charsetPath = charsetPath;
    }

    /**
     * Sets the valid character set.
     * 
     * @public
     * @param {string} charset - A string containing the characters to define the valid character set.
     * @returns {DdddOcr} The current instance for method chaining.
     */
    setValidCharSet(charset) {
        this._validCharSet = new Set(charset);

        return this;
    }

    /**
     * Sets the invalid character set.
     * 
     * @public
     * @param {string} charset - A string containing the characters to define the invalid character set.
     * @returns {DdddOcr} The current instance for method chaining.
     */
    setInValidCharset(charset) {
        this._inValidCharSet = new Set(charset);

        return this;
    }

    /**
     * Checks if a character is valid based on the defined valid and invalid character sets.
     * 
     * @private
     * @param {string} char - The character to validate.
     * @returns {boolean} `true` if the character is valid, `false` otherwise.
     */
    _isValidChar(char) {
        if (this._inValidCharSet.has(char)) {
            return false;
        }

        if (this._validCharSet.size == 0) {
            return true;
        }

        return this._validCharSet.has(char);
    }

    /**
     * Sets the range restriction for OCR results.
     * 
     * This method restricts the characters returned by OCR based on the input:
     * - For `number` input, it applies a predefined character set. Supported values are:
     *   - `0`: Digits (0-9)
     *   - `1`: Lowercase letters (a-z)
     *   - `2`: Uppercase letters (A-Z)
     *   - `3`: Lowercase + Uppercase letters
     *   - `4`: Lowercase letters + Digits
     *   - `5`: Uppercase letters + Digits
     *   - `6`: Lowercase + Uppercase letters + Digits
     *   - `7`: Default set (a-z, A-Z, 0-9)
     * - For `string` input, each character in the string is treated as a valid OCR result.
     * 
     * @public
     * @param {number|string} charsetRange - A number for predefined character sets or a string for a custom character set.
     * @returns {DdddOcr} The current instance for method chaining.
     * @throws {Error} Throws an error if the input type or value is not supported.`
     */
    setRanges(charsetRange) {
        switch (typeof(charsetRange)) {
            case 'number': {
                switch (charsetRange) {
                    case CHARSET_RANGE.NUM_CASE: {
                        this.setValidCharSet(NUM_CASE);
                        break;
                    }
                    case CHARSET_RANGE.LOWWER_CASE: {
                        this.setValidCharSet(LOWWER_CASE);
                        break;
                    }
                    case CHARSET_RANGE.UPPER_CASE: {
                        this.setValidCharSet(UPPER_CASE);
                        break;
                    }
                    case CHARSET_RANGE.MIX_LOWWER_UPPER_CASE: {
                        this.setValidCharSet(MIX_LOWWER_UPPER_CASE);
                        break;
                    }
                    case CHARSET_RANGE.MIX_LOWWER_NUM_CASE: {
                        this.setValidCharSet(MIX_LOWWER_NUM_CASE);
                        break;
                    }
                    case CHARSET_RANGE.MIX_UPPER_NUM_CASE: {
                        this.setValidCharSet(MIX_UPPER_NUM_CASE);
                        break;
                    }
                    case CHARSET_RANGE.MIX_LOWWER_UPPER_NUM_CASE: {
                        this.setValidCharSet(MIX_LOWER_UPPER_NUM_CASE);
                        break;
                    }
                    case CHARSET_RANGE.NO_LOWEER_UPPER_NUM_CASE: {
                        this.setInValidCharset(MIX_LOWER_UPPER_NUM_CASE);
                        break;
                    }
                    default: {
                        throw new Error('Not support type');
                    }
                }
                break;
            }
            case 'string': {
                this.setValidCharSet(charsetRange);
                break
            }
            default: {
                throw new Error('Not support type');
            }
        }

        return this;
    }

    /**
     * Parses the given `argmaxData` array into a string using the provided character set.
     * 
     * The method iterates through the `argmaxData`, ensuring consecutive repeated items are skipped, 
     * and converts the data into valid characters based on the provided `charset`. 
     * The valid characters are checked using `_isValidChar`, and only valid characters are included in the final result.
     * 
     * @private
     * @param {number[]} argmaxData - An array of indices representing the OCR output. Each element corresponds to a character index in the `charset`.
     * @param {string[]} charset - An array of characters corresponding to the indices in `argmaxData`.
     * @returns {string} The parsed string formed by valid characters from `argmaxData` based on `charset`.
     */
    _parseToChar(argmaxData, charset) {
        const result = [];

        let lastItem = 0;
        for (let i = 0; i < argmaxData.length; i++) {
            if (argmaxData[i] == lastItem) {
                continue;
            } else {
                lastItem = argmaxData[i];
            }

            const char = charset[argmaxData[i]];
            if (argmaxData[i] != 0 && this._isValidChar(char)) {
                result.push(char);
            }
        }

        return result.join('');
    }

    async _preProcessImage(url) {
        const image = await Jimp.read(url);

        const { width, height } = image.bitmap;
        const targetHeight = 64;
        const targetWidth = Math.floor(width * (targetHeight / height));
        image.resize({
            w: targetWidth, 
            h: targetHeight
        });
        image.greyscale();

        const { data } = image.bitmap;
        const floatData = new Float32Array(targetWidth * targetHeight);
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
            floatData[j] = (data[i] / 255.0 - 0.5) / 0.5;
        }

        return {
            floatData,
            targetHeight,
            targetWidth
        };
    }

    async postProcess(cpuData, dims, charset) {
        const tensor = tf.tensor(cpuData);
        const reshapedTensor = tf.reshape(tensor, dims);
        const argmaxResult = tf.argMax(reshapedTensor, 2);
        const argmaxData = await argmaxResult.data();

        const result = this._parseToChar(argmaxData, charset);

        return result;
    }
}

module.exports = {
    CHARSET_RANGE,
    OCRBase
}