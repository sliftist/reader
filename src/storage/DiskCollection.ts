import { isNode } from "typesafecss";
import { DelayedStorage } from "./DelayedStorage";
import { FileStorage, getFileStorage } from "./FileFolderAPI";
import { IStorage, IStorageSync } from "./IStorage";
import { JSONStorage } from "./JSONStorage";
import { StorageSync } from "./StorageObservable";
import { TransactionStorage } from "./TransactionStorage";
import { PendingStorage } from "./PendingStorage";
import { observable } from "../misc/mobxTyped";

export class DiskCollection<T> implements IStorageSync<T> {
    constructor(
        private collectionName: string,
        private writeDelay?: number,
    ) {
    }
    async initStorage(): Promise<IStorage<T>> {
        if (isNode()) return undefined as any;
        let fileStorage = await getFileStorage();
        let collections = await fileStorage.folder.getStorage("collections");
        let curCollection = await collections.folder.getStorage(this.collectionName);
        let baseStorage = new TransactionStorage(curCollection, this.collectionName, this.writeDelay);
        return new JSONStorage<T>(baseStorage);
    }
    private baseStorage = this.initStorage();
    private synced = new StorageSync(
        new PendingStorage(`Collection (${this.collectionName})`,
            new DelayedStorage<T>(this.baseStorage)
        )
    );

    public get(key: string): T | undefined {
        return this.synced.get(key);
    }
    public async getPromise(key: string): Promise<T | undefined> {
        let base = await this.baseStorage;
        return base.get(key);
    }
    public set(key: string, value: T): void {
        this.synced.set(key, value);
    }
    public remove(key: string): void {
        this.synced.remove(key);
    }
    public getKeys(): string[] {
        return this.synced.getKeys();
    }

    public getEntries(): [string, T][] {
        return this.getKeys().map(key => [key, this.get(key)!] as [string, T]).filter(x => x[1] !== undefined);
    }
    public getValues(): T[] {
        return this.getKeys().map(key => this.get(key)).filter(isDefined);
    }
    public getInfo(key: string) {
        return this.synced.getInfo(key);
    }

    public async reset() {
        await this.synced.reset();
    }
}

function isDefined<T>(value: T | undefined): value is T {
    return value !== undefined;
}

export class DiskCollectionPromise<T> implements IStorage<T> {
    constructor(
        private collectionName: string,
        private writeDelay?: number,
    ) { }
    async initStorage(): Promise<IStorage<T>> {
        if (isNode()) return undefined as any;
        let fileStorage = await getFileStorage();
        let collections = await fileStorage.folder.getStorage("collections");
        let curCollection = await collections.folder.getStorage(this.collectionName);
        let baseStorage = new TransactionStorage(curCollection, this.collectionName, this.writeDelay);
        return new JSONStorage<T>(baseStorage);
    }
    private synced = (
        new PendingStorage(`Collection (${this.collectionName})`,
            new DelayedStorage<T>(this.initStorage())
        )
    );

    public async get(key: string): Promise<T | undefined> {
        return await this.synced.get(key);
    }
    public async set(key: string, value: T): Promise<void> {
        await this.synced.set(key, value);
    }
    public async remove(key: string): Promise<void> {
        await this.synced.remove(key);
    }
    public async getKeys(): Promise<string[]> {
        return await this.synced.getKeys();
    }
    public async getInfo(key: string) {
        return await this.synced.getInfo(key);
    }

    public async reset() {
        await this.synced.reset();
    }
}

export class DiskCollectionRaw implements IStorage<Buffer> {
    constructor(private collectionName: string) { }
    async initStorage(): Promise<IStorage<Buffer>> {
        if (isNode()) return undefined as any;
        let fileStorage = await getFileStorage();
        let collections = await fileStorage.folder.getStorage("collections");
        let baseStorage = await collections.folder.getStorage(this.collectionName);
        return baseStorage;
    }
    private synced = (
        new PendingStorage(`Collection (${this.collectionName})`,
            new DelayedStorage(this.initStorage())
        )
    );

    public async get(key: string): Promise<Buffer | undefined> {
        return await this.synced.get(key);
    }
    public async set(key: string, value: Buffer): Promise<void> {
        await this.synced.set(key, value);
    }
    public async remove(key: string): Promise<void> {
        await this.synced.remove(key);
    }
    public async getKeys(): Promise<string[]> {
        return await this.synced.getKeys();
    }
    public async getInfo(key: string) {
        return await this.synced.getInfo(key);
    }

    public async reset() {
        await this.synced.reset();
    }
}

// TODO: Create a path version of this, which supports get and set on directories as well
export class FileStorageBufferSyncer implements IStorageSync<Buffer> {
    private base = new PendingStorage(`FileStorage Pending`,
        new DelayedStorage(getFileStorage())
    );
    private synced = new StorageSync(this.base);

    public get(key: string): Buffer | undefined {
        return this.synced.get(key);
    }
    public set(key: string, value: Buffer): void {
        this.synced.set(key, value);
    }
    public remove(key: string): void {
        this.synced.remove(key);
    }
    public getKeys(): string[] {
        return this.synced.getKeys();
    }
    public getInfo(key: string) {
        return this.synced.getInfo(key);
    }

    public getAsync() {
        return this.synced;
    }

    public async reset() {
        await this.synced.reset();
    }
}

export const FileStorageSynced = new FileStorageBufferSyncer();