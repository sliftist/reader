import preact from "preact";
import { observer } from "./misc/observer";
import { observable } from "./misc/mobxTyped";
import { getDirectoryHandle, getFileStorage } from "./storage/FileFolderAPI";
import { css } from "typesafecss";
import { TransactionStorage } from "./storage/TransactionStorage";
import { URLParamStr } from "./misc/URLParam";
import { Test } from "./Test";
import { SessionList } from "./SessionList";
import { SessionView } from "./SessionView";

export const pageURL = new URLParamStr("page");

@observer
export class Layout extends preact.Component {
    async componentDidMount() {
        // fileIndexer.addIndexer(await getFileStorage());
        // await fileIndexer.startIndexing();
        window.addEventListener("keydown", this.onKeyDown);
    }
    onKeyDown = (e: KeyboardEvent) => {
        // Ignore if it is for an input, text area, etc
        let ignore = (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement ||
            e.target instanceof HTMLSelectElement
        );
        if (ignore) return;

        console.log("Checking hotkey", e.key, e);
        let key = e.key;
        if (e.ctrlKey) key = "Ctrl+" + key;
        if (e.shiftKey) key = "Shift+" + key;
        let hotkeyDataAttribute = `[data-hotkey="${key}"]`;
        let el = document.querySelector<HTMLElement>(hotkeyDataAttribute);
        if (el) {
            e.stopPropagation();
            e.preventDefault();
            console.log("Found hotkey", e.key, el);
            el.click();
        }
    };
    render() {
        let pages = [
            {
                key: "sessionlist",
                content: <SessionList />
            },
            {
                key: "session",
                content: <SessionView />
            },
            {
                key: "chat",
                content: <Test />
            },
        ];

        let page = pages.find(p => p.key === pageURL.value) || pages[0];

        return (
            <div className={css.size("100vw", "100vh").overflowAuto}>
                {page.content}
            </div>
        );
    }
}
