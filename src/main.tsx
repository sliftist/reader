import "./buffer.js";
import preact from "preact";
import { Layout } from "./Layout";
import { isNode } from "typesafecss";
import { HOT_RELOAD_PORT, HTTP_PORT } from "../consts";

if (!isNode()) {
    if (location.hostname === "localhost") {
        const socket = new WebSocket(`ws://localhost:${HOT_RELOAD_PORT}`);

        socket.onmessage = function (event) {
            if (event.data === "Build completed successfully") {
                location.reload();
            } else {
                console.log(event.data);
            }
        };
    }
}

async function main() {
    if (isNode()) return;
    preact.render(<Layout />, document.body);
}
main().catch(console.error);