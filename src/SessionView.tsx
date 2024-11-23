import preact from "preact";
import { observer } from "./misc/observer";
import { DiskCollection } from "./storage/DiskCollection";
import { isNode, nextId, throttleFunction } from "socket-function/src/misc";
import { PendingDisplay } from "./storage/PendingManager";
import { css } from "typesafecss";
import { createLink, URLParamStr } from "./misc/URLParam";
import { pageURL } from "./Layout";
import { deleteSessionParagraph, getSession, getSessionParagraph, getSessionParagraphs, getSessionSpeakers, setSessionParagraph, setSessionSpeakers, undeleteSessionParagraph } from "./chatData";
import { observable } from "./misc/mobxTyped";
import { InputLabel, InputLabelURL } from "./misc/InputLabel";
import { AIMessage, ModelUsage, Paragraph, SpeakerSegment } from "../Schema";
import { aiChatBots, countTokens } from "./AIChatters";
import { formatNumber } from "socket-function/src/formatting/format";
import { Anchor } from "./misc/Anchor";
import { lazy } from "socket-function/src/caching";
import { Input } from "./misc/Input";
import { Header } from "./Header";
import { parseJSONGPTOutput } from "./aiHelpers";
import { canHaveChildren } from "socket-function/src/types";
import { allSpeakers, encodeVoice, pickGoodSpeaker, playAudio, segmentSpeakers } from "./voiceAndSegmentation";
import { dynamicTextArea } from "./dynamicTextArea";
import { runInSerial } from "socket-function/src/batching";
import { Cancellable, GlobalCancelButton } from "./cancelManagement";
import { setTrackingParagraph } from "./globalUsage";

export const sessionURL = new URLParamStr("session");
const tokenLimitURL = new URLParamStr("tokenLimit", 1024 * 16 + "");

const maxResponseTokens = new URLParamStr("maxResponseTokens", 2024 + "");

const playbackSpeed = new URLParamStr("playbackSpeed", "1");

const realTimeURL = new URLParamStr("realTime", "");

@observer
export class SessionView extends preact.Component {
    synced = observable({
        editting: "",
        lastDelete: "",
        editLast: false,
        editLastOverride: "",
        hideSpeakerSegments: false,
        segmenting: false,
        encodingAudio: false,
        running: false,
    });
    input: HTMLInputElement | null = null;
    render() {
        let self = this;
        let sessionId = sessionURL.value;

        const chatter = aiChatBots.openai4o_mini;
        let tokenLimit = Math.min(+tokenLimitURL.value, chatter.maxInputTokens);


        let paragraphs = getSessionParagraphs(sessionURL.value);

        let sessionSpeakers = getSessionSpeakers(sessionId);

        let totalUsage = getSession(sessionId)?.usage || { tokensIn: 0, tokensOut: 0, cost: 0 };

        let context: AIMessage[] = [];
        let remainingLimit = tokenLimit;
        function addMessage(role: "user" | "assistant", content: string) {
            let tokens = countTokens(content);
            if (remainingLimit < tokens) return true;
            remainingLimit -= tokens;
            context.unshift({ role, content });
        }
        let paragraphIncluded = new Set<Paragraph>();
        for (let i = paragraphs.length - 1; i >= 0; i--) {
            let paragraph = paragraphs[i];
            if (addMessage("assistant", paragraph.answer)) break;
            if (addMessage("user", paragraph.question)) break;
            paragraphIncluded.add(paragraph);
        }

        if (!this.synced.running) {
            let lastParagraph = paragraphs.at(-1);
            if (lastParagraph) {
                setTrackingParagraph(lastParagraph);
            }
        }

        // TODO: Fix this absolute mess and move these functions into a better location, re-using more
        //  code between realtime and on demand paths.

        let input = this.input;
        async function runQuestion(question: string) {
            const cancel = new Cancellable();
            self.synced.running = true;
            try {
                setTimeout(() => input?.focus());
                let prevParagraph = paragraphs[paragraphs.length - 1];
                let newParagraph: Paragraph = {
                    _id: nextId(),
                    question: question,
                    answer: "",
                    orderTime: Date.now(),
                    usage: { tokensIn: 0, tokensOut: 0, cost: 0 }
                };
                setTrackingParagraph(newParagraph);
                await setSessionParagraph(sessionId, newParagraph);

                let fullContext = context.slice();
                fullContext.push({ role: "user", content: question });
                let remainingContext = tokenLimit;
                let includedCount = 0;
                for (let i = fullContext.length - 1; i >= 0; i--) {
                    let message = fullContext[i];
                    let tokens = countTokens(message.content);
                    if (remainingContext < tokens) break;
                    remainingContext -= tokens;
                    includedCount++;
                }
                fullContext = fullContext.slice(-includedCount);

                let playQueue = runInSerial(async (path: string) => {
                    if (cancel.cancel) return;
                    if (!path) return;
                    await playAudio({ path, speed: +playbackSpeed.value || 1, cancel });
                });

                let pending = "";
                const onNewLine = runInSerial(async function onNewLine(line: string) {
                    if (!line.trim()) return;
                    if (!realTimeURL.value) return;
                    if (cancel.cancel) return;
                    let { segments } = await segmentSpeakers({
                        text: line,
                        prev: prevParagraph?.speakerSegmentation ? { text: prevParagraph.answer, segments: prevParagraph.speakerSegmentation || [] } : undefined,
                        existingSpeakers: Object.keys(sessionSpeakers.speakers),
                        chatter,
                    });
                    newParagraph.speakerSegmentation = newParagraph.speakerSegmentation || [];
                    newParagraph.speakerSegmentation.push(...segments);
                    await setSessionParagraph(sessionId, newParagraph);

                    await addMissingSpeakers(newParagraph, segments);

                    newParagraph.audio = newParagraph.audio || [];
                    for (let segment of segments) {
                        let encoded = await encodeVoice({
                            segment: segment,
                            voice: sessionSpeakers.speakers[segment.speaker] || allSpeakers[0],
                        });
                        newParagraph.audio.push({
                            path: encoded.audioPath,
                        });
                        void playQueue(encoded.audioPath);
                        await setSessionParagraph(sessionId, newParagraph);
                    }
                });

                await chatter.chat({
                    messages: fullContext,
                    max_tokens: +maxResponseTokens.value,
                    cancel: cancel,
                    stream(fullOutput, newOutput) {
                        newParagraph.answer = fullOutput;
                        void setSessionParagraph(sessionId, newParagraph);

                        pending += newOutput;
                        let lines = pending.split("\n");
                        pending = lines.pop() || "";
                        for (let line of lines) {
                            void onNewLine(line);
                        }
                    },
                });
                for (let line of pending.split("\n")) {
                    await onNewLine(line);
                }
                // Allow real time usage to flush
                await onNewLine("");
                await playQueue("");

                void setSessionParagraph(sessionId, newParagraph);
            } finally {
                self.synced.running = false;
            }
        }
        async function addMissingSpeakers(paragraph: Paragraph, segments: SpeakerSegment[]) {
            let missingSegmentsBySpeaker: { [speaker: string]: SpeakerSegment[] } = {};
            for (let segment of segments) {
                if (segment.speaker in sessionSpeakers.speakers) continue;
                missingSegmentsBySpeaker[segment.speaker] = missingSegmentsBySpeaker[segment.speaker] || [];
                missingSegmentsBySpeaker[segment.speaker].push(segment);
            }

            for (let [speaker, segments] of Object.entries(missingSegmentsBySpeaker)) {
                let speakerObj = await pickGoodSpeaker({ chatter, segments });
                sessionSpeakers.speakers[speaker] = speakerObj.speaker;
            }
            await setSessionSpeakers(sessionId, sessionSpeakers);
        }
        async function segment(paragraph: Paragraph) {
            let prev = paragraphs[paragraphs.indexOf(paragraph) - 1];
            self.synced.segmenting = true;
            try {
                let { segments } = await segmentSpeakers({
                    text: paragraph.answer,
                    prev: prev?.speakerSegmentation ? { text: prev.answer, segments: prev.speakerSegmentation || [] } : undefined,
                    existingSpeakers: Object.keys(sessionSpeakers.speakers),
                    chatter,
                });

                paragraph.speakerSegmentation = segments;
                await setSessionParagraph(sessionId, paragraph);

                await addMissingSpeakers(paragraph, segments);
            } finally {
                self.synced.segmenting = false;
            }
        }
        async function encodeAudio(paragraph: Paragraph) {
            const cancel = new Cancellable();
            self.synced.encodingAudio = true;
            try {
                if (!paragraph.speakerSegmentation) {
                    let prev = paragraphs[paragraphs.indexOf(paragraph) - 1];
                    let { segments } = await segmentSpeakers({
                        text: paragraph.answer,
                        prev: prev?.speakerSegmentation ? { text: prev.answer, segments: prev.speakerSegmentation || [] } : undefined,
                        existingSpeakers: Object.keys(sessionSpeakers.speakers),
                        chatter,
                    });
                    paragraph.speakerSegmentation = segments;
                    await setSessionParagraph(sessionId, paragraph);
                }
                let playQueue = runInSerial(async (path: string) => {
                    await playAudio({ path, speed: +playbackSpeed.value || 1, cancel });
                });
                let audio: Paragraph["audio"] = [];
                for (let segment of paragraph.speakerSegmentation) {
                    let encoded = await encodeVoice({
                        segment: segment,
                        voice: sessionSpeakers.speakers[segment.speaker] || allSpeakers[0],
                    });
                    audio.push({
                        path: encoded.audioPath,
                    });
                    void playQueue(encoded.audioPath);
                }
                paragraph.audio = audio;
                await setSessionParagraph(sessionId, paragraph);
            } finally {
                self.synced.encodingAudio = false;
            }
        }
        async function playAudioParagraph(paragraph: Paragraph) {
            const cancel = new Cancellable();
            if (!paragraph.audio) return;
            for (let audio of paragraph.audio) {
                await playAudio({ path: audio.path, speed: +playbackSpeed.value || 1, cancel });
            }
        }

        function getSpeakerHue(speaker: string) {
            let hue = 0;
            for (let char of speaker) {
                hue += char.charCodeAt(0) * 36;
            }
            return hue % 360;
        }

        return (
            <div className={css.vbox(10).pad2(20).fillWidth.maxHeight("100%").overflowHidden}>
                <Header />
                <Anchor params={[[pageURL, "sessionlist"]]}>
                    Back
                </Anchor>

                <div className={css.hbox(20)}>
                    <InputLabelURL
                        label="Token Limit Override"
                        persisted={tokenLimitURL}
                    />
                    <InputLabelURL
                        label="Max Response Tokens"
                        persisted={maxResponseTokens}
                    />
                    <div>(Limit {tokenLimit})</div>
                    <div>Remaining Limit {remainingLimit}</div>
                    <InputLabelURL
                        label="Playback Speed"
                        number
                        persisted={playbackSpeed}
                    />
                    <div>Input used {formatNumber(totalUsage.tokensIn)}</div>
                    <div>Output used {formatNumber(totalUsage.tokensOut)}</div>
                    <div>Cost {(totalUsage.cost * 100).toFixed(2)} cents</div>
                    <div className={css.opacity(0.5)}>Input tokens per USD {formatNumber(chatter.cost.inputTokensPerUSD)}</div>
                    <div className={css.opacity(0.5)}>Output tokens per USD {formatNumber(chatter.cost.outputTokensPerUSD)}</div>

                    {this.synced.lastDelete && <button onClick={() => undeleteSessionParagraph(sessionId, this.synced.lastDelete)}>Undelete</button>}
                </div>


                <div className={css.vbox(20).fillWidth.overflowAuto.minHeight(0).margins2(20, 40).paddingRight(20)} ref={e => {
                    // Scroll to bottom
                    if (e) e.scrollTop = e.scrollHeight;
                }}>
                    {paragraphs.map((paragraph, index, list) =>
                        <div className={css.vbox(5).fillWidth + (!paragraphIncluded.has(paragraph) && css.opacity(0.6))}>
                            <div className={css.hbox(10).fillWidth}>
                                {this.synced.editting === paragraph._id + "_question" &&
                                    dynamicTextArea({
                                        text: paragraph.question,
                                        onChange: async v => {
                                            this.synced.editting = "";
                                            return setSessionParagraph(sessionId, { ...paragraph, question: v });
                                        }
                                    })
                                    || <div
                                        onClick={() => this.synced.editting = paragraph._id + "_question"}
                                        className={css.whiteSpace("pre-wrap").hsla(200, 30, 10, 1).pad2(10, 10)}>
                                        {paragraph.question}
                                    </div>
                                }
                                <span>({formatNumber(countTokens(paragraph.question))} tokens)</span>
                                <button onClick={() => this.synced.editting = paragraph._id + "_question"}>Edit</button>
                            </div>
                            {
                                (!paragraph.speakerSegmentation || this.synced.hideSpeakerSegments)
                                && <div className={css.hbox(10).fillWidth}>
                                    {this.synced.editting === paragraph._id + "_answer" &&
                                        dynamicTextArea({
                                            text: paragraph.answer,
                                            onChange: async v => {
                                                this.synced.editting = "";
                                                return setSessionParagraph(sessionId, { ...paragraph, answer: v });
                                            }
                                        })
                                        || <div
                                            onClick={() => this.synced.editting = paragraph._id + "_answer"}
                                            className={css.whiteSpace("pre-wrap").hsla(260, 30, 10, 1).pad2(10, 10)}>
                                            {paragraph.answer}
                                        </div>
                                    }
                                    <span>({formatNumber(countTokens(paragraph.answer))} tokens)</span>
                                    <button onClick={() => this.synced.editting = paragraph._id + "_answer"}>Edit</button>
                                </div>
                                || <div className={css.hbox(10).fillWidth}>
                                    <div className={css.fillWidth.vbox(2)}>
                                        {paragraph.speakerSegmentation?.map(segment =>
                                            <div className={
                                                css.hbox(10).wrap
                                                    .pad2(4, 2)
                                                    //.color(`hsl(${getSpeakerHue(segment.speaker)}, 50%, 80%)`)
                                                    .hsl(getSpeakerHue(segment.speaker), 50, 50)
                                                + (segment.notAudible ? css.opacity(0.75).italic : "")
                                            }>
                                                <div className={css.minWidth(10)}>{segment.speaker}</div>
                                                <div>{segment.text}</div>
                                            </div>
                                        )}
                                    </div>
                                    <button onClick={() => { this.synced.editting = paragraph._id + "_answer"; this.synced.hideSpeakerSegments = true; }}>Edit</button>
                                </div>
                            }
                            <div className={css.fillWidth.hbox(10)}>
                                <button onClick={() => segment(paragraph)}>
                                    {self.synced.segmenting ? "Segmenting..." : "Segment"}
                                </button>
                                {paragraph.audio && <button onClick={() => playAudioParagraph(paragraph)}>Play</button>}
                                <button onClick={() => encodeAudio(paragraph)}>
                                    {self.synced.encodingAudio ? "Encoding..." : "Encode Audio"}
                                </button>

                                {paragraph.speakerSegmentation && <button onClick={() => this.synced.hideSpeakerSegments = !this.synced.hideSpeakerSegments}>
                                    {this.synced.hideSpeakerSegments ? "Show" : "Hide"} Speaker Segments
                                </button>}

                                <div className={css.marginAuto} />
                                <div>{paragraph.usage.tokensIn} {"=>"} {paragraph.usage.tokensOut}</div>
                                <div>{(paragraph.usage.cost * 1000).toFixed(2)} thousandths cents</div>
                                <button onClick={() => {
                                    this.synced.lastDelete = paragraph._id;
                                    return deleteSessionParagraph(sessionId, paragraph._id);
                                }}>Delete</button>
                            </div>

                            {(() => {
                                let segmentation = paragraph.speakerSegmentation || [];
                                let names = Array.from(new Set(segmentation.map(x => x.speaker)));
                                if (names.length === 0) return undefined;
                                return (
                                    <div className={css.hbox(20, 2).wrap}>
                                        {names.map(name =>
                                            <div className={css.hbox(10)}>
                                                <label className={css.hbox(4)}>
                                                    <div className={css.boldStyle}>{name}</div>
                                                    <select
                                                        value={JSON.stringify(sessionSpeakers.speakers[name])}
                                                        onChange={async e => {
                                                            let spec = JSON.parse(e.currentTarget.value);
                                                            sessionSpeakers.speakers[name] = spec;
                                                            await setSessionSpeakers(sessionId, sessionSpeakers);
                                                        }}
                                                    >
                                                        {allSpeakers.map(speaker =>
                                                            <option value={JSON.stringify(speaker.spec)}>{speaker.description}</option>
                                                        )}
                                                    </select>
                                                </label>
                                                <button onClick={async () => {
                                                    let newName = prompt("Please provide a new name", name);
                                                    if (!newName) return;
                                                    for (let segment of segmentation) {
                                                        if (segment.speaker === name) {
                                                            segment.speaker = newName;
                                                        }
                                                    }
                                                    sessionSpeakers.speakers[newName] = sessionSpeakers.speakers[name];
                                                    await setSessionSpeakers(sessionId, sessionSpeakers);
                                                    await setSessionParagraph(sessionId, paragraph);
                                                }}>
                                                    Rename
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                </div>

                <InputLabel
                    label="Question"
                    className={css.height(150)}
                    fillWidth
                    textarea
                    value={this.synced.editLast ? this.synced.editLastOverride : ""}
                    onChangeValue={async v => {
                        if (!v) return;
                        if (this.synced.editLast) {
                            this.synced.editLastOverride = "";
                            this.synced.editLast = false;
                            let last = paragraphs[paragraphs.length - 1];
                            if (last) {
                                await deleteSessionParagraph(sessionId, last._id);
                                context = context.slice(0, -1);
                            }
                        }
                        return runQuestion(v);
                    }}
                    inputRef={e => this.input = this.input || e}
                />
                <div className={css.hbox(50)}>
                    <GlobalCancelButton />
                    <button>
                        Ask
                    </button>

                    {self.synced.running && <div>Running...</div>}

                    <button onClick={async () => {
                        let last = paragraphs[paragraphs.length - 1];
                        if (!last) return;
                        await deleteSessionParagraph(sessionId, last._id);
                        context = context.slice(0, -1);
                        await runQuestion(last.question);
                    }}>
                        Rerun Last
                    </button>

                    <button onClick={async () => {
                        let last = paragraphs[paragraphs.length - 1];
                        if (!last) return;
                        this.synced.editLast = true;
                        this.synced.editLastOverride = last.question;
                        setTimeout(() => input?.focus());
                    }}>
                        Edit Last
                    </button>

                    <button onClick={async () => {
                        await setSessionParagraph(sessionId, {
                            _id: nextId(),
                            question: "",
                            answer: "",
                            orderTime: Date.now(),
                            usage: { tokensIn: 0, tokensOut: 0, cost: 0 }
                        });
                    }}>
                        Add Blank
                    </button>

                    <InputLabel
                        label="Edit Last"
                        checkbox
                        checked={this.synced.editLast}
                        onChange={e => this.synced.editLast = e.currentTarget.checked}
                    />

                    <InputLabel
                        label="Hide Speaker Segments"
                        checkbox
                        checked={this.synced.hideSpeakerSegments}
                        onChange={e => this.synced.hideSpeakerSegments = e.currentTarget.checked}
                    />
                    <InputLabel
                        label="Real Time Audio"
                        checkbox
                        checked={realTimeURL.value === "1"}
                        onChange={e => realTimeURL.value = e.currentTarget.checked ? "1" : ""}
                    />
                </div>

            </div>
        );
    }
}

