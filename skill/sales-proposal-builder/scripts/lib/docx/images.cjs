"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logoImage = logoImage;
// Compiled from src/skill/lib/docx/images.cts. Edit the source, then run npm run build.
const docx_1 = require("docx");
const theme_cjs_1 = require("./theme.cjs");
/** The company logo, scaled into a box with its aspect ratio kept. */
function logoImage(logo, box, company) {
    return new docx_1.ImageRun({
        type: logo.type,
        data: logo.data,
        transformation: (0, theme_cjs_1.fitLogo)(logo.width, logo.height, box),
        altText: { name: `${company} logo`, description: `${company} logo`, title: company },
    });
}
