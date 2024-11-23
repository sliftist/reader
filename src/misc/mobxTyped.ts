// @ts-ignore
import mobx from "mobx/dist/mobx.cjs.development.js";
import mobxType from "mobx";
type Mobx = typeof mobxType;
const mobxInstance = mobx as Mobx;

let lastRenderTime = 0;
mobxInstance.configure({
    enforceActions: "never",
    reactionScheduler(callback) {
        void Promise.resolve().finally(() => {
            let now = performance.now();
            if (now - lastRenderTime < 16) {
                setTimeout(callback, 0);
            } else {
                callback();
            }
            lastRenderTime = now;
        });
    }
});

export let { observable, Reaction, action } = mobxInstance;