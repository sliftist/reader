import preact from "preact";
import { observer } from "./misc/observer";
import { DiskCollection } from "./storage/DiskCollection";
import { nextId } from "socket-function/src/misc";
import { PendingDisplay } from "./storage/PendingManager";
import { css } from "typesafecss";

let testCollection = new DiskCollection<string>("test");

@observer
export class Test extends preact.Component {
    render() {
        return (
            <div className={css.vbox(20).pad2(200)}>
                <div className={css.height(100)}>
                    <PendingDisplay />
                </div>

                <button onClick={() => testCollection.set(nextId(), Date.now() + "")}>
                    Add
                </button>
                {testCollection.getKeys().map(key =>
                    <div>
                        {key} = {testCollection.get(key)} <button onClick={() => testCollection.remove(key)}>delete</button>
                    </div>
                )}
            </div>
        );
    }
}