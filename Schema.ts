export type Session = {
    _id: string;

    title: string;

    usage: ModelUsage;
};

export type SessionParagraphs = {
    _id: string;

    paragraphIds: string[];
};
export type SessionSpeakers = {
    session: string;
    speakers: {
        [name: string]: AISpec;
    };
};
export type SpeakerSegment = {
    speaker: string;
    notAudible: boolean;
    text: string;
};
export type Paragraph = {
    _id: string;

    orderTime: number;
    question: string;
    answer: string;

    speakerSegmentation?: SpeakerSegment[];

    audio?: {
        path: string;
    }[];

    usage: ModelUsage;
};




export type AISpec = {
    api: string;
    model: string;
};

export type ModelUsage = {
    tokensIn: number;
    tokensOut: number;
    cost: number;
};


export type AIMessage = {
    role: "user" | "system" | "assistant";
    content: string;
};
export type AIQuery = {
    // _id = hash({ model, input })
    _id: string;
    model: AISpec;
    input: AIMessage[];

    output: string;
    usage: ModelUsage;
};