import { sort } from "socket-function/src/misc";
import { Paragraph, Session, SessionParagraphs, SessionSpeakers } from "../Schema";
import { DiskCollection } from "./storage/DiskCollection";

let sessions = new DiskCollection<Session>("Session");
let sessionParagraphs = new DiskCollection<SessionParagraphs>("SessionParagraphs");
let sessionSpeakers = new DiskCollection<SessionSpeakers>("SessionSpeakers");

let paragraphs = new DiskCollection<Paragraph>("Paragraph");


export function getSessionList(): Session[] {
    let list = sessions.getValues();
    list = list.map(x => ({ ...x, usage: x.usage || { cost: 0, tokensIn: 0, tokensOut: 0 } }));
    list.reverse();
    return list;
}


export async function setSession(session: Session) {
    if (!await sessions.get(session._id)) {
        sessionParagraphs.set(session._id, { _id: session._id, paragraphIds: [] });
        sessionSpeakers.set(session._id, { session: session._id, speakers: {} });
    }
    sessions.set(session._id, session);
}
export async function deleteSession(session: string) {
    sessions.remove(session);
}
export function getSession(id: string): Session | undefined {
    return sessions.get(id);
}

export function getSessionParagraphs(session: string): Paragraph[] {
    let skeleton = sessionParagraphs.get(session);
    let paragraphsList = skeleton?.paragraphIds.map(id => paragraphs.get(id)).filter(isDefined) || [];
    sort(paragraphsList, x => x.orderTime);
    return paragraphsList;
}
export function getSessionParagraph(session: string, id: string): Paragraph | undefined {
    return paragraphs.get(id);
}
export async function deleteSessionParagraph(session: string, id: string) {
    let skeleton = await sessionParagraphs.getPromise(session);
    if (!skeleton) {
        console.warn(`deleteSessionParagraph: session ${session} not found`);
        return;
    }
    skeleton.paragraphIds = skeleton.paragraphIds.filter(x => x !== id);
    sessionParagraphs.set(session, skeleton);
    //  Leave the paragraph, so we can undelete it
    //paragraphs.remove(id);
}
export async function undeleteSessionParagraph(session: string, id: string) {
    let skeleton = await sessionParagraphs.getPromise(session);
    if (!skeleton) {
        console.warn(`undeleteSessionParagraph: session ${session} not found`);
        return;
    }
    let paragraph = await paragraphs.getPromise(id);
    if (!paragraph) {
        console.warn(`undeleteSessionParagraph: paragraph ${id} not found`);
        return;
    }
    skeleton.paragraphIds.push(id);
    sessionParagraphs.set(session, skeleton);
}
export async function setSessionParagraph(session: string, paragraph: Paragraph) {
    let skeleton = await sessionParagraphs.getPromise(session);
    if (!skeleton) {
        console.warn(`setSessionParagraph: session ${session} not found`);
        return;
    }
    if (!skeleton.paragraphIds.includes(paragraph._id)) {
        skeleton.paragraphIds.push(paragraph._id);
        sessionParagraphs.set(session, skeleton);
    }

    paragraphs.set(paragraph._id, paragraph);
}


export function getSessionSpeakers(session: string): SessionSpeakers {
    return sessionSpeakers.get(session) || { session, speakers: {} };
}
export async function setSessionSpeakers(session: string, speakers: SessionSpeakers) {
    sessionSpeakers.set(session, speakers);
}


function isDefined<T>(value: T | undefined): value is T {
    return value !== undefined;
}