import preact from "preact";
import { observable } from "./misc/mobxTyped";
import { nextId } from "socket-function/src/misc";
import { observer } from "./misc/observer";

let cancels = observable({} as {
    [key: string]: Cancellable
});

export class Cancellable {
    private id = nextId();
    private cancelCallbacks: (() => void)[] = [];
    public cancelled = new Promise<void>(resolve => this.watchCancel(resolve));

    public cancel = false;
    constructor() {
        cancels[this.id] = this;
    }
    [Symbol.dispose]() {
        this.doCancel();
    }

    public watchCancel(fnc: () => void) {
        if (this.cancel) {
            fnc();
        } else {
            this.cancelCallbacks.push(fnc);
        }
    }

    doCancel() {
        for (let fnc of this.cancelCallbacks) {
            fnc();
        }
        this.cancel = true;
        delete cancels[this.id];
    }
}

@observer
export class GlobalCancelButton extends preact.Component {
    render() {
        let cancelObjs = Object.values(cancels);
        if (cancelObjs.length === 0) return undefined;
        return (
            <button onClick={() => {
                for (let cancel of cancelObjs) {
                    cancel.doCancel();
                }
            }}>
                Cancel ({cancelObjs.length})
            </button>
        );
    }
}