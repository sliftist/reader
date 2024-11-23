import preact from "preact";
import { getFileSystemPointer, storeFileSystemPointer } from "./fileSystemPointer";
import { observable } from "../misc/mobxTyped";
import { observer } from "../misc/observer";
import { cache, lazy } from "socket-function/src/caching";
import { css, isNode } from "typesafecss";
import { IStorageRaw } from "./IStorage";
import { runInSerial } from "socket-function/src/batching";
import { getFileStorageIndexDB } from "./IndexedDBFileFolderAPI";

const USE_INDEXED_DB = true;

let handleToId = new Map<FileSystemDirectoryHandle, string>();
let displayData = observable({
    ui: undefined as undefined | preact.ComponentChildren,
}, undefined, { deep: false });

const storageKey = "syncFileSystemCamera3";

@observer
class DirectoryPrompter extends preact.Component {
    render() {
        if (!displayData.ui) return undefined;
        return (
            <div className={
                css.position("fixed").pos(0, 0).size("100vw", "100vh")
                    .zIndex(1)
                    .background("white")
                    .center
                    .fontSize(40)
            }>
                {displayData.ui}
            </div>
        );
    }
}


// NOTE: Blocks until the user provides a directory
export const getDirectoryHandle = lazy(async function getDirectoryHandle(): Promise<FileSystemDirectoryHandle> {
    let root = document.createElement("div");
    document.body.appendChild(root);
    preact.render(<DirectoryPrompter />, root);
    try {

        let handle: FileSystemDirectoryHandle | undefined;

        let storedId = localStorage.getItem(storageKey);
        if (storedId) {
            let doneLoad = false;
            setTimeout(() => {
                if (doneLoad) return;
                console.log("Waiting for user to click");
                displayData.ui = "Click anywhere to allow file system access";
            }, 500);
            try {
                handle = await tryToLoadPointer(storedId);
            } catch { }
            doneLoad = true;
            if (handle) {
                handleToId.set(handle, storedId);
                return handle;
            }
        }
        let fileCallback: (handle: FileSystemDirectoryHandle) => void;
        let promise = new Promise<FileSystemDirectoryHandle>(resolve => {
            fileCallback = resolve;
        });
        displayData.ui = (
            <button
                className={css.fontSize(40).pad2(80, 40)}
                onClick={async () => {
                    console.log("Waiting for user to give permission");
                    const handle = await window.showDirectoryPicker();
                    await handle.requestPermission({ mode: "readwrite" });
                    let storedId = await storeFileSystemPointer({ mode: "readwrite", handle });
                    localStorage.setItem(storageKey, storedId);
                    handleToId.set(handle, storedId);
                    fileCallback(handle);
                }}
            >
                Pick Media Directory
            </button>
        );
        return await promise;
    } finally {
        preact.render(null, root);
        root.remove();
    }
});

export const getFileStorage = lazy(async function getFileStorage(): Promise<FileStorage> {
    if (isNode()) return "No file storage in NodeJS. Is the build script running startup steps? Check for isNode() and NOOP those" as any;
    if (USE_INDEXED_DB) {
        return await getFileStorageIndexDB();
    }

    let handle = await getDirectoryHandle();
    let id = handleToId.get(handle);
    if (!id) throw new Error("Missing id for handle");
    return wrapHandle(handle, id);
});
export function resetStorageLocation() {
    localStorage.removeItem(storageKey);
    window.location.reload();
}

export type NestedFileStorage = {
    hasKey(key: string): Promise<boolean>;
    getStorage(key: string): Promise<FileStorage>;
    removeStorage(key: string): Promise<void>;
    getKeys(): Promise<string[]>;
};

export type FileStorage = IStorageRaw & {
    id: string;
    folder: NestedFileStorage;
};

let appendQueue = cache((key: string) => {
    return runInSerial((fnc: () => Promise<void>) => fnc());
});


async function fixedGetFileHandle(config: {
    handle: FileSystemDirectoryHandle;
    key: string;
    create: true;
}): Promise<FileSystemFileHandle>;
async function fixedGetFileHandle(config: {
    handle: FileSystemDirectoryHandle;
    key: string;
    create?: boolean;
}): Promise<FileSystemFileHandle | undefined>;
async function fixedGetFileHandle(config: {
    handle: FileSystemDirectoryHandle;
    key: string;
    create?: boolean;
}): Promise<FileSystemFileHandle | undefined> {
    // ALWAYS try without create, because the sshfs-win sucks and doesn't support `create: true`? Wtf...
    try {
        return await config.handle.getFileHandle(config.key);
    } catch {
        if (!config.create) return undefined;
    }
    return await config.handle.getFileHandle(config.key, { create: true });
}

function wrapHandleFiles(handle: FileSystemDirectoryHandle): IStorageRaw {
    return {
        async getInfo(key: string) {
            try {
                const file = await handle.getFileHandle(key);
                const fileContent = await file.getFile();
                return {
                    size: fileContent.size,
                    lastModified: fileContent.lastModified,
                };
            } catch (error) {
                return undefined;
            }
        },
        async get(key: string): Promise<Buffer | undefined> {
            try {
                const file = await handle.getFileHandle(key);
                const fileContent = await file.getFile();
                const arrayBuffer = await fileContent.arrayBuffer();
                return Buffer.from(arrayBuffer);
            } catch (error) {
                return undefined;
            }
        },

        async append(key: string, value: Buffer): Promise<void> {
            await appendQueue(key)(async () => {
                // NOTE: Interesting point. Chrome doesn't optimize this to be an append, and instead
                //  rewrites the entire file.
                const file = await fixedGetFileHandle({ handle, key, create: true });
                const writable = await file.createWritable({ keepExistingData: true });
                let offset = (await file.getFile()).size;
                await writable.seek(offset);
                await writable.write(value);
                await writable.close();
            });
        },

        async set(key: string, value: Buffer): Promise<void> {
            const file = await fixedGetFileHandle({ handle, key, create: true });
            const writable = await file.createWritable();
            await writable.write(value);
            await writable.close();
        },

        async remove(key: string): Promise<void> {
            await handle.removeEntry(key);
        },

        async getKeys(): Promise<string[]> {
            const keys: string[] = [];
            for await (const [name, entry] of handle) {
                if (entry.kind === "file") {
                    keys.push(entry.name);
                }
            }
            return keys;
        },

        async reset() {
            for await (const [name, entry] of handle) {
                await handle.removeEntry(entry.name, { recursive: true });
            }
        },
    };
}

function wrapHandleNested(handle: FileSystemDirectoryHandle, id: string): NestedFileStorage {
    return {
        async hasKey(key: string): Promise<boolean> {
            try {
                await handle.getDirectoryHandle(key);
                return true;
            } catch (error) {
                return false;
            }
        },

        async getStorage(key: string): Promise<FileStorage> {
            const subDirectory = await handle.getDirectoryHandle(key, { create: true });
            return wrapHandle(subDirectory, id);
        },

        async removeStorage(key: string): Promise<void> {
            await handle.removeEntry(key, { recursive: true });
        },

        async getKeys(): Promise<string[]> {
            const keys: string[] = [];
            for await (const [name, entry] of handle) {
                if (entry.kind === "directory") {
                    keys.push(entry.name);
                }
            }
            return keys;
        },
    };
}

function wrapHandle(handle: FileSystemDirectoryHandle, id = "default"): FileStorage {
    return {
        ...wrapHandleFiles(handle),
        folder: wrapHandleNested(handle, id),
        id,
    };
}

async function tryToLoadPointer(pointer: string) {
    let result = await getFileSystemPointer({ pointer });
    if (!result) return;
    let handle = await result?.onUserActivation();
    if (!handle) return;
    return handle as FileSystemDirectoryHandle;
}