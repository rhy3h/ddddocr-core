import tf from '@tensorflow/tfjs'
import { Jimp } from 'jimp';

/**
 * Charset range constants that define different character sets for OCR.
 * These constants represent various combinations of character types (lowercase, uppercase, numeric).
 */
enum CHARSET_RANGE {
    /**
     * Character set containing only numeric characters.
     */
    NUM_CASE = 0,
    /**
     * Character set containing only lowercase characters.
     */
    LOWER_CASE = 1,
    /**
     * Character set containing only uppercase characters.
     */
    UPPER_CASE = 2,
    /**
     * Character set containing both lowercase and uppercase characters.
     */
    MIX_LOWER_UPPER_CASE = 3,
    /**
     * Character set containing both lowercase and numeric characters.
     */
    MIX_LOWER_NUM_CASE = 4,
    /**
     * Character set containing both uppercase and numeric characters.
     */
    MIX_UPPER_NUM_CASE = 5,
    /**
     * Character set containing lowercase, uppercase, and numeric characters.
     */
    MIX_LOWER_UPPER_NUM_CASE = 6,
    /**
     * Character set containing neither lowercase, uppercase, nor numeric characters.
     */
    NO_LOWER_UPPER_NUM_CASE = 7,
}

const NUM_CASE = '0123456789';
const LOWER_CASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPER_CASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MIX_LOWER_UPPER_CASE = LOWER_CASE + UPPER_CASE;
const MIX_LOWER_NUM_CASE = LOWER_CASE + NUM_CASE;
const MIX_UPPER_NUM_CASE = UPPER_CASE + NUM_CASE;
const MIX_LOWER_UPPER_NUM_CASE = LOWER_CASE + UPPER_CASE + NUM_CASE;

/**
 * @ignore
 */
class OCRBase {
    /**
     * Path to the ONNX model for standard OCR.
     */
    protected _ocrOnnxPath: string;
    /**
     * Path to the charset file for standard OCR.
     */
    protected _charsetPath: string;

    /**
     * A set of valid characters for OCR recognition.
     */
    private _validCharSet: Set<string> = new Set();
    /**
     * A set of invalid characters for OCR recognition.
     */
    private _inValidCharSet: Set<string> = new Set();

    /**
     * OCRBase
     */
    constructor(onnxPath: string, charsetPath: string) {
        this._ocrOnnxPath = onnxPath;
        this._charsetPath = charsetPath;
    }

    /**
     * Sets the valid character set.
     */
    public setValidCharSet(charset: string): this {
        this._validCharSet = new Set(charset);

        return this;
    }

    /**
     * Sets the invalid character set.
     */
    public setInValidCharset(charset: string): this {
        this._inValidCharSet = new Set(charset);

        return this;
    }

    /**
     * Checks if a character is valid based on the defined valid and invalid character sets.
     */
    private isValidChar(char: string): boolean {
        if (this._inValidCharSet.has(char)) {
            return false;
        }

        if (this._validCharSet.size === 0) {
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
     */
    public setRanges(charsetRange: number | string): this {
        if (typeof charsetRange === 'number') {
            switch (charsetRange) {
                case CHARSET_RANGE.NUM_CASE:
                    this.setValidCharSet(NUM_CASE);
                    break;
                case CHARSET_RANGE.LOWER_CASE:
                    this.setValidCharSet(LOWER_CASE);
                    break;
                case CHARSET_RANGE.UPPER_CASE:
                    this.setValidCharSet(UPPER_CASE);
                    break;
                case CHARSET_RANGE.MIX_LOWER_UPPER_CASE:
                    this.setValidCharSet(MIX_LOWER_UPPER_CASE);
                    break;
                case CHARSET_RANGE.MIX_LOWER_NUM_CASE:
                    this.setValidCharSet(MIX_LOWER_NUM_CASE);
                    break;
                case CHARSET_RANGE.MIX_UPPER_NUM_CASE:
                    this.setValidCharSet(MIX_UPPER_NUM_CASE);
                    break;
                case CHARSET_RANGE.MIX_LOWER_UPPER_NUM_CASE:
                    this.setValidCharSet(MIX_LOWER_UPPER_NUM_CASE);
                    break;
                case CHARSET_RANGE.NO_LOWER_UPPER_NUM_CASE:
                    this.setInValidCharset(MIX_LOWER_UPPER_NUM_CASE);
                    break;
                default:
                    throw new Error('Not supported type');
            }
        } else if (typeof charsetRange === 'string') {
            this.setValidCharSet(charsetRange);
        } else {
            throw new Error('Not supported type');
        }

        return this;
    }

    /**
     * Parses the given `argmaxData` array into a string using the provided character set.
     * 
     * The method iterates through the `argmaxData`, ensuring consecutive repeated items are skipped, 
     * and converts the data into valid characters based on the provided `charset`. 
     * The valid characters are checked using `isValidChar`, and only valid characters are included in the final result.
     */
    private parseToChar(argmaxData: number[], charset: string[]): string {
        const result: string[] = [];

        let lastItem = 0;
        for (let i = 0; i < argmaxData.length; i++) {
            if (argmaxData[i] === lastItem) {
                continue;
            }

            lastItem = argmaxData[i];

            const char = charset[argmaxData[i]];
            if (argmaxData[i] !== 0 && this.isValidChar(char)) {
                result.push(char);
            }
        }

        return result.join('');
    }

    protected async _preProcessImage(url: string): Promise<{ floatData: Float32Array; targetHeight: number; targetWidth: number }> {
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

        return { floatData, targetHeight, targetWidth };
    }

    protected async postProcess(cpuData: number[], dims: number[], charset: string[]): Promise<string> {
        const tensor = tf.tensor(cpuData);
        const reshapedTensor = tf.reshape(tensor, dims);
        const argmaxResult = tf.argMax(reshapedTensor, 2);

        const argmaxData = await argmaxResult.data();

        const result = this.parseToChar(Array.from(argmaxData), charset);

        return result;
    }
}

export { OCRBase, CHARSET_RANGE }