import preact from "preact";
import { observer } from "./misc/observer";
import { PendingDisplay } from "./storage/PendingManager";
import { css } from "typesafecss";
import { APIKeysControl } from "./apiKeys";

@observer
export class Header extends preact.Component {
    render() {
        return (
            <div className={css.height(20).hbox(20)}>
                <APIKeysControl />
                <PendingDisplay />
            </div>
        );
    }
}