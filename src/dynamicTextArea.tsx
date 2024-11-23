import preact from "preact";
import { css } from "typesafecss";
import { lazy } from "socket-function/src/caching";
import { Input } from "./misc/Input";

export function dynamicTextArea(config: {
    text: string;
    onChange: (text: string) => void;
}) {
    let lines = getLineCount({
        caption: config.text,
        fontSize: 10,
        widthPixels: window.innerWidth - 200,
        fontFamily: "Verdana",
    });
    let lineHeight = measureTextHeight({
        text: config.text,
        fontSize: 10,
        fontFamily: "Verdana",
    });

    console.log({ lines, lineHeight });

    return (
        <Input
            textarea
            value={config.text}
            className={css.height(lineHeight * (lines + 3))}
            noFocusSelect
            fillWidth
            focusOnMount
            onChangeValue={v => config.onChange(v)}
        />
    );
}

let cachedCanvas = lazy(() => {
    let canvas = document.createElement("canvas");
    canvas.width = 2000;
    canvas.height = 400;

    let context = canvas.getContext("2d");
    if (!context) throw new Error("No context");
    return { canvas, context };
});
function measureTextWidth(config: {
    text: string;
    fontSize: number;
    fontFamily: string;
}): number {
    let { canvas, context } = cachedCanvas();
    context.font = `${config.fontSize}px ${config.fontFamily}`;
    return context.measureText(config.text).width;
}
function measureTextHeight(config: {
    text: string;
    fontSize: number;
    fontFamily: string;
}): number {
    let { canvas, context } = cachedCanvas();
    context.font = `${config.fontSize}px ${config.fontFamily}`;
    let measureObj = context.measureText(config.text);
    return measureObj.fontBoundingBoxAscent + measureObj.fontBoundingBoxDescent;
}

function getLineCount(config: {
    fontSize: number;
    caption: string;
    widthPixels: number;
    fontFamily: string;
}) {
    let { caption, fontSize, widthPixels, fontFamily } = config;
    let totalLineCount = 0;
    let lines: string[] = caption.split("\n");
    for (let line of lines) {
        if (!line.trim()) {
            totalLineCount++;
            continue;
        }
        let words = line.split(" ");
        let realLines: string[] = [];
        let currentLine = "";
        for (let word of words) {
            let newLine = currentLine + (currentLine ? " " : "") + word;
            let width = measureTextWidth({ text: newLine, fontSize, fontFamily });
            if (width > widthPixels) {
                realLines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = newLine;
            }
        }
        if (currentLine) realLines.push(currentLine);
        totalLineCount += realLines.length;
    }
    return totalLineCount;
}
