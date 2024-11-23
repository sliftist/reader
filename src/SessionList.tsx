import preact from "preact";
import { observer } from "./misc/observer";
import { DiskCollection } from "./storage/DiskCollection";
import { nextId } from "socket-function/src/misc";
import { PendingDisplay } from "./storage/PendingManager";
import { css } from "typesafecss";
import { createLink, URLParamStr } from "./misc/URLParam";
import { deleteSession, getSessionList, setSession } from "./chatData";
import { pageURL } from "./Layout";
import { sessionURL } from "./SessionView";
import { Anchor } from "./misc/Anchor";
import { Header } from "./Header";

@observer
export class SessionList extends preact.Component {
    render() {
        let list = getSessionList();
        return (
            <div className={css.vbox(10).pad2(20).fillWidth}>
                <Header />
                <button onClick={() => setSession({ _id: nextId(), title: `New Session at ${new Date().toLocaleString()}` })}>
                    Add New Session
                </button>
                {list.map(session =>
                    <div>
                        <Anchor
                            params={[[pageURL, "session"], [sessionURL, session._id]]}
                        >
                            {session._id} = {session.title}
                        </Anchor>
                        <button onClick={() => deleteSession(session._id)}>Delete</button>
                    </div>
                )}
            </div>
        );
    }
}