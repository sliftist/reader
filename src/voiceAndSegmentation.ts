import { canHaveChildren } from "socket-function/src/types";
import { AISpec, ModelUsage, Paragraph, SpeakerSegment } from "../Schema";
import { AIChatBot } from "./AIChatters";
import { parseJSONGPTOutput } from "./aiHelpers";

export type SpeakerDef = {
    spec: AISpec;
    description: string;
};

export const defaultSpeakers: SpeakerDef[] = [
    {
        spec: {
            api: "test",
            model: "test",
            params: {}
        },
        description: "test description",
    }
];

export async function segmentSpeakers(config: {
    text: string;
    existingSpeakers: string[];
    chatter: AIChatBot;
}): Promise<SpeakerSegment[]> {
    let { text, existingSpeakers, chatter } = config;
    let result = await chatter.chat({
        json: true,
        messages: [
            {
                role: "system",
                content: `Your job is to split text into speakers, in the follow format: { "segments": { "speaker": string; "notAudible": boolean; "text": string; }[] }. Remember to include all text, even if it's not spoken. Use "notAudible" for text that is not spoken. Use "narrator" for text that cannot be attributed to a character.\nIt's preferrable to use the exact same speaker names from previous text. The previous list of speakers is: ${JSON.stringify(existingSpeakers)}. If you can't determine the speaker, us "speaker #1", etc.`
            }
        ]
    });
    let parsed = parseJSONGPTOutput(result);
    let segmentation = parsed as { segments: SpeakerSegment[] };
    if (!canHaveChildren(segmentation) || !(segmentation.segments instanceof Array)) {
        console.error("Invalid speaker segmentation", segmentation);
        return [];
    }
    return segmentation.segments;
}


export async function pickGoodSpeaker(config: {
    segments: SpeakerSegment[];
}): Promise<AISpec> {
    return defaultSpeakers[0].spec;
}


export async function encodeVoice(config: {
    segment: SpeakerSegment;
    voice: AISpec;
}): Promise<{
    audioPath: string;
    lengthMilli: number;
}> {

}

export async function playAudioPath(config: {
    path: string;
}) {
}