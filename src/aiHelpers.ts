import { canHaveChildren } from "socket-function/src/types";
import { JSONLACKS } from "socket-function/src/JSONLACKS/JSONLACKS";
import yaml from "yaml";

export type JSONObject = undefined | null | boolean | number | string | JSONObject[] | { [key: string]: JSONObject };
export function parseJSONGPTOutput(
    json: string | JSONObject,
    config?: {
        // NOTE: This requires the input to be yaml or json (pure strings aren't allowed)
        throwOnError?: boolean;
    }
): string | JSONObject {
    if (canHaveChildren(json)) return json;
    if (typeof json !== "string") return "";
    json = json.trim();
    if (!json) return "";
    let tryHardToParseJSON = false;
    if (json.startsWith("```json\n")) {
        json = json.slice("```json\n".length);
    }
    if (json.startsWith("```yaml\n")) {
        json = json.slice("```yaml\n".length);
        tryHardToParseJSON = true;
    }
    if (json.endsWith("```")) {
        json = json.slice(0, -"```".length);
    }
    if (json.startsWith("```") && json.endsWith("```")) {
        json = json.split("\n").slice(1, -1).join("\n");
    }
    if (!json.startsWith("{") && !json.startsWith("[")) {
        try {
            return yaml.parse(json);
        } catch { }
        if (tryHardToParseJSON) {
            // Try to add " at the end
            try {
                return yaml.parse(json + "\"");
            } catch { }
            // Try to remove the last line
            try {
                return yaml.parse(json.split("\n").slice(0, -1).join("\n"));
            } catch { }
            // Try to remove the last line and trailing commas
            try {
                return yaml.parse(json.split("\n").slice(0, -1).map(x => x.endsWith(",") ? x.slice(0, -1) : x).join("\n"));
            } catch { }
        }
        if (config?.throwOnError) {
            return yaml.parse(json);
        }
        return json;
    }
    try {
        return JSONLACKS.parse(json);
    } catch (e) {
        console.error(e);
        if (config?.throwOnError) throw e;
    }
    return json;
}
