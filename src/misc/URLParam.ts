import { isNode } from "typesafecss";
import { observable } from "../misc/mobxTyped";

let allParams: URLParamStr[] = [];

export class URLParamStr {
    private state = observable({
        seqNum: 0
    });
    constructor(public readonly urlKey: string, private defaultValue?: string) {
        allParams.push(this);
    }
    public forceUpdate() {
        this.state.seqNum++;
    }

    public get() {
        this.state.seqNum;
        return new URLSearchParams(window.location.search).get(this.urlKey) || this.defaultValue || "";
    }
    public set(value: string) {
        if (value === this.get()) return;
        let searchParams = new URLSearchParams(window.location.search);
        searchParams.set(this.urlKey, value);
        window.history.pushState({}, "", "?" + searchParams.toString());
        this.state.seqNum++;
    }

    public get value() {
        return this.get();
    }
    public set value(value: string) {
        this.set(value);
    }
}

export function createLink(params: [URLParamStr, string][]) {
    let searchParams = new URLSearchParams(window.location.search);
    for (let [param, value] of params) {
        searchParams.set(param.urlKey, value);
    }
    return "?" + searchParams.toString();
}

if (!isNode()) {
    // Watch for url push states
    window.addEventListener("popstate", () => {
        // Force all to update, in case their param changed
        for (let param of allParams) {
            param.forceUpdate();
        }
    });
}