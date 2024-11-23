import debugbreak from "debugbreak";
import "./src/main";
import fs from "fs";


async function* walk(dir: string): AsyncGenerator<string> {
    for await (const d of await fs.promises.opendir(dir)) {
        const entry = `${dir}/${d.name}`;
        if (entry.includes("/node_modules/")) continue;
        if (entry.includes("/.git/")) continue;
        if (entry.includes("/build/")) continue;
        if (d.isDirectory()) {
            yield* walk(entry);
        } else if (d.isFile()) {
            yield entry;
        }
    }
}
async function recursiveDelete(dir: string) {
    for await (const d of await fs.promises.opendir(dir)) {
        const entry = `${dir}/${d.name}`;
        if (d.isDirectory()) {
            await recursiveDelete(entry);
        } else if (d.isFile()) {
            await fs.promises.unlink(entry);
        }
    }
    await fs.promises.rmdir(dir);
}


setImmediate(async () => {
    await build();
});


async function build() {
    let time = Date.now();
    let target = "./build/";
    await fs.promises.mkdir(target, { recursive: true });
    //await recursiveDelete(target);

    let pathsToCopy: string[] = [];
    pathsToCopy.push("/src/buffer.js");

    let curDir = __dirname.replaceAll("\\", "/");
    for (let module of Object.values(require.cache)) {
        if (!module) continue;
        let path = module.filename.replaceAll("\\", "/");
        if (path.includes("/node_modules/typenode/")) continue;
        if (path.includes("/node_modules/typescript/")) continue;
        if (path === __filename.replaceAll("\\", "/")) continue;
        if (path.endsWith(".ts") || path.endsWith(".tsx")) {
            let dir = path.split("/").slice(0, -1).join("/");
            let name = path.split("/").slice(-1)[0];
            let cachePath = `${dir}/dist/${name}.cache`;
            if (fs.existsSync(cachePath)) {
                path = cachePath;
            }
        }
        pathsToCopy.push(path);
    }

    // Recursive read files, and copy all .png and .html files
    for await (let path of walk(curDir)) {
        if (path.endsWith(".png") || path.endsWith(".html")) {
            pathsToCopy.push(path);
        }
    }

    let unchanged = 0;

    for (let path of pathsToCopy) {
        path = path.replace(curDir, "");
        let newPath = target + path;
        newPath = newPath.replaceAll("//", "/");
        // Copy the file, creating parent directories if needed
        let dir = newPath.split("/").slice(0, -1).join("/");
        let fixImports = false;
        if (newPath.endsWith(".cache")) {
            if (dir.endsWith("/dist")) {
                dir = dir.slice(0, -"/dist".length);
                newPath = newPath.replace("/dist/", "/");
            }
            if (newPath.endsWith(".ts.cache")) {
                newPath = newPath.replace(".ts.cache", ".js");
                fixImports = true;
            }
            if (newPath.endsWith(".tsx.cache")) {
                newPath = newPath.replace(".tsx.cache", ".js");
                fixImports = true;
            }
        }
        // preact uses exports, as do probably others. So... just fix imports on everything...
        if (newPath.endsWith(".js") || newPath.endsWith(".cjs")) {
            fixImports = true;
        }
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        if (fixImports) {
            let source = curDir + path;
            async function getMTime(path: string): Promise<number> {
                try {
                    return (await fs.promises.stat(path)).mtimeMs;
                } catch {
                    return 0;
                }
            }
            let sourceMTime = await getMTime(source);
            let newMTime = await getMTime(newPath);
            // Probably unchanged, so just leave it
            if (newMTime > sourceMTime) {
                unchanged++;
                continue;
            }

            let contents = await fs.promises.readFile(source, "utf8");
            contents = contents.replaceAll(`Object.defineProperty(exports, "__esModule", { value: true , configurable: true});`, "");
            contents = convertExportsToExport(contents);
            contents = convertImports(contents, newPath);
            await fs.promises.writeFile(newPath, contents);
        } else {
            await fs.promises.copyFile(curDir + path, newPath);
        }
    }

    let end = Date.now();
    console.log(`Copied ${pathsToCopy.length - unchanged} in ${end - time}ms at ${new Date().toLocaleTimeString()}`);
}


function convertExportsToExport(code: string): string {
    let hasExports = code.includes("exports.") || code.includes("module.exports");
    if (!hasExports) return code;
    return `
    let exports = {};
    let module = { exports };
    ${code}
    ;
    export default exports;
    `;
}

function convertImports(code: string, path: string): string {
    const lines = code.split("\n");
    let braceCount = 0;
    let inString = false;
    let inComment = false;
    let stringChar = "";

    const processedLines = lines.map((line) => {
        let shouldReplace = braceCount === 0;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (!inComment && !inString) {
                if (char === "{") braceCount++;
                else if (char === "}") braceCount--;
                else if (char === "\"" || char === "'" || char === "`") {
                    inString = true;
                    stringChar = char;
                }
                else if (char === "/" && line[i + 1] === "/") {
                    break; // Rest of the line is a comment
                }
                else if (char === "/" && line[i + 1] === "*") {
                    inComment = true;
                    i++; // Skip next character
                }
            } else if (inString) {
                if (char === stringChar) {
                    if (stringChar === "`" || line[i - 1] !== "\\") {
                        inString = false;
                    }
                }
            } else if (inComment) {
                if (char === "*" && line[i + 1] === "/") {
                    inComment = false;
                    i++; // Skip next character
                }
                break; // Rest of the line is a comment
            }
        }

        return shouldReplace ? replaceLine(code, path, line) : line;
    });

    code = processedLines.join("\n");
    // Strip source map, because we broke it
    code = code.replace(/\/\/# sourceMappingURL=.+/, "");
    return code;
}
function replaceLine(code: string, path: string, line: string) {
    return line.replace(
        /const (\w+) = __importDefault\(require\("(.+?)"\)\);/g,
        (_, variableName, importPath: string) => {
            return createImport({ variableName, importPath, filePath: path, code });
        }
    ).replace(
        /Promise\.resolve\(\)\.then\(\(\) => __importStar\(require\("(.+?)"\)\)\);/g,
        (_, path) => `import("${path}");`
    ).replace(
        // const mobx = __importStar(require("mobx/dist/mobx.cjs.development.js"));
        /const (\w+) = __importStar\(require\("(.+?)"\)\);/g,
        // import * as mobx from "mobx/dist/mobx.cjs.development.js";
        (_, variableName, importPath) => {
            return createImport({ variableName, importPath, filePath: path, code });
        }
    ).replace(
        /(?:const|var)\s+(\w+)\s*=\s*require\(\s*["'](.+)["']\s*\);?\s*/g,
        (_, variableName, importPath) => {
            return createImport({ variableName, importPath, filePath: path, code });
        }
    ).replace(
        // const { ? } = require("?");
        /(?:const|var)\s+(.+?)\s*=\s*require\(\s*["'](.+?)["']\s*\);?\s*/g,
        (_, variableName, importPath) => {
            let fileNameVariable = importPath.replaceAll("/", "_").replace(/\W/g, "");
            return (
                createImport({ variableName: fileNameVariable, importPath, filePath: path, code, forceDefault: true })
                + `\nconst ${variableName} = ${fileNameVariable}.default || ${fileNameVariable};`
            );
        }
    ).replace(
        /^require\(\s*["'](.+)["']\s*\);?\s*/g,
        (_, importPath) => {
            return `\nimport "${importPath}";`;
        }
    )
        // .replace(
        //     // Add .js, if it's missing
        //     // .* from './BrowserCodeReader'; => .* from './BrowserCodeReader.js';
        //     /from\s+['"](.+)['"]/g,
        //     (_, importPath) => {
        //         if (importPath.endsWith(".js") || importPath.endsWith(".cjs") || importPath.endsWith(".ts") || importPath.endsWith(".tsx")) {
        //             return `from "${importPath}"`;
        //         } else {
        //             // Check if it is relative. If NOT, then resolve the build in module
        //             if (!importPath.startsWith(".")) {
        //                 try {
        //                     let fullPath = require.resolve(importPath);
        //                     if (fullPath.includes(".")) {
        //                         let relativePath = fullPath.replace(__dirname, ".");
        //                         let depth = path.split("/").length - 3;
        //                         if (depth > 0) {
        //                             relativePath = "../".repeat(depth) + relativePath;
        //                         }
        //                         importPath = relativePath.replaceAll("\\", "/");
        //                         if (fullPath.includes("custom-error")) {
        //                             console.log(importPath, fullPath, path);
        //                         }
        //                     }
        //                 } catch { }
        //             }
        //             if (!importPath.endsWith(".js")) {
        //                 importPath = importPath + ".js";
        //             }

        //             return `from "${importPath}"`;
        //         }
        //     }
        // );
        ;
}

function createImport(config: {
    variableName: string;
    importPath: string;
    filePath: string;
    code: string;
    forceDefault?: boolean;
}) {
    let modulePath = config.importPath;
    let variableName = config.variableName;
    let path = config.filePath;
    let code = config.code;
    let forceDefault = config.forceDefault;


    if (!modulePath.startsWith(".")) {
        let fullPath = require.resolve(modulePath);
        if (!fullPath.includes(".")) {
            // It's a built-in module, So... remove it/
            return ``;
        } else {
            let relativePath = fullPath.replace(__dirname, ".");
            modulePath = relativePath.replaceAll("\\", "/");
            let depth = path.split("/").length - 3;
            if (depth > 0) {
                modulePath = "../".repeat(depth) + modulePath;
            }
        }
    }
    if (modulePath.endsWith(".ts") || modulePath.endsWith(".tsx")) {
        modulePath = modulePath.replace(/\.tsx?$/, "");
    }

    let usesDefaultExportsExplicitly = code.includes(`${variableName}.default`);
    const modulePathWithExtension = (modulePath.endsWith(".js") || modulePath.endsWith(".cjs")) ? modulePath : `${modulePath}.js`;
    // Hmm... this logic is backwards. Why...
    if (!usesDefaultExportsExplicitly || forceDefault) {
        return `import ${variableName} from "${modulePathWithExtension}";`;
    } else {
        return `import * as ${variableName} from "${modulePathWithExtension}";`;
    }
}