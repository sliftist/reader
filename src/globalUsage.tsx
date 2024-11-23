import { ModelUsage, Paragraph } from "../Schema";
import { getSession, getSessionList, setSession, setSessionParagraph } from "./chatData";
import { sessionURL } from "./SessionView";

let trackingParagraph: Paragraph | undefined;
export function setTrackingParagraph(paragraph: Paragraph) {
    trackingParagraph = paragraph;
}

export function addModelUsage(usage: ModelUsage) {
    if (!trackingParagraph) return;
    trackingParagraph.usage.cost += usage.cost;
    trackingParagraph.usage.tokensIn += usage.tokensIn;
    trackingParagraph.usage.tokensOut += usage.tokensOut;
    void setSessionParagraph(sessionURL.value, trackingParagraph);

    let session = getSession(sessionURL.value);
    if (session) {
        session.usage = session.usage || { cost: 0, tokensIn: 0, tokensOut: 0 };
        session.usage.cost += usage.cost;
        session.usage.tokensIn += usage.tokensIn;
        session.usage.tokensOut += usage.tokensOut;
        void setSession(session);
    }
}