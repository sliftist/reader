import { canHaveChildren } from "socket-function/src/types";
import { AIMessage, AISpec, ModelUsage, Paragraph, SpeakerSegment } from "../Schema";
import { AIChatBot, countTokens, getMessageInputTokenCount } from "./AIChatters";
import { parseJSONGPTOutput } from "./aiHelpers";
import { getAPIKey } from "./apiKeys";
import { DiskCollectionPromise, DiskCollectionRaw } from "./storage/DiskCollection";
import { nextId } from "socket-function/src/misc";
import { formatNumber } from "socket-function/src/formatting/format";
import { Cancellable } from "./cancelManagement";
import { addModelUsage } from "./globalUsage";

export type SpeakerDef = {
    spec: AISpec;
    description: string;
};

const audioStorage = new DiskCollectionRaw("Audio");

export const allSpeakers: SpeakerDef[] = [
    {
        spec: {
            api: "eleven",
            model: "XB0fDUnXU5powFXDhCwa",
        },
        description: "Swedish Female (Charlotte), soothing and formal",
    },
    {
        "spec": {
            "api": "eleven",
            "model": "9BWtsMINqrJLrRacOk9x"
        },
        "description": "American female (Aria), urban, husky, sarcastic"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "CwhRBWXzGAHq8TQ4Fs17"
        },
        "description": "American male (Roger), eastern, nasally"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "EXAVITQu4vr4xnSDxMaL"
        },
        "description": "American female (Sarah), north west, imposing, formal"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "FGY2WhTYpPnrIDTdsKH5"
        },
        "description": "American female (Laura), valley girl"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "IKne3meq5aSn9XLyUdCD"
        },
        "description": "British male (Charlie), conversational"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "JBFqnCBsd6RMkjVDRZzb"
        },
        "description": "British male (George), posh, formal"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "N2lVS1w4EtoT3dr4eOWO"
        },
        "description": "American male (Callum), deep, breathy, serious"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "SAz9YHcvj6GT2YYXdXww"
        },
        "description": "American female (River), valley girl, deep"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "TX3LPaxmHKxFdv7VOQHJ"
        },
        "description": "American male (Liam), valley boy, effeminate"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "Xb7hH8MSUJpSbSDYk0k2"
        },
        "description": "British female (Alice), posh, formal"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "XrExE9yKIg1WjnnlVkGX"
        },
        "description": "American female (Matilda), formal, california"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "bIHbv24MWmeRgasZH58o"
        },
        "description": "American male (Will), deep, informal"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "cgSgspJ2msm6clMCkdW9"
        },
        "description": "American female (Jessica), upbeat, bright"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "cjVigY5qzO86Huf0OWal"
        },
        "description": "American male (Eric), mid-west, friendly"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "iP95p4xoKVk53GoZ742B"
        },
        "description": "American male (Chris), informal, unserious"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "nPczCjzI2devNBz1zQrb"
        },
        "description": "American male (Brian), deep narrator"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "onwK4e9ZLuTAKqWW03F9"
        },
        "description": "British male (Daniel), deep, older"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "pFZP5JQG7iQjIQuC4Bku"
        },
        "description": "British (Lily), formal, very posh"
    },
    {
        "spec": {
            "api": "eleven",
            "model": "pqHfZKP75CvOlQylNhV4"
        },
        "description": "American male (Bill), deep, newscaster"
    }
];

export async function playAudio(config: {
    path: string;
    speed: number;
    cancel: Cancellable;
}) {
    const { path, speed, cancel } = config;
    if (cancel.cancel) return;
    let buffer = await audioStorage.get(path);
    if (!buffer) {
        throw new Error(`Audio not found: ${path}`);
    }
    let audio = new Audio();
    audio.src = URL.createObjectURL(new Blob([buffer]));
    audio.playbackRate = speed;
    cancel?.watchCancel(() => {
        audio.pause();
    });
    await audio.play();
    // Wait until it finishes playing
    let done = new Promise(resolve => {
        audio.onended = resolve;
    });
    if (cancel) {
        done = Promise.race([done, cancel.cancelled]);
    }
    await done;
}

export async function segmentSpeakers(config: {
    text: string;
    prev: {
        text: string;
        segments: SpeakerSegment[];
    } | undefined;
    existingSpeakers: string[];
    chatter: AIChatBot;
}): Promise<{
    segments: SpeakerSegment[];
}> {
    let { text, prev, existingSpeakers, chatter } = config;
    let messages: AIMessage[] = [
        {
            role: "system",
            content: `Your job is to split text into sections by speaker / narrator, to choose the voice that reads it outloud. In JSON, in the follow format: { "segments": { "speaker": string; "notAudible": boolean; "text": string; }[] }. Remember to include all text, even if it's not spoken. Use "notAudible" for text that is not spoken. Use "narrator" for text that cannot be attributed to a character.\nIt's preferrable to use the exact same speaker names from previous text. The previous list of speakers is: ${JSON.stringify(existingSpeakers)}. If you can't determine the speaker, us "speaker #1", etc.`
        }
    ];
    // NOTE: We should really pass more examples. Yes more input tokens means we pay more, but...
    //  the text => voice API is a million times more expensive anyways.
    prev = prev || {
        text: "He look around the room and said what's going on? As he spoke a voice said, quiet down there! He stopped speaking and was confused. Tracy had no idea where the voice was coming from.",
        segments: [
            {
                speaker: "narrator",
                notAudible: true,
                text: "He look around the room and said"
            },
            {
                speaker: "Tracy",
                notAudible: true,
                text: "what's going on?"
            },
            {
                speaker: "narrator",
                notAudible: true,
                text: "As he spoke a voice said,",
            },
            {
                speaker: "speaker #1",
                notAudible: false,
                text: "quiet down there!"
            },
            {
                speaker: "narrator",
                notAudible: true,
                text: "He stopped speaking and was confused. Tracy had no idea where the voice was coming from."
            },
        ]
    };
    if (prev) {
        messages.push({
            role: "user",
            content: prev.text,
        });
        messages.push({
            role: "assistant",
            content: JSON.stringify(prev.segments),
        });
    }
    messages.push({
        role: "user",
        content: text,
    });
    let result = await chatter.chat({
        json: true,
        messages
    });
    let parsed = parseJSONGPTOutput(result);
    let segmentation = parsed as { segments: SpeakerSegment[] };
    if (!canHaveChildren(segmentation) || !(segmentation.segments instanceof Array)) {
        console.error("Invalid speaker segmentation", segmentation);
        return { segments: [], };
    }
    return { segments: segmentation.segments, };
}


export async function pickGoodSpeaker(config: {
    chatter: AIChatBot;
    segments: SpeakerSegment[];
}): Promise<{
    speaker: AISpec;
}> {
    let { segments, chatter } = config;
    let messages: AIMessage[] = [
        {
            role: "user",
            content: `Please pick a good voice for ${JSON.stringify(segments[0].speaker)}, who has this dialogue:\n${JSON.stringify(segments.map(x => x.text))}\nYou can choose from the following speakers: ${allSpeakers.map((x, index) => (index + 1) + ". " + x.description).join("\n")}\nReturn just a single single number corresponding to the speaker that fits best`
        }
    ];
    let result = await chatter.chat({
        messages: messages
    });
    let index = parseInt(result);
    let spec = allSpeakers[index - 1]?.spec || allSpeakers[0].spec;
    return {
        speaker: spec,
    };
}


export async function encodeVoice(config: {
    segment: SpeakerSegment;
    voice: AISpec;
}): Promise<{
    audioPath: string;
}> {
    // eleven_multilingual_v2 is the best
    // eleven_turbo_v2_5 is the best cheap one (although only 50% the cost)
    const { segment, voice } = config;

    let usdPerChar = 0.3 / 1000;

    //const modelId = "eleven_turbo_v2_5";
    const modelId = "eleven_multilingual_v2";
    if (modelId.includes("turbo")) {
        usdPerChar *= 0.5;
    }
    /*
        eleven_multilingual_v2
        eleven_turbo_v2_5
        eleven_turbo_v2
        eleven_multilingual_sts_v2
        eleven_monolingual_v1
        eleven_english_sts_v2
        eleven_multilingual_v1
    */
    let voiceId = voice.model;
    let result = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
            "xi-api-key": await getAPIKey("elevenlabs"),
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            text: segment.text,
            model_id: modelId,
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.5,
                //style: 0.5,
                use_speaker_boost: false,
            },
            seed: 1,
            //previous_text: "",
            //next_text: "",
            //previous_request_ids: [],
            //next_request_ids: [],
            //apply_text_normalization: "auto" | "on" | "off",
        }),
    });
    if (!result.ok) {
        throw new Error(`Failed to encode voice: ${await result.text()}`);
    }
    let buffer = Buffer.from(await result.arrayBuffer());
    let path = nextId() + ".mp3";
    await audioStorage.set(path, buffer);
    console.log(`Spoke ${config.segment.text} in ${formatNumber(buffer.length)}B`);
    addModelUsage({
        cost: usdPerChar * config.segment.text.length,
        tokensIn: 0,
        tokensOut: 0
    });
    return {
        audioPath: path,
    };
}